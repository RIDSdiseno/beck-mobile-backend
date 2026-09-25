# Consumos del inventario BECK — despliegue coordinado

## Estado de entrega

Código publicado en main de beck-app, beck-mobile-backend, beck-crm y back_beck_crm.
La migración se aplicó al PostgreSQL compartido el 25-09-2026 a las 16:56 UTC, después del despliegue de ambos backend.
Se guardó un respaldo preventivo del inventario fuera de los repositorios y se verificó que las 22 asignaciones, 125 EPP, 49 implementos, 172 herramientas y 107 eventos conservaran exactamente su contenido.
Las tablas de consumos y políticas comenzaron vacías; no se cambió la clasificación de ningún artículo existente.
No ejecutar prisma db push.
Los dos backend incluyen el mismo SQL; se aplica UNA vez por base, no una vez por repositorio.

## Reglas del flujo

- Todos los artículos existentes son retornables por defecto. No se cambian existencias ni asignaciones antiguas.
- Bodega puede marcar un artículo como consumible desde el menú del inventario de la app o al editarlo en el CRM (permiso de edición de inventario).
- Operario: debe tener asignación activa, haber confirmado recepción y no tener devolución pendiente. Selecciona cantidad y los códigos exactos cuando existen; observación opcional.
- Solo el supervisor dueño de la asignación confirma o rechaza. Rechazo requiere motivo.
- Una solicitud pendiente bloquea temporalmente la devolución/modificación de todo ese lote, también si la cantidad solicitada es parcial.
- Rechazo: conserva cantidad y códigos; vuelve a permitir devolución o una nueva solicitud.
- Confirmación total: cambia la asignación a consumido. Confirmación parcial: conserva el saldo activo y separa un lote consumido con sus códigos y origen.
- Ejemplo: asignadas 10, consumidas 3 confirmadas => 7 activas y 3 consumidas. Stock central no cambia en esta operación: ya se descontó al entregar al supervisor.
- Las unidades/códigos consumidos no se reutilizan, no se devuelven ni se reasignan. Las herramientas físicas consumidas quedan inactivas.
- Trazabilidad registra aviso, cantidad/códigos, observación, decisión, actor y fecha. El historial de consumos muestra quién lo solicitó y quién lo resolvió.
- Los avisos son dentro de la aplicación (no notificaciones push). Supervisor ve pendientes en Consumos informados; bodega los consulta en app o pestaña Consumos del CRM.

## Procedimiento de despliegue para otros entornos

1. Respaldar la base compartida y verificar el entorno objetivo. Preparar los cuatro artefactos de esta entrega.
2. Desplegar ambos backend con sus clientes Prisma regenerados. Son compatibles con la base anterior: reportan consumos deshabilitados hasta existir ambas tablas.
3. Aplicar scripts/migrations/20260925_consumos_inventario_beck.sql con un cliente SQL que detenga la ejecución al primer error. El ALTER TYPE inicial debe confirmar su transacción antes del BEGIN del resto del archivo (no envolver todo el archivo en una transacción adicional).
4. Verificar tablas, enum, índice único de pendiente y trigger de protección. No habilitar políticas consumibles hasta que ambos backend estén actualizados.
5. Publicar el frontend CRM y la app. Marcar únicamente los artículos que realmente sean consumibles.
6. Probar recepción -> solicitud parcial -> rechazo -> nueva solicitud -> confirmación con usuarios de prueba. Verificar saldo restante, códigos, escaneo e historial en las tres vistas.
7. Si hay que suspender el uso, deshabilitar nuevas políticas/acciones desde la aplicación. No borrar las tablas ni quitar el enum si ya hay consumos: contienen trazabilidad. No volver a backend antiguo que desconozca consumido.

## Verificación automatizada

Desde beck-mobile-backend: npm test -- --runInBand y npx tsc --noEmit.
Las pruebas de consumo usan PGlite (PostgreSQL WASM en memoria), no DATABASE_URL ni producción. Verifican el SQL y su reejecución, trigger, propiedad/permisos de servicio, recepción obligatoria, cantidades/códigos, parcial/total, rechazo, idempotencia, resoluciones repetidas, rollback, listado y ausencia de doble descuento.
El ejecutor Jest usa --experimental-vm-modules únicamente para cargar el motor de pruebas; no modifica el arranque de producción.
PGlite no sustituye una prueba de concurrencia multiconexión contra PostgreSQL de staging ni una prueba visual en teléfonos.

Las tablas nuevas son independientes del catálogo para permitir el despliegue previo de backend sin exigir columnas nuevas sobre modelos existentes. Las restricciones CHECK, el índice único parcial y el trigger se administran mediante SQL y no deben eliminarse al introspectar Prisma.
