# Bodega BECK desde la app

## Acceso y alcance

El acceso está en Firemat → Perfil → **Ir a Bodega BECK**. Requiere sesión activa,
rol `bodeguero`, empresa Firemat y correo del dominio `firemat.cl`. Se conserva el
usuario real: no se crea una sesión BECK ni se conceden permisos sobre registros
de obra. Las rutas `/api/bodega-beck` verifican las mismas restricciones en el
servidor después de recargar la identidad activa desde la base de datos.

La sección incluye inventario EPP/implementos/herramientas, altas y edición,
activación/desactivación, ajustes de stock con motivo, SKU, etiquetas PDF,
asignaciones a supervisores BECK, consulta de códigos, devoluciones y movimientos.
El formulario móvil entrega un artículo por operación; puede repetirse para otros
artículos. La importación de Excel permanece exclusivamente en el CRM.

## Stock y devoluciones

- La entrega bodega → supervisor descuenta stock central y genera/reutiliza códigos
  unitarios compatibles con el CRM.
- Supervisor → operario conserva el flujo existente; no vuelve a descontar bodega.
- Operario → supervisor conserva solicitud y confirmación de recepción existentes.
- Supervisor → bodega ahora solicita devolución: reserva las unidades, sin
  incrementar stock ni permitir asignarlas nuevamente.
- El bodeguero confirma recepción física en **Asignaciones → Por recibir en bodega**.
  Solo entonces se reintegran las unidades y se marca la asignación como devuelta.
- Las devoluciones históricas ya finalizadas no se modifican.
- Las operaciones móviles tienen identificador de reintento. La misma solicitud
  no puede sumar stock o entregar unidades dos veces al reintentar una respuesta
  perdida. El cliente conserva esa clave mientras se mantenga la operación fallida
  en pantalla; no es una cola persistente para trabajar sin conexión.

## Persistencia y compatibilidad

Se reutilizan las tablas de inventario, asignaciones, trazabilidad y movimientos
del CRM BECK, incluidos los campos existentes de solicitud/recepción de devolución.
No se requiere migración ni se modifican registros existentes para habilitarlo.

Los servicios móviles y las operaciones de asignación/devolución/generación de SKU
del CRM comparten un bloqueo transaccional. El CRM distingue las asignaciones
pendientes de recepción y no permite que se reentreguen a operarios.

Los listados y la trazabilidad se consultan por páginas de 50. La app elimina IDs
repetidos al incorporar páginas y actualiza los datos al cambiar filtros, realizar
un movimiento o solicitar actualización manual, no en cada cambio de pestaña.

## Publicación coordinada (pendiente)

1. Desplegar `back_beck_crm` y `beck-mobile-backend` con estas reglas compatibles.
2. Publicar `beck-crm` para mostrar el estado «Por recibir en bodega».
3. Publicar `beck-app` y actualizar los teléfonos de supervisores/bodeguero.

Las versiones móviles antiguas pueden mantener un mensaje de devolución inmediata
aunque el backend actualizado deje la operación pendiente. Coordinar la actualización
evita esa confusión. No se agregaron módulos nativos a la app; la generación PDF
ocurre en el backend (dependencia `bwip-js`).

## Prueba manual previa a producción

Usar artículos y usuarios de prueba en un entorno controlado:

1. Bodeguero Firemat entra y vuelve a Firemat sin cambiar sus credenciales.
2. Vendedor Firemat, operario y supervisor no pueden abrir las rutas de bodega.
3. Crear EPP con 10 unidades; generar SKU y compartir su etiqueta PDF.
4. Entregar 3 unidades a supervisor/obra: bodega queda en 7, supervisor dispone de 3.
5. Supervisor entrega 1 a operario: bodega permanece en 7; recepción y devolución
   del operario conservan su trazabilidad.
6. Supervisor solicita devolver 2 unidades: bodega sigue en 7 y esas unidades no
   pueden entregarse a otro operario. El escaneo indica recepción pendiente.
7. Bodeguero confirma físicamente: bodega queda en 9. Repetir la misma solicitud
   no modifica nuevamente el saldo.
8. Comprobar filtros, paginación, historial, códigos unitarios, teclado y botón
   cerrar en Android/iOS. Verificar que una herramienta no tenga dos asignaciones.

La verificación automatizada usa dobles de base de datos, no inventario real.
Los empaquetados de Expo no sustituyen la prueba de cámara en teléfonos físicos.
