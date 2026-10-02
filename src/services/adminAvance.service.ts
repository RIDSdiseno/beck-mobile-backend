import { Prisma } from "@prisma/client";

export const PERIODOS_AVANCE = ["hoy", "semana", "mes", "todo"] as const;
export type PeriodoAvance = (typeof PERIODOS_AVANCE)[number];

// fecha es DATE: los límites son fechas de calendario de Chile, no instantes UTC.
export function rangoAvance(periodo: PeriodoAvance, now = new Date()) {
  if (periodo === "todo") return { desde: null, hasta: null };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
  const y = get("year"),
    m = get("month") - 1,
    d = get("day");
  const date = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  return {
    desde: date(y, m, periodo === "mes" ? 1 : periodo === "semana" ? d - 6 : d),
    hasta: periodo === "mes" ? date(y, m + 1, 1) : date(y, m, d + 1),
  };
}

/** Una consulta agregada; al teléfono solo viajan métricas, 10 grupos y 10 registros.
 * La versión vigente se resuelve ANTES del período, incluso en correcciones de correcciones.
 * Una creación incompleta no reemplaza a la última versión completa.
 */
export function consultaAvanceObra(
  obraId: string,
  periodo: PeriodoAvance,
  now = new Date(),
) {
  const { desde, hasta } = rangoAvance(periodo, now);
  return Prisma.sql`
    WITH RECURSIVE base AS MATERIALIZED (
      SELECT id, registro_origen_id, carga_completa, created_at, fecha, estado,
        devuelto_a_tecnico, es_correccion, tipo_registro, cantidad_sellos, metros_lineales,
        piso, nombre_sellador, numero_sello
      FROM registros_terreno WHERE obra_id = ${obraId}::uuid
    ), ascendencia AS (
      SELECT id, id AS ancestro, registro_origen_id AS padre, ARRAY[id] AS camino FROM base
      UNION ALL
      SELECT a.id, p.id, p.registro_origen_id, a.camino || p.id
      FROM ascendencia a JOIN base p ON p.id = a.padre
      WHERE NOT p.id = ANY(a.camino)
    ), raices AS (
      SELECT a.id,
        CASE WHEN a.padre = ANY(a.camino)
          THEN (SELECT min(x::text)::uuid FROM unnest(a.camino[array_position(a.camino, a.padre):cardinality(a.camino)]) x)
          ELSE a.ancestro END AS raiz
      FROM ascendencia a
      WHERE a.padre IS NULL OR a.padre = ANY(a.camino)
        OR NOT EXISTS (SELECT 1 FROM base p WHERE p.id = a.padre)
    ), versiones AS (
      SELECT b.*, row_number() OVER (PARTITION BY r.raiz ORDER BY b.created_at DESC, b.id DESC) AS posicion
      FROM base b JOIN raices r ON r.id = b.id WHERE b.carga_completa = true
    ), vigentes AS (
      SELECT * FROM versiones WHERE posicion = 1
        AND (${desde}::date IS NULL OR fecha >= ${desde}::date)
        AND (${hasta}::date IS NULL OR fecha < ${hasta}::date)
    ), produccion AS (
      SELECT *,
        CASE WHEN tipo_registro = 'sello_cortafuego' THEN cantidad_sellos ELSE 0 END AS sellos,
        CASE WHEN tipo_registro = 'junta_lineal_espuma' THEN coalesce(metros_lineales, 0) ELSE 0 END AS metros
      FROM vigentes WHERE estado::text <> 'rechazado'
    ), pisos AS (
      SELECT coalesce(nullif(trim(piso), ''), 'Sin piso') AS nombre,
        count(*)::int AS registros, sum(sellos) AS sellos, sum(metros) AS metros
      FROM produccion GROUP BY 1
    ), responsables AS (
      SELECT coalesce(nullif(trim(nombre_sellador), ''), 'Sin responsable') AS nombre,
        count(*)::int AS registros, sum(sellos) AS sellos, sum(metros) AS metros
      FROM produccion GROUP BY 1
    )
    SELECT jsonb_build_object(
      'periodo', ${periodo}::text, 'desde', ${desde}::text, 'hasta', ${hasta}::text,
      'resumen', (SELECT jsonb_build_object(
        'registros', count(*),
        'pendientesSupervisor', count(*) FILTER (WHERE estado::text = 'pendiente' AND NOT devuelto_a_tecnico),
        'enRevision', count(*) FILTER (WHERE estado::text = 'en_revision'),
        'validados', count(*) FILTER (WHERE estado::text = 'validado'),
        'correcciones', count(*) FILTER (WHERE estado::text = 'rechazado' OR
          (estado::text = 'pendiente' AND (es_correccion OR registro_origen_id IS NOT NULL OR devuelto_a_tecnico)))
      ) FROM vigentes),
      'sellos', (SELECT coalesce(sum(sellos), 0) FROM produccion),
      'metros', (SELECT coalesce(sum(metros), 0) FROM produccion),
      'pisosTotal', (SELECT count(*) FROM pisos),
      'responsablesTotal', (SELECT count(*) FROM responsables),
      'pisos', coalesce((SELECT jsonb_agg(g ORDER BY g.registros DESC, g.nombre) FROM
        (SELECT * FROM pisos ORDER BY registros DESC, nombre LIMIT 10) g), '[]'::jsonb),
      'responsables', coalesce((SELECT jsonb_agg(g ORDER BY g.registros DESC, g.nombre) FROM
        (SELECT * FROM responsables ORDER BY registros DESC, nombre LIMIT 10) g), '[]'::jsonb),
      'ultimos', coalesce((SELECT jsonb_agg(g ORDER BY g.created_at DESC, g.id DESC) FROM
        (SELECT id, fecha, created_at AT TIME ZONE 'UTC' AS created_at, numero_sello, piso, nombre_sellador, estado::text,
          tipo_registro, es_correccion, devuelto_a_tecnico
         FROM vigentes ORDER BY created_at DESC, id DESC LIMIT 10) g), '[]'::jsonb)
    ) AS data
  `;
}
