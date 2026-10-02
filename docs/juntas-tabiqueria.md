# Implementación local: Juntas y Tabiquería

Fecha: 30-09-2026.

## Reglas acordadas

- Sellos conserva su fórmula de cantidad final, incluida la aislación.
- Juntas corresponde únicamente a `junta_lineal_espuma` y registra metros lineales positivos, admitiendo decimales.
- Tabiquería registra unidades enteras positivas, igual que la cantidad de Sellos.
- En Juntas y Tabiquería se conservan Aislación y su factor, pero no multiplican la base ni la cantidad final.
- No se modificaron registros, firmas, fotografías ni configuraciones de obras en PostgreSQL. No se publicó a GitHub, Railway ni EAS.

## Fórmulas

Para Juntas y Tabiquería:

```
base = cantidad × factor de holgura/separación × factor de accesibilidad

Piso distinto de "-1":
  cantidad con factores = base
  cantidad final = base + 1 si aplica reparación; de lo contrario, base

Piso exactamente "-1":
  cantidad con factores = base × 1,1
  cantidad final = base × 1,1, sin sumar reparación
```

En Sellos, la cantidad con factores se multiplica además por el factor de aislación para obtener la base final; se mantiene la misma regla de reparación y sótano.

La configuración de la obra prevalece sobre los valores predeterminados. “No aplica” en holgura/separación y accesibilidad utiliza factor neutro 1.

| Tipo | Tramos predeterminados, medida máxima → factor |
| --- | --- |
| Sellos / Tabiquería | 2 → 1; 4 → 1,2; 6 → 1,4; 10 → 1,8 |
| Junta lineal espuma | 2 → 1; 3 → 1,5; 4 → 2; 5 → 2,5 |

Ejemplos, piso 1 y aislación Aplica (1,3):

| Registro | Cantidad | Holgura/separación | Accesibilidad | Con factores | Final sin reparación | Final con reparación |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Juntas | 1,5 m | 5 cm → 2,5 | 2 | 7,5 | 7,5 | 8,5 |
| Tabiquería | 3 | 4 cm → 1,2 | 2 | 7,2 | 7,2 | 8,2 |
| Sellos | 3 | 4 cm → 1,2 | 2 | 7,2 | 9,36 | 10,36 |

## Estructura y compatibilidad

Se reutiliza `registros_terreno`; no se necesitan tablas ni columnas nuevas:

- `tipo_registro` distingue los tres tipos.
- `metros_lineales` contiene la cantidad de Juntas; `cantidad_sellos` queda en 0 para nuevas Juntas.
- `cantidad_sellos` contiene unidades de Sellos o Tabiquería.
- `holgura` guarda la medida física de holgura o separación, nunca el factor.
- Los campos derivados conservan sus nombres físicos históricos, aunque en Juntas representan cantidades en metros.
- `aislacion` y `cantidad_sellos_aislacion` conservan el factor normalizado, conforme al comportamiento existente. No se sustituyen por una cantidad multiplicada.
- No se transforma un tipo en otro al corregirlo desde la app.

El uso futuro de aislación en Juntas/Tabiquería NO quedó activado. Si se solicita, conviene versionar esa nueva regla y decidir expresamente qué registros recalcular, evitando cambiar resultados históricos sin autorización.

## Cambios por proyecto

### beck-app

- Tercer tipo Tabiquería, Juntas con formulario completo y cantidad decimal en metros.
- Selector de holgura/separación con los tramos efectivos de la obra enviados por el backend.
- Tipos de creación limitados por la configuración existente del CRM. Una obra sin tipos activos conserva el comportamiento permisivo del CRM; no se habilitaron tipos en ninguna obra.
- Conservación del tipo al corregir/revisar, edición de metros en Ingeniería y etiquetas e iconos de Tabiquería en las vistas principales.
- Detalles de Juntas con factores, aislación informativa, reparación y cantidad final; se conserva la configuración de visibilidad.
- En Cliente, la cantidad de Juntas utiliza la opción existente de cantidad del CRM, igual que el historial y el PDF. No se creó una configuración independiente por tipo.
- Selector de Tabiquería para los indicadores del supervisor.

