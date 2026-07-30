# beck-mobile-backend

Backend REST API para la aplicación móvil de BECK Soluciones. Gestiona autenticación con credenciales creadas en el CRM, obras, registros de terreno, fotografías privadas y los flujos de ingeniería y cliente.

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js + TypeScript 5 (`strict: true`) |
| Framework | Express 5.1 |
| ORM | Prisma 7.8 + `@prisma/adapter-pg` |
| Base de datos | PostgreSQL |
| Autenticación | Email/contraseña + JWT propio (`jsonwebtoken`) |
| Almacenamiento de imágenes | Cloudinary |
| Upload multipart | Multer 2.2 (memoryStorage) |
| Seguridad HTTP | Helmet, express-rate-limit |
| Hash de contraseñas | bcryptjs |

---

## Requisitos previos

- Node.js 20+
- Acceso a la base de datos PostgreSQL de BECK
- Cuenta y credenciales de Cloudinary

---

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto. Todas las variables marcadas con **Requerida** causan un error al iniciar si no están definidas.

```env
# Servidor
PORT=3001
NODE_ENV=development          # "production" enmascara stack traces en logs

# CORS (opcional — si no se define, no se envían headers CORS)
CORS_ORIGIN=*                 # Puede ser "*", "http://localhost:3000" o lista separada por comas

# JWT — Requerida, mínimo 32 caracteres
JWT_SECRET=cambia_esto_por_un_secreto_seguro_de_al_menos_32_chars
JWT_EXPIRES_IN=8h             # Opcional, por defecto "8h"
JWT_ISSUER=beck-mobile-backend
JWT_AUDIENCE=beck-app

# Cloudinary — Requeridas
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# PostgreSQL — Requerida (Prisma la lee directamente)
DATABASE_URL=postgresql://usuario:password@host:5432/beck_db
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=10
```

Railway conecta el servicio con PostgreSQL mediante su red privada, por lo que
`DATABASE_SSL` debe permanecer en `false`. Para una base externa que requiera
TLS, se puede activar y decidir si la cadena del certificado debe validarse con
`DATABASE_SSL_REJECT_UNAUTHORIZED`.

> **Nota de seguridad:** El servidor falla al iniciar (`throw new Error`) si falta alguna variable requerida o si `JWT_SECRET` tiene menos de 32 caracteres. Esto es intencional para evitar deployar con configuración incompleta.
>
> Para generar un `JWT_SECRET` seguro:
> ```bash
> openssl rand -base64 64
> ```

---

## Instalación y desarrollo local

```bash
# 1. Instalar dependencias
npm install

# 2. Generar el cliente de Prisma
npx prisma generate

# 3. Sincronizar el schema desde la base de datos (si hay cambios de compañeros)
npx prisma db pull

# 4. Iniciar en modo desarrollo (hot-reload)
npm run dev
```

El servidor escucha en `http://localhost:3001` por defecto.

---

## Build y producción

```bash
# 1. Instalar todas las dependencias (incluye devDependencies necesarias para el build)
npm ci

# 2. Compilar: genera el cliente Prisma y transpila TypeScript → dist/
npm run build

# 3. Iniciar el servidor compilado
npm start
```

> **Nota sobre devDependencies en producción:** `npm run build` ejecuta `prisma generate && tsc`, que requiere `prisma` y `typescript` de `devDependencies`. Por eso **no** se debe usar `npm ci --omit=dev` antes del build.
>
> Opcionalmente, después del build se puede limpiar las dependencias de desarrollo:
> ```bash
> npm prune --omit=dev
> ```

---

## Estructura del proyecto

