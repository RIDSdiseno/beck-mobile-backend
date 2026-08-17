import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import {
  calcularCamposRegistroTerreno,
  getFactoresAccesibilidadPorDefecto,
  getFactoresAislacionPorDefecto,
  getTramosHolguraPorDefecto,
  type FactorAccesibilidadNivel,
  type FactorAislacionEstado,
  type TramoHolgura,
} from "../src/utils/calculosRegistroTerreno";

const BACKUP_TABLE = "auditoria_registros_factores_20260814";

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

type Configuraciones = {
  tramos: Map<string, TramoHolgura[]>;
  accesibilidad: Map<string, FactorAccesibilidadNivel[]>;
  aislacion: Map<string, FactorAislacionEstado[]>;
};

function sslConfig() {
  if (process.env.DATABASE_SSL !== "true") return undefined;
  return {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true",
  };
}

async function cargarConfiguraciones(
  client: PoolClient,
): Promise<Configuraciones> {
  const tramosRows = await client.query<{
      obra_id: string;
      tipo_registro: string;
      holgura_max: string;
      factor: string;
    }>(`
    SELECT obra_id, tipo_registro, holgura_max, factor
    FROM factor_holgura_tramos
    ORDER BY obra_id, tipo_registro, orden
  `);
  const accesibilidadRows = await client.query<{
    obra_id: string;
    nivel: number;
    factor: string;
  }>(`
    SELECT obra_id, nivel, factor
    FROM factor_accesibilidad_obra
    ORDER BY obra_id, nivel
  `);
  const aislacionRows = await client.query<{
    obra_id: string;
    aplica: boolean;
    factor: string;
  }>(`
    SELECT obra_id, aplica, factor
    FROM factor_aislacion_obra
    ORDER BY obra_id, aplica
  `);

  const tramos = new Map<string, TramoHolgura[]>();
  for (const row of tramosRows.rows) {
    const key = `${row.obra_id}:${row.tipo_registro}`;
    const valores = tramos.get(key) ?? [];
    valores.push({
      holguraMax: Number(row.holgura_max),
      factor: Number(row.factor),
    });
    tramos.set(key, valores);
  }

  const accesibilidadPersonalizada = new Map<
    string,
    Map<number, number>
  >();
  for (const row of accesibilidadRows.rows) {
    const valores = accesibilidadPersonalizada.get(row.obra_id) ?? new Map();
    valores.set(row.nivel, Number(row.factor));
    accesibilidadPersonalizada.set(row.obra_id, valores);
  }
  const accesibilidad = new Map<string, FactorAccesibilidadNivel[]>();
  for (const [obraId, valores] of accesibilidadPersonalizada) {
    accesibilidad.set(
      obraId,
      getFactoresAccesibilidadPorDefecto().map((item) => ({
        ...item,
        factor: valores.get(item.nivel) ?? item.factor,
      })),
    );
  }

  const aislacionPersonalizada = new Map<string, Map<boolean, number>>();
  for (const row of aislacionRows.rows) {
    const valores = aislacionPersonalizada.get(row.obra_id) ?? new Map();
    valores.set(row.aplica, Number(row.factor));
    aislacionPersonalizada.set(row.obra_id, valores);
  }
  const aislacion = new Map<string, FactorAislacionEstado[]>();
  for (const [obraId, valores] of aislacionPersonalizada) {
    aislacion.set(
      obraId,
      getFactoresAislacionPorDefecto().map((item) => ({
        ...item,
        factor: valores.get(item.aplica) ?? item.factor,
      })),
    );
  }

  return { tramos, accesibilidad, aislacion };
}

async function cargarRegistros(client: PoolClient, tabla: string) {
  return client.query<Registro>(`
    SELECT
      r.id,
      r.obra_id,
      r.created_at,
      r.cantidad_sellos,
      r.holgura,
      r.factor_por_holguras,
      r.accesibilidad,
      r.cantidad_sellos_con_factores,
      r.aislacion,
      r.cantidad_sellos_aislacion,
      r.reparacion_tabique,
      r.cantidad_final,
      r.piso,
      r.tipo_registro
    FROM ${tabla} r
    JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.tipo_registro = 'sello_cortafuego'
      AND u.rol = 'terreno'
      AND r.aislacion::numeric IN (0, 1)
    ORDER BY r.created_at, r.id
  `);
}

