import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  consultaAvanceObra,
  rangoAvance,
  PeriodoAvance,
} from "../services/adminAvance.service";

// Base efímera: nunca accede al PostgreSQL compartido.
let db: PGlite;
const obra = randomUUID();
const now = new Date("2026-09-28T12:00:00Z");
async function registro(extra: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(),
    obra_id: obra,
    registro_origen_id: null,
    carga_completa: true,
    created_at: "2026-09-28T10:00:00",
    fecha: "2026-09-28",
    estado: "pendiente",
    devuelto_a_tecnico: false,
    es_correccion: false,
    tipo_registro: "sello_cortafuego",
    cantidad_sellos: 5,
    metros_lineales: null,
    piso: "1",
    nombre_sellador: "Operario",
    numero_sello: "0001",
    ...extra,
  };
  const keys = Object.keys(row);
  await db.query(
    `INSERT INTO registros_terreno(${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    Object.values(row),
  );
  return row;
}
async function avance(periodo: PeriodoAvance = "todo") {
  const query = consultaAvanceObra(obra, periodo, now);
  return (await db.query<{ data: any }>(query.text, query.values)).rows[0].data;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE registros_terreno (
    id uuid PRIMARY KEY, obra_id uuid, registro_origen_id uuid, carga_completa boolean,
    created_at timestamp, fecha date, estado text, devuelto_a_tecnico boolean, es_correccion boolean,
    tipo_registro text, cantidad_sellos int, metros_lineales float, piso text, nombre_sellador text, numero_sello text
  )`);
}, 60000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE registros_terreno");
});

test("obra vacía devuelve ceros y listas vacías", async () => {
  expect(await avance()).toMatchObject({
    sellos: 0,
    metros: 0,
    pisos: [],
    responsables: [],
    ultimos: [],
    resumen: { registros: 0, correcciones: 0 },
  });
});
test("suma sellos crudos y metros separados; excluye incompletos y otras obras", async () => {
  await registro();
  await registro({ estado: "validado", cantidad_sellos: 7 });
  await registro({
    estado: "en_revision",
    tipo_registro: "junta_lineal_espuma",
    cantidad_sellos: 999,
    metros_lineales: 4.5,
  });
  await registro({ carga_completa: false, cantidad_sellos: 900 });
  await registro({ obra_id: randomUUID(), cantidad_sellos: 800 });
  expect(await avance()).toMatchObject({
    sellos: 12,
    metros: 4.5,
    resumen: {
      registros: 3,
      pendientesSupervisor: 1,
      enRevision: 1,
      validados: 1,
      correcciones: 0,
    },
  });
});
test("rechazo sin copia alerta pero no suma producción", async () => {
  await registro({ estado: "rechazado" });
  expect(await avance()).toMatchObject({
    sellos: 0,
    resumen: { registros: 1, correcciones: 1, pendientesSupervisor: 0 },
  });
});

