# Reporte de corrección de holguras

Fecha de ejecución: 13 de agosto de 2026.

## Problema confirmado

La aplicación móvil mostraba rangos de holgura en centímetros, pero enviaba como `holgura` el factor asociado al rango:

- `H ≤ 2` enviaba `1`.
- `2 < H ≤ 4` enviaba `1.2`.
- `4 < H ≤ 6` enviaba `1.4`.
- `6 < H ≤ 10` enviaba `1.8`.

El backend interpretaba esos números como centímetros y volvía a calcular el factor. Como todos eran menores o iguales a 2, el resultado era siempre `1.00`.

## Cambios realizados

### Aplicación móvil

Se corrigieron los valores del selector de `Holgura (cm)`:

- `H ≤ 2 cm` envía `2`.
- `2 < H ≤ 4 cm` envía `4`.
- `4 < H ≤ 6 cm` envía `6`.
- `6 < H ≤ 10 cm` envía `10`.
- `No aplica` continúa enviando `0`.

La fórmula de `factor_por_holguras` no fue modificada.

### Compatibilidad con versiones anteriores

El backend móvil normaliza los valores heredados del selector (`1`, `1.2`, `1.4` y `1.8`) a sus límites en centímetros antes de validarlos y calcular los campos derivados. De esta forma, las instalaciones que aún no reciban la actualización de Expo no vuelven a generar el cálculo incorrecto una vez desplegado el backend.

Los valores de la versión corregida (`2`, `4`, `6` y `10`) se conservan sin cambios. La normalización se aplica en creación, corrección del operario y edición o envío del supervisor.

### Registros históricos

Antes de modificar datos se ejecutó una simulación. Esta identificó 134 registros creados entre el 6 y el 13 de agosto de 2026, todos posteriores a la incorporación del selector defectuoso.

Se aplicaron estas conversiones:

| Holgura anterior | Holgura corregida | Registros |
| ---: | ---: | ---: |
| 1.0 | 2.0 | 82 |
| 1.2 | 4.0 | 48 |
| 1.4 | 6.0 | 1 |
| 0.0 | 0.0 | 3 |

Para cada registro se recalcularon mediante la función oficial del backend:

- `factor_por_holguras`
- `cantidad_sellos_con_factores`
- `aislacion`
- `cantidad_sellos_aislacion`
- `reparacion_tabique`
- `cantidad_final`

La operación fue transaccional. Los valores originales quedaron respaldados en la tabla `auditoria_registros_holgura_20260813`.

## Resultado verificado

La comparación entre el respaldo y los registros actuales produjo:

- Registros respaldados: 134.
- Registros actuales encontrados: 134.
- Registros que coinciden con la holgura y el cálculo esperados: 134.
- Registros con diferencias: 0.
- PDFs firmados existentes entre los registros reparados: 0.
- Registros validados por cliente entre los reparados: 0.

Estados de los registros reparados:

| Estado | Registros |
| --- | ---: |
| En revisión | 25 |
| Pendiente | 16 |
| Rechazado | 7 |
| Validado | 86 |

Distribución final de factores:

| Factor | Registros |
| ---: | ---: |
| 1.00 | 85 |
| 1.20 | 48 |
| 1.40 | 1 |

## Validaciones de código

- Backend: 8 suites y 49 pruebas aprobadas, incluidas las pruebas de normalización heredada y del controlador completo.
- Backend: compilación TypeScript y generación de Prisma aprobadas.
- App: comprobación TypeScript aprobada.
- App: 2 suites y 9 pruebas aprobadas, incluida una prueba de regresión específica para los valores del selector de holgura.
- App: lint sin errores; permanecen 2 advertencias preexistentes y ajenas a esta corrección en los módulos Firemat de productos e inventario.

## Alcance de publicación

Este informe documenta la validación previa a la publicación del backend en `main`. La corrección correspondiente de `beck-app` permanece local y no forma parte de esta publicación; tampoco se publica una actualización en Expo EAS.
