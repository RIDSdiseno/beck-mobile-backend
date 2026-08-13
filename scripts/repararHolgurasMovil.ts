import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import {
  calcularCamposRegistroTerreno,
  getTramosHolguraPorDefecto,
  type TramoHolgura,
} from "../src/utils/calculosRegistroTerreno";

const LEGACY_HOLGURA_MAP = new Map<number, number>([
  [0, 0],
  [1, 2],
  [1.2, 4],
  [1.4, 6],
  [1.8, 10],
]);

const BACKUP_TABLE = "auditoria_registros_holgura_20260813";

type Registro = {
  id: string;
  obra_id: string;
  created_at: Date;
  cantidad_sellos: number;
  holgura: string;
  factor_por_holguras: string | null;
  accesibilidad: number | null;
  cantidad_sellos_con_factores: string | null;
  aislacion: string | null;
  cantidad_sellos_aislacion: string | null;
  reparacion_tabique: string | null;
  cantidad_final: string | null;
  piso: string;
  tipo_registro: string;
};

type TramoRow = {
  obra_id: string;
  tipo_registro: string;
  holgura_max: string;
  factor: string;
};

function sslConfig() {
  if (process.env.DATABASE_SSL !== "true") return undefined;

  return {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
  };
}

async function cargarTramos(client: PoolClient) {
  const result = await client.query<TramoRow>(`
    SELECT obra_id, tipo_registro, holgura_max, factor
    FROM factor_holgura_tramos
    ORDER BY obra_id, tipo_registro, orden
  `);
  const porObra = new Map<string, TramoHolgura[]>();

  for (const row of result.rows) {
    const key = `${row.obra_id}:${row.tipo_registro}`;
    const tramos = porObra.get(key) ?? [];
    tramos.push({
      holguraMax: Number(row.holgura_max),
      factor: Number(row.factor),
    });
    porObra.set(key, tramos);
  }

  return porObra;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida");

  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  if (apply && verify) {
    throw new Error("Usa --apply o --verify, no ambos al mismo tiempo");
  }
  const pool = new Pool({ connectionString, ssl: sslConfig() });
  const client = await pool.connect();

  try {
    const sourceTable = verify ? BACKUP_TABLE : "registros_terreno";
    const result = await client.query<Registro>(`
      SELECT
        id,
        obra_id,
        created_at,
        cantidad_sellos,
        holgura,
        factor_por_holguras,
        accesibilidad,
        cantidad_sellos_con_factores,
        aislacion,
        cantidad_sellos_aislacion,
        reparacion_tabique,
        cantidad_final,
        piso,
        tipo_registro
      FROM ${sourceTable}
      WHERE tipo_registro = 'sello_cortafuego'
        AND holgura::numeric IN (0, 1, 1.2, 1.4, 1.8)
      ORDER BY created_at, id
    `);
    const tramosPorObra = await cargarTramos(client);
    const cambios = result.rows.map((registro) => {
      const holguraAnterior = Number(registro.holgura);
      const holguraNueva = LEGACY_HOLGURA_MAP.get(holguraAnterior);
      if (holguraNueva === undefined) {
        throw new Error(`Holgura heredada no reconocida: ${registro.holgura}`);
      }

      const key = `${registro.obra_id}:${registro.tipo_registro}`;
      const calculo = calcularCamposRegistroTerreno({
        cantidad_sellos: registro.cantidad_sellos,
        holgura: holguraNueva,
        accesibilidad: registro.accesibilidad ?? 1,
        aislacion: registro.aislacion,
        reparacion_tabique: registro.reparacion_tabique,
        piso: registro.piso,
        tipoRegistro: registro.tipo_registro,
        tramosHolgura:
          tramosPorObra.get(key) ??
          getTramosHolguraPorDefecto(registro.tipo_registro),
      });

      return { registro, holguraAnterior, holguraNueva, calculo };
    });

    const resumen = cambios.reduce<Record<string, number>>((acc, cambio) => {
      const clave = `${cambio.holguraAnterior} -> ${cambio.holguraNueva}`;
      acc[clave] = (acc[clave] ?? 0) + 1;
      return acc;
    }, {});
    const factoresNuevos = cambios.reduce<Record<string, number>>(
      (acc, cambio) => {
        const clave = cambio.calculo.factor_por_holguras.toFixed(2);
        acc[clave] = (acc[clave] ?? 0) + 1;
        return acc;
      },
      {},
    );

    console.log(
      JSON.stringify(
        {
          modo: apply ? "APLICAR" : verify ? "VERIFICAR" : "SIMULACION",
          registrosDetectados: cambios.length,
          primeraFecha: cambios.at(0)?.registro.created_at ?? null,
          ultimaFecha: cambios.at(-1)?.registro.created_at ?? null,
          conversiones: resumen,
          factoresResultantes: factoresNuevos,
        },
        null,
        2,
      ),
    );

    if (verify) {
      const actuales = await client.query<Registro>(
        `
          SELECT
            id,
            obra_id,
            created_at,
            cantidad_sellos,
            holgura,
            factor_por_holguras,
            accesibilidad,
            cantidad_sellos_con_factores,
            aislacion,
            cantidad_sellos_aislacion,
            reparacion_tabique,
            cantidad_final,
            piso,
            tipo_registro
          FROM registros_terreno
          WHERE id = ANY($1::uuid[])
        `,
        [cambios.map(({ registro }) => registro.id)],
      );
      const porId = new Map(actuales.rows.map((registro) => [registro.id, registro]));
      const impacto = await client.query<{
        total_pdf_firmado: number;
        total_validado_cliente: number;
      }>(
        `
          SELECT
            COUNT(*) FILTER (WHERE pdf_firmado_url IS NOT NULL)::int AS total_pdf_firmado,
            COUNT(*) FILTER (WHERE validado_cliente = true)::int AS total_validado_cliente
          FROM registros_terreno
          WHERE id = ANY($1::uuid[])
        `,
        [cambios.map(({ registro }) => registro.id)],
      );
      const estados = await client.query<{ estado: string; total: number }>(
        `
          SELECT estado::text, COUNT(*)::int AS total
          FROM registros_terreno
          WHERE id = ANY($1::uuid[])
          GROUP BY estado
          ORDER BY estado
        `,
        [cambios.map(({ registro }) => registro.id)],
      );
      const iguales = (actual: string | null, esperado: number) =>
        actual !== null && Math.abs(Number(actual) - esperado) < 0.005;
      const errores = cambios.flatMap(({ registro, holguraNueva, calculo }) => {
        const actual = porId.get(registro.id);
        if (!actual) return [`${registro.id}: registro actual ausente`];

        const camposIncorrectos = [
          !iguales(actual.holgura, holguraNueva) && "holgura",
          !iguales(actual.factor_por_holguras, calculo.factor_por_holguras) &&
            "factor_por_holguras",
          !iguales(
            actual.cantidad_sellos_con_factores,
            calculo.cantidad_sellos_con_factores,
          ) && "cantidad_sellos_con_factores",
          !iguales(actual.aislacion, calculo.aislacion_normalizada) && "aislacion",
          !iguales(
            actual.cantidad_sellos_aislacion,
            calculo.cantidad_sellos_aislacion,
          ) && "cantidad_sellos_aislacion",
          !iguales(
            actual.reparacion_tabique,
            calculo.reparacion_tabique_normalizada,
          ) && "reparacion_tabique",
          !iguales(actual.cantidad_final, calculo.cantidad_final) &&
            "cantidad_final",
        ].filter(Boolean);

        return camposIncorrectos.length > 0
          ? [`${registro.id}: ${camposIncorrectos.join(", ")}`]
          : [];
      });

      console.log(
        JSON.stringify(
          {
            respaldo: BACKUP_TABLE,
            respaldados: cambios.length,
            actualesEncontrados: actuales.rows.length,
            registrosCorrectos: cambios.length - errores.length,
            errores,
            pdfFirmadosExistentes: impacto.rows[0]?.total_pdf_firmado ?? 0,
            validadosPorCliente: impacto.rows[0]?.total_validado_cliente ?? 0,
            estados: estados.rows,
          },
          null,
          2,
        ),
      );
      if (errores.length > 0) process.exitCode = 1;
      return;
    }

    if (!apply) return;

    await client.query("BEGIN");
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (LIKE registros_terreno INCLUDING ALL)`,
      );
      await client.query(
        `INSERT INTO ${BACKUP_TABLE} SELECT * FROM registros_terreno WHERE id = ANY($1::uuid[]) ON CONFLICT (id) DO NOTHING`,
        [cambios.map(({ registro }) => registro.id)],
      );

      const backup = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${BACKUP_TABLE} WHERE id = ANY($1::uuid[])`,
        [cambios.map(({ registro }) => registro.id)],
      );
      if (backup.rows[0]?.total !== cambios.length) {
        throw new Error(
          `Respaldo incompleto: ${backup.rows[0]?.total ?? 0}/${cambios.length}`,
        );
      }

      for (const cambio of cambios) {
        const { registro, holguraNueva, calculo } = cambio;
        await client.query(
          `
            UPDATE registros_terreno
            SET
              holgura = $2,
              factor_por_holguras = $3,
              cantidad_sellos_con_factores = $4,
              aislacion = $5,
              cantidad_sellos_aislacion = $6,
              reparacion_tabique = $7,
              cantidad_final = $8,
              updated_at = NOW()
            WHERE id = $1
          `,
          [
            registro.id,
            holguraNueva,
            calculo.factor_por_holguras,
            calculo.cantidad_sellos_con_factores,
            calculo.aislacion_normalizada,
            calculo.cantidad_sellos_aislacion,
            calculo.reparacion_tabique_normalizada,
            calculo.cantidad_final,
          ],
        );
      }

      await client.query("COMMIT");
      console.log(
        `Reparación aplicada. Respaldo disponible en ${BACKUP_TABLE}.`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