```
beck-mobile-backend/
├── prisma/
│   └── schema.prisma          # Schema Prisma (generado con db pull)
├── src/
│   ├── app.ts                 # Express app: middlewares globales y rutas
│   ├── server.ts              # Punto de entrada — app.listen()
│   ├── config/
│   │   ├── env.ts             # Carga y valida variables de entorno
│   │   └── prisma.ts          # Instancia singleton de PrismaClient
│   ├── controllers/
│   │   ├── auth.controller.ts         # Login con credenciales del CRM
│   │   ├── obras.controller.ts        # Mis obras y configuración de registro
│   │   ├── registros.controller.ts    # CRUD de registros de terreno y fotos
│   │   ├── ingenieria.controller.ts   # Flujo de revisión de ingeniería
│   │   ├── cliente.controller.ts      # Dashboard y registros visibles al cliente
│   │   └── itemizadoOpciones.controller.ts  # Opciones de itemizado
│   ├── middlewares/
│   │   ├── auth.middleware.ts   # verifyAppToken + checkRole
│   │   └── upload.middleware.ts # Multer (memoryStorage, 12 MB, 10 archivos, JPEG/PNG/WebP/HEIC)
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── obras.routes.ts
│   │   ├── registros.routes.ts
│   │   ├── ingenieria.routes.ts
│   │   ├── cliente.routes.ts
│   │   └── itemizadoOpciones.routes.ts
│   ├── services/
│   │   ├── jwt.service.ts           # signAppToken()
│   │   ├── cloudinary.service.ts    # uploadBufferToCloudinary / deleteImageFromCloudinary
│   │   └── obras.service.ts         # Lógica de negocio de obras
│   └── types/
│       └── streamifier.d.ts   # Type declarations para streamifier
├── .env                        # Variables de entorno (no se sube al repositorio)
├── package.json
└── tsconfig.json
```

---

## Flujo de autenticación

El sistema admite únicamente las credenciales creadas desde el CRM:

```
POST /api/mobile/auth/email
   → Busca el usuario en DB por email
   → bcrypt.compare() verifica el hash almacenado
   → Retorna JWT propio firmado con JWT_SECRET
```

> Rate limiting: el endpoint acepta máximo **10 solicitudes por IP cada 15 minutos**.

### Token JWT propio

Todos los endpoints protegidos requieren el header:
```
Authorization: Bearer <token>
```

El middleware `verifyAppToken` decodifica el token y adjunta el payload a `req.user`:

```typescript
{
  id: string;      // UUID del usuario
  nombre: string;
  email: string;
  rol: string;     // ver Roles más abajo
}
```

---

## Roles del sistema

| Rol | Descripción |
|-----|-------------|
| `administrador` | Acceso total |
| `jefeobra` | Gestiona registros de su obra, los envía a ingeniería |
| `terreno` | Crea registros y sube fotografías |
| `ingenieria` | Revisa, valida o rechaza registros |
| `cliente` | Vista de solo lectura de registros de sus obras |

---

## API Reference

### Autenticación — `/api/mobile/auth`

> Rate limit: 10 req / 15 min por IP

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `POST` | `/email` | `{ email, password }` | Login con correo y contraseña |
| `POST` | `/microsoft` | `{ idToken }` | Login Microsoft para usuarios activos creados en el CRM |

**Respuesta exitosa:**
```json
{
  "success": true,
  "token": "<jwt>",
  "user": { "id": "...", "nombre": "...", "email": "...", "rol": "..." }
}
```

---

### Obras — `/api/obras`

> Todos los endpoints requieren `Authorization: Bearer <token>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/mis-obras` | Obras asignadas al usuario autenticado |
| `GET` | `/:id/configuracion-registro` | Configuración de itemizado y campos de la obra |

---

### Registros de terreno — `/api/registros`

> Todos los endpoints requieren `Authorization: Bearer <token>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/mis-registros` | Registros del usuario. Query params: `?obraId=`, `?estado=` |
| `POST` | `/` | Crea un nuevo registro en estado `pendiente` |
| `DELETE` | `/:id` | Elimina un registro en estado `pendiente` (borra fotos de Cloudinary primero) |
| `PUT` | `/:id/enviar-ingenieria` | Jefe de obra envía el registro a ingeniería (`pendiente` → `en_revision`) |
| `PUT` | `/:id/reenviar-tecnico` | Técnico reenvía un registro corregido |
| `PUT` | `/:id/enviar-tecnico` | Jefe de obra devuelve un registro al técnico |
| `PUT` | `/:id/observaciones` | Actualiza observaciones de un registro |
| `POST` | `/:id/fotos` | Sube fotografías (multipart `fotos[]`, máx. 10 archivos × 12 MB) |