### beck-mobile-backend

- Cálculo autoritativo para los tres tipos en creación, corrección del operario, envío del supervisor, edición y copia de rechazo de Ingeniería.
- Cantidades positivas; Tabiquería y Sellos enteros. Se mantiene la creación incompleta hasta recibir la fotografía.
- Consulta de tipos habilitados y tramos por obra. El endpoint de configuración devuelve metadata adicional sin cambiar el arreglo de campos existente.
- PDF firmado con medidas, factores, número identificador y etiquetas de cada tipo, respetando los campos visibles del cliente.
- Tabiquería no aumenta el indicador de Sellos ejecutados del administrador.

### back_beck_crm

- Misma fórmula que el backend móvil, en creación, edición e importación Excel.
- Importación reconoce hojas de Tabiquería y datos completos de Juntas, incluyendo metros, separación, itemizados y número identificador.
- El complemento de procesamiento de Ingeniería utiliza la cantidad con factores calculada por el servidor; deja de multiplicar directamente por los centímetros de holgura. La validación del estado se realiza antes de escribir la transición.
- La tarjeta Sellos ejecutados no suma unidades de Tabiquería.

### beck-crm

- Formulario y detalle comunes completos para Juntas, con metros editables, separación y factores.
- Los módulos Registro y Procesamiento de Ingeniería envían los metros al guardar Juntas.
- Aislación permanece disponible y se identifica como informativa en la edición de Juntas/Tabiquería.
- Los factores se muestran como números sin limitarlos a la escala de Sellos; se conservan factores de Juntas y personalizados. El detalle muestra el folio real, separado del número de sello.

## Verificación

- Compilación TypeScript de ambos backend.
- Typecheck y ESLint de los archivos revisados de la app.
- Build de producción del frontend CRM. Conserva advertencias de tamaño de bundle y Browserslist, sin impedir la compilación.
- Pruebas automáticas del backend móvil, incluida creación por tipo, aislamiento por obra, cantidades fraccionarias inválidas, PDF y exclusión de Tabiquería de los sellos del dashboard.
- Pruebas automáticas de la app, incluida lectura/refresco de tipos y tramos por obra.
- Resultado de suites completas: 243 pruebas del backend móvil y 90 de la app aprobadas. En el backend CRM, 31 pruebas de cálculo, producción y selección de itemizado aprobadas.
- Pruebas de cálculo del backend CRM con la misma matriz de 17 casos del móvil; también se ejecutaron las pruebas de producción del dashboard y selección de itemizado.
- Las pruebas usan mocks o una base efímera. No se crearon registros de prueba en PostgreSQL compartido.

## Prueba funcional pendiente antes de publicar

1. En una obra de pruebas, habilitar expresamente Juntas y Tabiquería desde el CRM cuando se autorice hacerlo.
2. Crear un registro de cada tipo con foto y los ejemplos numéricos anteriores; confirmar que Sellos sigue igual.
3. Revisar con Supervisor, enviar a Ingeniería, corregir/rechazar y completar el circuito Operario → Supervisor → Ingeniería.
4. Revisar y firmar como Cliente; contrastar pantalla y PDF, ocultando aislación y cantidad desde la configuración de la obra.
5. Probar un tramo personalizado y “No aplica”. Cambiar aislación de Aplica a No aplica en Juntas/Tabiquería no debe modificar el resultado final.
6. Probar la importación con un Excel pequeño de datos reales de prueba; la planilla de especificaciones no sustituye una prueba de importación con fotografías.

No se realizó la prueba manual en dispositivos Android/iOS ni una importación contra la base compartida. Para publicar, coordinar primero ambos backend y después los frontend; no publicar solo la app contra el backend anterior.
