import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { bloquearConsumoPendiente, enriquecerConsumos, listarConsumos, politicaConsumo, resolverConsumo, solicitarConsumo, validarCantidadConsumo } from "../services/consumosInventario.service";

// No conecta al PostgreSQL compartido: todas las consultas usan PostgreSQL WASM en memoria.
jest.mock("../config/prisma", () => ({ prisma: { $queryRaw: jest.fn(), $executeRaw: jest.fn(), $transaction: jest.fn() } }));
const operario = randomUUID(), supervisor = randomUUID(), bodega = randomUUID(), obra = randomUUID(), articulo = randomUUID();
let db: PGlite;
function raw(client: { query: Function }) {
  return async (input: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
    const query = Array.isArray(input) ? Prisma.sql(input as unknown as TemplateStringsArray, ...values) : input as Prisma.Sql;
    return (await client.query(query.text, query.values)).rows;
  };
}
const migration = readFileSync(resolve(__dirname, "../../scripts/migrations/20260925_consumos_inventario_beck.sql"), "utf8");
const fixture = `
CREATE TYPE "EstadoAsignacionInventario" AS ENUM ('asignado','devuelto');
CREATE TYPE "TipoInventarioBeck" AS ENUM ('epp','implemento','herramienta');
CREATE TABLE usuarios(id uuid PRIMARY KEY,nombre text);
CREATE TABLE obras(id uuid PRIMARY KEY,nombre text);
CREATE TABLE inventario_beck_epp(id uuid PRIMARY KEY,item text,saldo integer);
CREATE TABLE inventario_beck_implementos(id uuid PRIMARY KEY,item text,saldo integer);
CREATE TABLE inventario_beck_herramientas(id uuid PRIMARY KEY,nombre text,activo boolean DEFAULT true);
CREATE TABLE asignaciones_inventario_beck (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), obra_id uuid, jefe_obra_id uuid, asignado_por_id uuid,
 tipo_item "TipoInventarioBeck", epp_id uuid, implemento_id uuid, herramienta_id uuid,
 cantidad integer CHECK(cantidad>0), observacion text, estado "EstadoAsignacionInventario" DEFAULT 'asignado',
 trabajador_id uuid, reasignado_at timestamp DEFAULT NOW(), sub_skus text[] NOT NULL DEFAULT '{}',
 asignacion_origen_id uuid, recepcion_confirmada_at timestamp, recepcion_confirmada_por_id uuid,
 devolucion_solicitada_at timestamp, created_at timestamp DEFAULT NOW()
);
CREATE TABLE trazabilidad_inventario_beck (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asignacion_id uuid,obra_id uuid,actor_id uuid,jefe_obra_id uuid,
 trabajador_id uuid,accion text,cantidad integer CHECK(cantidad>0),detalle text,datos jsonb,created_at timestamp DEFAULT NOW()
);`;
async function assignment(extra: Record<string, unknown> = {}) {
  const row = { id: randomUUID(), obra_id: obra, jefe_obra_id: supervisor, asignado_por_id: bodega, tipo_item: "epp", epp_id: articulo, cantidad: 3, trabajador_id: operario, sub_skus: ["G-1","G-2","G-3"], recepcion_confirmada_at: new Date(), recepcion_confirmada_por_id: operario, ...extra };
  const keys = Object.keys(row);
  await db.query(`INSERT INTO asignaciones_inventario_beck(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i+1}`).join(",")})`, Object.values(row));
  return row;
}
async function request(id: string, cantidad = 1, subSkus = ["G-2"]) {
  return solicitarConsumo(operario, id, { requestId: randomUUID(), cantidad, subSkus });
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(fixture);
  (prisma.$queryRaw as jest.Mock).mockImplementation(raw(db));
  (prisma.$executeRaw as jest.Mock).mockImplementation(raw(db));
  (prisma.$transaction as jest.Mock).mockImplementation(fn => db.transaction(tx => fn({ $queryRaw: raw(tx), $executeRaw: raw(tx) })));
  // Compatibilidad antes del despliegue: sin tablas no se interrumpe el inventario existente.
  expect(await enriquecerConsumos([{ id: randomUUID(), itemId: articulo, tipoItem: "epp" }])).toEqual([expect.objectContaining({ consumosHabilitados: false, consumible: false })]);
  expect((await listarConsumos("operario", operario, {})).habilitado).toBe(false);
  await expect(request(randomUUID())).rejects.toMatchObject({ status: 503 });
  await db.exec(migration);
  await db.exec(migration); // Reejecución segura del SQL preparado.
  await db.query("INSERT INTO usuarios VALUES ($1,'Operario'),($2,'Supervisor'),($3,'Bodega')", [operario,supervisor,bodega]);
  await db.query("INSERT INTO obras VALUES ($1,'Obra de prueba')", [obra]);
  await db.query("INSERT INTO inventario_beck_epp VALUES ($1,'Guantes',50)", [articulo]);
}, 60000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("TRUNCATE consumos_inventario_beck,asignaciones_inventario_beck,trazabilidad_inventario_beck CASCADE");
  await politicaConsumo("epp", articulo, bodega, true);
});

test.each([0,-1,1.5,4,"1",null,NaN])("rechaza cantidad inválida %p", value => {
  expect(() => validarCantidadConsumo(value,3,[],[])).toThrow();
});
test.each([["G-2","G-2"],["ajeno"],[],["G-1","G-3"]].map(codes => ({ codes })))("exige selección unitaria exacta %p", ({ codes }) => {
  expect(() => validarCantidadConsumo(1,3,["G-1","G-2","G-3"],codes)).toThrow();
});
test("bloquea tipos heredados del prototipo", async () => {
  await expect(politicaConsumo("constructor",articulo)).rejects.toMatchObject({ status:400 });
});
test("solicitud reserva el lote y no modifica existencias", async () => {
  const a = await assignment();
  const c = await request(a.id);
  expect(c.estado).toBe("pendiente");
  expect((await enriquecerConsumos([{ id:a.id,itemId:articulo,tipoItem:"epp" }]))[0].consumoPendiente.id).toBe(c.id);
  await expect(bloquearConsumoPendiente(prisma,a.id)).rejects.toMatchObject({ status:409 });
  await expect(db.query("UPDATE asignaciones_inventario_beck SET estado='devuelto' WHERE id=$1",[a.id])).rejects.toThrow("consumo pendiente");
  await expect(db.query("DELETE FROM asignaciones_inventario_beck WHERE id=$1",[a.id])).rejects.toThrow("consumo pendiente");
  expect((await db.query<{ saldo:number }>("SELECT saldo FROM inventario_beck_epp")).rows[0].saldo).toBe(50);
});
test("confirma parcialmente, conserva códigos y deja resolución en el lote original", async () => {
  const a = await assignment(), c = await request(a.id);
  const result = await resolverConsumo(supervisor,c.id,true);
  const rows = (await db.query<any>("SELECT * FROM asignaciones_inventario_beck ORDER BY estado::text")).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ id:a.id,cantidad:2,sub_skus:["G-1","G-3"],estado:"asignado" });
  expect(rows[1]).toMatchObject({ id:result.asignacion_consumida_id,cantidad:1,sub_skus:["G-2"],estado:"consumido",trabajador_id:operario,asignacion_origen_id:a.id });
  expect((await db.query<any>("SELECT * FROM trazabilidad_inventario_beck WHERE accion='CONSUMO_CONFIRMADO_SUPERVISOR'")).rows[0]).toMatchObject({ asignacion_id:a.id,actor_id:supervisor,cantidad:1 });
  await expect(db.query("UPDATE asignaciones_inventario_beck SET estado='devuelto' WHERE id=$1",[result.asignacion_consumida_id])).rejects.toThrow("consumida");
  await expect(db.query("DELETE FROM asignaciones_inventario_beck WHERE id=$1",[result.asignacion_consumida_id])).rejects.toThrow("consumida");
  await expect(bloquearConsumoPendiente(prisma,a.id)).resolves.toBeUndefined();
  expect((await db.query<{ saldo:number }>("SELECT saldo FROM inventario_beck_epp")).rows[0].saldo).toBe(50);
});
test("consumo total no crea copias y doble confirmación no duplica eventos", async () => {
  const a = await assignment(), c = await request(a.id,3,a.sub_skus);
  await resolverConsumo(supervisor,c.id,true);
  await resolverConsumo(supervisor,c.id,true);
  expect((await db.query<any>("SELECT * FROM asignaciones_inventario_beck")).rows).toEqual([expect.objectContaining({ id:a.id,estado:"consumido",cantidad:3 })]);
  expect((await db.query("SELECT * FROM trazabilidad_inventario_beck WHERE accion='CONSUMO_CONFIRMADO_SUPERVISOR'")).rows).toHaveLength(1);
  await expect(resolverConsumo(supervisor,c.id,false,"Cambio de opinión")).rejects.toMatchObject({ status:409 });
});
test("rechazo obligatorio libera el lote sin descontar unidades y registra actor/motivo", async () => {
  const a = await assignment(), c = await request(a.id);
  await expect(resolverConsumo(supervisor,c.id,false," ")).rejects.toMatchObject({ status:400 });
  await resolverConsumo(supervisor,c.id,false,"Todavía puede utilizarse");
  expect((await db.query<any>("SELECT * FROM asignaciones_inventario_beck")).rows[0]).toMatchObject({ cantidad:3,estado:"asignado",sub_skus:a.sub_skus });
  const result = await listarConsumos("operario",operario,{estado:"rechazado"});
  expect(result.items[0]).toMatchObject({ estado:"rechazado",motivo_rechazo:"Todavía puede utilizarse",resuelto_por:"Supervisor" });
  expect(result.pendientes).toBe(0);
  await expect(bloquearConsumoPendiente(prisma,a.id)).resolves.toBeUndefined();
});
test("solo el dueño solicita y solo su supervisor resuelve", async () => {
  const a = await assignment();
  await expect(solicitarConsumo(bodega,a.id,{requestId:randomUUID(),cantidad:1,subSkus:["G-1"]})).rejects.toMatchObject({ status:404 });
  const c = await request(a.id);
  await expect(resolverConsumo(bodega,c.id,true)).rejects.toMatchObject({ status:404 });
  expect((await listarConsumos("supervisor",bodega,{})).items).toHaveLength(0);
  expect((await listarConsumos("operario",bodega,{})).items).toHaveLength(0);
  expect((await listarConsumos("bodega",bodega,{})).items).toHaveLength(1);
});
test("idempotencia de solicitud y exclusión de otra pendiente", async () => {
  const a = await assignment(), input = { requestId:randomUUID(),cantidad:1,subSkus:["G-1"] };
  const c = await solicitarConsumo(operario,a.id,input);
  expect((await solicitarConsumo(operario,a.id,input)).id).toBe(c.id);
  await expect(solicitarConsumo(operario,a.id,{...input,cantidad:2})).rejects.toMatchObject({ status:409 });
  await expect(request(a.id)).rejects.toMatchObject({ status:409 });
  expect((await db.query("SELECT * FROM consumos_inventario_beck")).rows).toHaveLength(1);
});
test.each([{ recepcion_confirmada_at:null },{ devolucion_solicitada_at:new Date() },{ estado:"devuelto" }])("impide consumo incompatible con recepción/devolución: %p", async fields => {
  const a = await assignment(fields);
  await expect(request(a.id)).rejects.toThrow();
});
test("retornable por política no permite consumo", async () => {
  const a = await assignment();
  await politicaConsumo("epp",articulo,bodega,false);
  await expect(request(a.id)).rejects.toMatchObject({ status:409 });
});
test("soporta asignaciones antiguas sin códigos unitarios", async () => {
  const a = await assignment({ sub_skus:[] });
  const c = await request(a.id,2,[]);
  await resolverConsumo(supervisor,c.id,true);
  expect((await db.query<any>("SELECT cantidad FROM asignaciones_inventario_beck WHERE id=$1",[a.id])).rows[0].cantidad).toBe(1);
});
test("resoluciones concurrentes no confirman dos veces el mismo consumo", async () => {
  const a = await assignment(), c = await request(a.id);
  await Promise.all([resolverConsumo(supervisor,c.id,true), resolverConsumo(supervisor,c.id,true)]);
  expect((await db.query("SELECT * FROM asignaciones_inventario_beck WHERE estado='consumido'")).rows).toHaveLength(1);
  expect((await db.query("SELECT * FROM trazabilidad_inventario_beck WHERE accion='CONSUMO_CONFIRMADO_SUPERVISOR'")).rows).toHaveLength(1);
});
test("permite consumir posteriormente el saldo restante sin reutilizar códigos consumidos", async () => {
  const a = await assignment(), c = await request(a.id);
  await resolverConsumo(supervisor,c.id,true);
  await expect(request(a.id,1,["G-2"])).rejects.toThrow("códigos exactos");
  const next = await request(a.id,2,["G-1","G-3"]);
  await resolverConsumo(supervisor,next.id,true);
  const rows = (await db.query<any>("SELECT * FROM asignaciones_inventario_beck")).rows;
  expect(rows.every(r => r.estado === "consumido")).toBe(true);
  expect(rows.reduce((sum,r) => sum + r.cantidad,0)).toBe(3);
});
test("herramienta consumible se desactiva y conserva su identificador físico", async () => {
  const tool = randomUUID();
  await db.query("INSERT INTO inventario_beck_herramientas VALUES ($1,'Herramienta desechable',true)",[tool]);
  await politicaConsumo("herramienta",tool,bodega,true);
  const a = await assignment({ epp_id:null,herramienta_id:tool,tipo_item:"herramienta",cantidad:1,sub_skus:["H-1"] });
  const c = await request(a.id,1,["H-1"]);
  await resolverConsumo(supervisor,c.id,true);
  expect((await db.query<any>("SELECT activo FROM inventario_beck_herramientas WHERE id=$1",[tool])).rows[0].activo).toBe(false);
  expect((await db.query<any>("SELECT * FROM asignaciones_inventario_beck WHERE id=$1",[a.id])).rows[0]).toMatchObject({ estado:"consumido",sub_skus:["H-1"] });
});
test("un artículo sin política permanece retornable", async () => {
  const other = randomUUID();
  await db.query("INSERT INTO inventario_beck_implementos VALUES ($1,'Implemento',10)",[other]);
  expect(await politicaConsumo("implemento",other)).toEqual({ habilitado:true,consumible:false });
});
test("paginación de consumos conserva filtro, cantidad pendiente y orden estable", async () => {
  for (let i = 0; i < 52; i++) { const a = await assignment(); await request(a.id); }
  const first = await listarConsumos("supervisor",supervisor,{estado:"pendiente",page:1,obraId:obra});
  const second = await listarConsumos("supervisor",supervisor,{estado:"pendiente",page:2,obraId:obra});
  expect(first.items).toHaveLength(50); expect(second.items).toHaveLength(2);
  expect(first.hasMore).toBe(true); expect(second.hasMore).toBe(false); expect(first.pendientes).toBe(52);
  expect(new Set([...first.items,...second.items].map(i => i.id)).size).toBe(52);
  expect((await listarConsumos("bodega",bodega,{obraId:randomUUID()})).items).toHaveLength(0);
});
test("si falla trazabilidad, revierte la decisión y el saldo del operario", async () => {
  const a = await assignment(), c = await request(a.id);
  await db.exec("CREATE FUNCTION fallar_evento() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$; CREATE TRIGGER fallo BEFORE INSERT ON trazabilidad_inventario_beck FOR EACH ROW EXECUTE FUNCTION fallar_evento();");
  try {
    await expect(resolverConsumo(supervisor,c.id,true)).rejects.toThrow("fallo simulado");
    expect((await db.query<any>("SELECT estado FROM consumos_inventario_beck WHERE id=$1",[c.id])).rows[0].estado).toBe("pendiente");
    expect((await db.query<any>("SELECT cantidad FROM asignaciones_inventario_beck WHERE id=$1",[a.id])).rows[0].cantidad).toBe(3);
  } finally { await db.exec("DROP TRIGGER fallo ON trazabilidad_inventario_beck; DROP FUNCTION fallar_evento();"); }
});
test("las copias CRM y móvil de servicio y migración permanecen iguales", () => {
  // La comparación se omite al ejecutar únicamente el repositorio móvil en CI.
  const { existsSync } = require("node:fs");
  const crm = resolve(__dirname,"../../../back_beck_crm");
  if (!existsSync(crm)) return;
  expect(readFileSync(resolve(crm,"scripts/migrations/20260925_consumos_inventario_beck.sql"),"utf8")).toBe(migration);
  expect(readFileSync(resolve(crm,"src/services/consumosInventario.service.ts"),"utf8")).toBe(readFileSync(resolve(__dirname,"../services/consumosInventario.service.ts"),"utf8"));
});