function iguales(actual: string | null, esperado: number) {
  return actual !== null && Math.abs(Number(actual) - esperado) < 0.005;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida");

  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  if (apply && verify) throw new Error("Usa --apply o --verify, no ambos");

  const pool = new Pool({ connectionString, ssl: sslConfig() });
  const client = await pool.connect();
  try {
    const sourceTable = verify ? BACKUP_TABLE : "registros_terreno";
    const result = await cargarRegistros(client, sourceTable);
    const configuraciones = await cargarConfiguraciones(client);

    const cambios = result.rows.map((registro) => {
      const nivelAnterior = registro.accesibilidad ?? 1;
      const nivelAccesibilidad = nivelAnterior === 0 ? 1 : nivelAnterior;
      if (![1, 2, 3].includes(nivelAccesibilidad)) {
        throw new Error(
          `${registro.id}: nivel de accesibilidad inválido ${nivelAnterior}`,
        );
      }
      const aislacionAnterior = Number(registro.aislacion);
      const aislacionAplica = aislacionAnterior === 1;
      const keyTramos = `${registro.obra_id}:${registro.tipo_registro}`;
      const calculo = calcularCamposRegistroTerreno({
        cantidad_sellos: registro.cantidad_sellos,
        holgura: Number(registro.holgura),
        accesibilidad: nivelAccesibilidad,
        aislacion: aislacionAplica,
        reparacion_tabique: registro.reparacion_tabique,
        piso: registro.piso,
        tipoRegistro: registro.tipo_registro,
        tramosHolgura:
          configuraciones.tramos.get(keyTramos) ??
          getTramosHolguraPorDefecto(registro.tipo_registro),
        factoresAccesibilidad:
          configuraciones.accesibilidad.get(registro.obra_id) ??
          getFactoresAccesibilidadPorDefecto(),
        factoresAislacion:
          configuraciones.aislacion.get(registro.obra_id) ??
          getFactoresAislacionPorDefecto(),
      });

      return {
        registro,
        nivelAnterior,
        nivelAccesibilidad,
        aislacionAnterior,
        aislacionAplica,
        calculo,
      };
    });

    const resumen = {
      modo: apply ? "APLICAR" : verify ? "VERIFICAR" : "SIMULACION",
      registrosDetectados: cambios.length,
      accesibilidadCeroANivelUno: cambios.filter(
        (item) => item.nivelAnterior === 0,
      ).length,
      aislacionNoAplica: cambios.filter((item) => !item.aislacionAplica).length,
      aislacionAplica: cambios.filter((item) => item.aislacionAplica).length,
      primeraFecha: cambios.at(0)?.registro.created_at ?? null,
      ultimaFecha: cambios.at(-1)?.registro.created_at ?? null,
    };
    console.log(JSON.stringify(resumen, null, 2));

    if (verify) {
      const actuales = await client.query<Registro>(
        `SELECT * FROM registros_terreno WHERE id = ANY($1::uuid[])`,
        [cambios.map((item) => item.registro.id)],
      );
      const porId = new Map(actuales.rows.map((item) => [item.id, item]));
      const errores = cambios.flatMap((item) => {
        const actual = porId.get(item.registro.id);
        if (!actual) return [`${item.registro.id}: registro ausente`];
        const campos = [
          actual.accesibilidad !== item.nivelAccesibilidad && "accesibilidad",
          !iguales(
            actual.factor_por_holguras,
            item.calculo.factor_por_holguras,
          ) && "factor_por_holguras",
          !iguales(
            actual.cantidad_sellos_con_factores,
            item.calculo.cantidad_sellos_con_factores,
          ) && "cantidad_sellos_con_factores",
          !iguales(actual.aislacion, item.calculo.aislacion_normalizada) &&
            "aislacion",
          !iguales(
            actual.cantidad_sellos_aislacion,
            item.calculo.cantidad_sellos_aislacion,
          ) && "cantidad_sellos_aislacion",
          !iguales(
            actual.reparacion_tabique,
            item.calculo.reparacion_tabique_normalizada,
          ) && "reparacion_tabique",
          !iguales(actual.cantidad_final, item.calculo.cantidad_final) &&
            "cantidad_final",
        ].filter(Boolean);
        return campos.length > 0
          ? [`${item.registro.id}: ${campos.join(", ")}`]
          : [];
      });

      console.log(
        JSON.stringify(
          {
            respaldados: cambios.length,
            actualesEncontrados: actuales.rows.length,
            registrosCorrectos: cambios.length - errores.length,
            errores,
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
        [cambios.map((item) => item.registro.id)],
      );
      const backup = await client.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${BACKUP_TABLE} WHERE id = ANY($1::uuid[])`,
        [cambios.map((item) => item.registro.id)],
      );
      if (backup.rows[0]?.total !== cambios.length) {
        throw new Error(
          `Respaldo incompleto: ${backup.rows[0]?.total ?? 0}/${cambios.length}`,
        );
      }

      for (const item of cambios) {
        await client.query(
          `
            UPDATE registros_terreno
            SET
              accesibilidad = $2,
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
            item.registro.id,
            item.nivelAccesibilidad,
            item.calculo.factor_por_holguras,
            item.calculo.cantidad_sellos_con_factores,
            item.calculo.aislacion_normalizada,
            item.calculo.cantidad_sellos_aislacion,
            item.calculo.reparacion_tabique_normalizada,
            item.calculo.cantidad_final,
          ],
        );
      }
      await client.query("COMMIT");
      console.log(`Respaldo creado en ${BACKUP_TABLE}.`);
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