test("tabiquería cuenta como registro, pero no infla los sellos ni los metros de Juntas", async () => {
  await registro({ tipo_registro: "tabiqueria", cantidad_sellos: 40, estado: "validado" });
  expect(await avance()).toMatchObject({ sellos: 0, metros: 0, resumen: { registros: 1, validados: 1 } });
});
test("corrección de corrección cuenta una sola versión y conserva el destino", async () => {
  const original = await registro({
    estado: "rechazado",
    created_at: "2026-09-01",
  });
  const copia = await registro({
    registro_origen_id: original.id,
    es_correccion: true,
    estado: "rechazado",
    created_at: "2026-09-02",
  });
  const ultima = await registro({
    registro_origen_id: copia.id,
    es_correccion: true,
    devuelto_a_tecnico: true,
  });
  const result = await avance();
  expect(result).toMatchObject({
    sellos: 5,
    resumen: { registros: 1, correcciones: 1, pendientesSupervisor: 0 },
  });
  expect(result.ultimos.map((r: any) => r.id)).toEqual([ultima.id]);
  await db.query(
    "UPDATE registros_terreno SET devuelto_a_tecnico = false WHERE id = $1",
    [ultima.id],
  );
  expect((await avance()).resumen).toMatchObject({
    correcciones: 1,
    pendientesSupervisor: 1,
  });
  await db.query(
    "UPDATE registros_terreno SET estado = 'en_revision' WHERE id = $1",
    [ultima.id],
  );
  expect((await avance()).resumen).toMatchObject({
    correcciones: 0,
    pendientesSupervisor: 0,
    enRevision: 1,
  });
});
test("resuelve versión antes de fecha: original no reaparece al filtrar", async () => {
  const original = await registro({
    fecha: "2026-09-28",
    created_at: "2026-09-27",
    estado: "rechazado",
  });
  await registro({
    registro_origen_id: original.id,
    fecha: "2026-09-29",
    es_correccion: true,
  });
  expect((await avance("hoy")).resumen.registros).toBe(0);
  expect((await avance("todo")).resumen.registros).toBe(1);
});
test("copia incompleta no reemplaza la última versión completa", async () => {
  const original = await registro({
    created_at: "2026-09-01",
    estado: "validado",
  });
  await registro({ registro_origen_id: original.id, carga_completa: false });
  const result = await avance();
  expect(result.ultimos[0].id).toBe(original.id);
  expect(result.resumen.validados).toBe(1);
});
test("hermanas enlazadas al mismo original y fechas empatadas se deduplican", async () => {
  const original = await registro({ created_at: "2026-09-01" });
  const a = await registro({
    registro_origen_id: original.id,
    cantidad_sellos: 2,
  });
  const b = await registro({
    registro_origen_id: original.id,
    cantidad_sellos: 3,
  });
  const last = a.id > b.id ? a : b;
  expect(await avance()).toMatchObject({
    sellos: last.cantidad_sellos,
    resumen: { registros: 1 },
  });
});
test("agrupa por piso/responsable y acota respuesta sin limitar las métricas a 100", async () => {
  await db.exec(`INSERT INTO registros_terreno
    SELECT gen_random_uuid(), '${obra}', NULL, true, '2026-09-28'::timestamp + n * interval '1 second',
    '2026-09-28', 'validado', false, false, 'sello_cortafuego', 1, NULL, n::text, 'Operario ' || n, n::text
    FROM generate_series(1, 5000) n`);
  const result = await avance();
  expect(result).toMatchObject({
    sellos: 5000,
    pisosTotal: 5000,
    responsablesTotal: 5000,
    resumen: { registros: 5000, validados: 5000 },
  });
  expect(result.ultimos).toHaveLength(10);
  expect(result.pisos).toHaveLength(10);
  expect(result.responsables).toHaveLength(10);
  expect(new Date(result.ultimos[0].created_at).toISOString()).toBe(
    "2026-09-28T01:23:20.000Z",
  );
});
test("filtro usa fecha de ejecución, no fecha de creación", async () => {
  await registro({ fecha: "2026-09-20" });
  await registro({ fecha: "2026-09-28", created_at: "2026-09-01" });
  expect((await avance("hoy")).resumen.registros).toBe(1);
  expect((await avance("semana")).resumen.registros).toBe(1);
  expect((await avance("mes")).resumen.registros).toBe(2);
});
test("ciclo de datos inválidos no bloquea la consulta ni duplica la cadena", async () => {
  const a = await registro({ created_at: "2026-09-01" });
  const b = await registro({
    registro_origen_id: a.id,
    created_at: "2026-09-02",
  });
  await db.query(
    "UPDATE registros_terreno SET registro_origen_id = $1 WHERE id = $2",
    [b.id, a.id],
  );
  await registro({ registro_origen_id: b.id });
  expect((await avance()).resumen.registros).toBe(1);
});
test("períodos respetan calendario de Chile y cruce de mes/año", () => {
  const chilePrevDay = new Date("2026-01-01T02:00:00Z");
  expect(rangoAvance("hoy", chilePrevDay)).toEqual({
    desde: "2025-12-31",
    hasta: "2026-01-01",
  });
  expect(rangoAvance("semana", chilePrevDay)).toEqual({
    desde: "2025-12-25",
    hasta: "2026-01-01",
  });
  expect(rangoAvance("mes", chilePrevDay)).toEqual({
    desde: "2025-12-01",
    hasta: "2026-01-01",
  });
  expect(rangoAvance("hoy", new Date("2026-07-01T03:30:00Z"))).toEqual({
    desde: "2026-06-30",
    hasta: "2026-07-01",
  });
  expect(rangoAvance("todo", chilePrevDay)).toEqual({
    desde: null,
    hasta: null,
  });
});