Los campos `factor_por_holguras`, `cantidad_sellos_con_factores`, `aislacion`,
`cantidad_sellos_aislacion`, `reparacion_tabique` y `cantidad_final` son
autoritativos del backend. Se recalculan juntos a partir de los datos base y de
los tramos de holgura configurados para la obra; cualquier derivado enviado por
el cliente se ignora.

**Tipos de imagen aceptados:** JPEG, PNG, WebP, HEIC, HEIF

**Estados del registro:**
```
pendiente → en_revision → validado
                       ↘ rechazado → (corrección) → en_revision
```

---

### Ingeniería — `/api/ingenieria`

> Todos los endpoints requieren `Authorization: Bearer <token>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/resumen` | Conteos globales por estado (pendientes, en revisión, validados) |
| `GET` | `/registros` | Listado de registros para revisar. Query params: `?obraId=`, `?estado=` |
| `PUT` | `/registros/:id` | Edita datos de un registro en revisión |
| `PUT` | `/registros/:id/iniciar-revision` | Marca el registro como `en_revision` |
| `PUT` | `/registros/:id/validar` | Valida el registro (`en_revision` → `validado`) |
| `PUT` | `/registros/:id/rechazar` | Rechaza el registro y crea una copia de corrección |

---

### Cliente — `/api/cliente`

> Todos los endpoints requieren `Authorization: Bearer <token>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/dashboard` | Resumen de obras y registros del cliente |
| `GET` | `/obras` | Obras visibles para el cliente |
| `GET` | `/obras/:obraId/registros` | Registros validados de una obra específica |

---

### Itemizado — `/api/itemizado-opciones`

> Requiere `Authorization: Bearer <token>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Opciones de itemizado disponibles para un registro |

---

## Flujo de registro con fotografías

```
1. Técnico crea registro          POST /api/registros/
2. Técnico sube fotos             POST /api/registros/:id/fotos
      └── Multer recibe buffer en memoria
      └── Se comprime antes de enviar (en la app móvil)
      └── uploadBufferToCloudinary() → guarda en carpeta de la obra
      └── Se almacena URL + public_id en tabla fotos_registro

3. Jefe de obra revisa y envía    PUT /api/registros/:id/enviar-ingenieria
4. Ingeniería inicia revisión     PUT /api/ingenieria/registros/:id/iniciar-revision
5a. Ingeniería valida             PUT /api/ingenieria/registros/:id/validar
5b. Ingeniería rechaza            PUT /api/ingenieria/registros/:id/rechazar
      └── Crea copia del registro para corrección
      └── El técnico corrige y reenvía
```

---

## Seguridad

| Control | Implementación |
|---------|----------------|
| Security headers | `helmet()` — HSTS, X-Frame-Options, X-Content-Type-Options, CSP y más |
| Rate limiting | `express-rate-limit`: 10 req / 15 min en endpoints de auth |
| Autenticación | JWT HS256 firmado con `JWT_SECRET` (≥ 32 chars), TTL configurable |
| Verificación OIDC | `jose` — valida firma, audience e issuer del token de Azure AD |
| Hash de contraseñas | `bcryptjs` |
| ORM | Prisma exclusivamente — sin SQL crudo, sin riesgo de inyección |
| Validación de secretos | Crash al iniciar si faltan variables requeridas o `JWT_SECRET` es débil |
| Audit log de auth | `AUTH_OK` / `AUTH_FAIL` con IP, email, razón y timestamp en stdout |
| Logs en producción | `NODE_ENV=production` enmascara stack traces en errores internos |
| Secretos en repositorio | `.env` en `.gitignore`, sin hardcoding de credenciales |

---

## Scripts

```bash
npm run dev        # Desarrollo con hot-reload (ts-node-dev)
npm run build      # Compila TypeScript → dist/
npm start          # Ejecuta dist/server.js
```

---

## Sincronizar cambios del schema de la base de datos

Cuando un compañero modifica la base de datos de PostgreSQL directamente:

```bash
# 1. Traer los últimos cambios del schema al archivo local
npx prisma db pull

# 2. Regenerar el cliente Prisma con los nuevos tipos
npx prisma generate

# 3. Verificar que el código siga compilando
npx tsc --noEmit
```

Luego hacer commit del `prisma/schema.prisma` actualizado.
