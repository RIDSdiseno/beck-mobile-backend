# Inicio del administrador: avance por obra

## Alcance

Pantalla de Inicio exclusiva del administrador BECK. No modifica los inicios de otros roles, los registros, sus factores ni el dashboard del CRM. No requiere migración.

- Selector de obra (incluye obras históricas) y período: Hoy, Semana, Mes y Todo.
- Producción sin factores: sellos y metros lineales por separado.
- Pendientes de Supervisor, en revisión por Ingeniería, validados y correcciones pendientes.
- Diez principales pisos y responsables, ordenados por número de registros; se informa el total de grupos cuando hay más.
- Diez últimos registros vigentes, con acceso al detalle y fotografías existente.
- Encabezado y filtros fijos. Actualización al cambiar los filtros o deslizar para refrescar; no vuelve a consultar métricas por cambiar de pestaña.
- Conserva accesos a las funciones de Operario, Supervisor e Ingeniería.

## Reglas de cálculo

1. Una cadena agrupa el original, sus copias y las correcciones de esas copias mediante `registro_origen_id`.
2. Se toma la última versión **completa** de cada cadena, por `created_at DESC, id DESC`. Una copia incompleta no sustituye la anterior. La resolución de versiones ocurre antes del filtro de fecha.
3. El período usa `fecha` (ejecución), de tipo DATE. Hoy y Semana se basan en el calendario de America/Santiago; Semana incluye hoy y los seis días anteriores; Mes es el mes calendario actual. Todo no restringe fechas.
4. Producción: se excluyen las versiones vigentes rechazadas. Para `junta_lineal_espuma` se suman `metros_lineales`; para los demás tipos se suma `cantidad_sellos`, siguiendo el criterio de producción del CRM. Nunca se suman factores ni `cantidad_final`.
5. La producción incluye pendientes, en revisión y validados. **No equivale a producción aprobada ni a porcentaje del contrato.** No se calcula un porcentaje de avance sin una meta contractual.
6. Pendientes de Supervisor: estado pendiente y no devueltos al técnico. En revisión y validados: su estado correspondiente en la versión vigente.
7. Correcciones pendientes: rechazo vigente sin copia completa posterior, o versión pendiente marcada como corrección, vinculada a un original o devuelta al técnico. Al reenviarse a Ingeniería deja esta alerta. Puede coincidir con Pendientes de Supervisor: es una alerta, no un quinto estado excluyente. La pantalla lo explica.
8. Responsables: se agrupa por `nombre_sellador` sin espacios extremos, como el desglose del CRM; no es una métrica de la persona que editó o envió el registro. Los nombres idénticos quedan agrupados.

## API y rendimiento

- `GET /api/admin/avance-obras/opciones`: id, nombre, código y estado de las obras.
- `GET /api/admin/avance-obras?obraId=<uuid>&periodo=hoy|semana|mes|todo`: resumen y desgloses.
- Requiere sesión vigente, rol administrador y empresa BECK. Valida parámetros y existencia de obra.
- Consulta SQL parametrizada, agregación en PostgreSQL y respuesta acotada. **Las métricas no tienen límite de 100 registros**; el límite de diez es solo de presentación de grupos y últimos registros.
- Las fotografías y el detalle completo se solicitan únicamente al abrir un registro, con el endpoint autenticado de historial existente.
- Se conserva `/api/admin/resumen` para clientes anteriores.
- La app descarta respuestas tardías de otro filtro y mantiene los últimos datos ante un error de refresco, con aviso. Una falla inicial no se presenta como indicadores en cero.

## Verificación y despliegue

Pruebas del servicio contra PostgreSQL efímero en memoria (PGlite), sin escribir en la base compartida: obra vacía, 5.000 registros, obra aislada, registros incompletos, cadenas multinivel y ramificadas, empates, ciclos inválidos, rechazo sin copia, destinos de corrección, límites de calendario y filtros por ejecución. Pruebas adicionales de permisos, validación de parámetros y cliente API.

Validación local: build del backend, typecheck y lint de la app; 217 pruebas backend y 87 app aprobadas. Falta validación visual en teléfono real.

Publicar primero el backend con los nuevos endpoints y después la app. No hay cambios de dependencias nativas ni schema. Esta implementación no publica ni migra datos por sí sola.
