import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

export class ConsumoError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tablas = { epp: "inventario_beck_epp", implemento: "inventario_beck_implementos", herramienta: "inventario_beck_herramientas" } as const;
export function validarCantidadConsumo(cantidad: unknown, disponible: number, codigos: string[], seleccion: unknown) {
  if (typeof cantidad !== "number" || !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > disponible)
    throw new ConsumoError("La cantidad debe ser un entero entre 1 y el saldo asignado.");
  if (!Array.isArray(seleccion) || seleccion.some(c => typeof c !== "string") || new Set(seleccion).size !== seleccion.length)
    throw new ConsumoError("Los códigos seleccionados no son válidos.");
  if (codigos.length && (seleccion.length !== cantidad || seleccion.some(c => !codigos.includes(c))))
    throw new ConsumoError("Selecciona los códigos exactos de las unidades consumidas.");
  if (!codigos.length && seleccion.length) throw new ConsumoError("Esta asignación no tiene códigos unitarios.");
  return seleccion as string[];
}
function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ConsumoError("Identificador inválido.");
  return value;
}
function nota(value: unknown, obligatoria = false) {
  if (value != null && typeof value !== "string") throw new ConsumoError("Observación inválida.");
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 1000 || (obligatoria && !text)) throw new ConsumoError(obligatoria ? "Ingresa el motivo del rechazo (máximo 1000 caracteres)." : "La observación admite hasta 1000 caracteres.");
  return text || null;
}
export async function consumosHabilitados() {
  const rows = await prisma.$queryRaw<{ listo: boolean }[]>`
    SELECT to_regclass('consumos_inventario_beck') IS NOT NULL
       AND to_regclass('politicas_consumo_inventario_beck') IS NOT NULL AS listo`;
  return rows[0]?.listo === true;
}
async function exigirMigracion() {
  if (!await consumosHabilitados()) throw new ConsumoError("El consumo requiere la migración coordinada de inventario BECK.", 503);
}
export async function bloquearConsumoPendiente(tx: Prisma.TransactionClient, asignacionId: string) {
  // Se mantiene compatible con la base anterior hasta aplicar la migración.
  const ready = await tx.$queryRaw<{ listo: boolean }[]>`SELECT to_regclass('consumos_inventario_beck') IS NOT NULL AS listo`;
  if (!ready[0]?.listo) return;
  const pending = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM consumos_inventario_beck WHERE asignacion_id=${asignacionId}::uuid AND estado='pendiente'`;
  if (pending.length) throw new ConsumoError("Hay un consumo pendiente. El supervisor debe resolverlo antes de devolver este lote.", 409);
}
export async function enriquecerConsumos<T extends { id: string; tipoItem: string; itemId: string }>(items: T[]) {
  const habilitado = await consumosHabilitados();
  if (!habilitado || !items.length) return items.map(i => ({ ...i, consumible: false, consumoPendiente: null, consumosHabilitados: habilitado }));
  const policies = await prisma.$queryRaw<{ tipo_item: string; item_id: string; consumible: boolean }[]>(Prisma.sql`
    SELECT * FROM politicas_consumo_inventario_beck WHERE item_id::text IN (${Prisma.join(items.map(i => i.itemId))})`);
  const pending = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM consumos_inventario_beck
    WHERE estado='pendiente' AND asignacion_id::text IN (${Prisma.join(items.map(i => i.id))})`);
  return items.map(i => ({ ...i, consumosHabilitados: true,
    consumible: policies.some(p => p.tipo_item === i.tipoItem && p.item_id === i.itemId && p.consumible),
    consumoPendiente: pending.find(p => p.asignacion_id === i.id) || null }));
}
export async function politicaConsumo(tipo: unknown, id: unknown, actor?: string, value?: unknown) {
  const itemId = uuid(id);
  if (typeof tipo !== "string" || !Object.prototype.hasOwnProperty.call(tablas, tipo)) throw new ConsumoError("Tipo de artículo inválido.");
  const habilitado = await consumosHabilitados();
  if (!habilitado) { if (actor) await exigirMigracion(); return { habilitado: false, consumible: false }; }
  const table = tablas[tipo as keyof typeof tablas];
  const items = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id=${itemId}::uuid`);
  if (!items.length) throw new ConsumoError("Artículo no encontrado.", 404);
  if (actor) {
    if (typeof value !== "boolean") throw new ConsumoError("Indica si el artículo es consumible.");
    await prisma.$executeRaw`INSERT INTO politicas_consumo_inventario_beck(tipo_item,item_id,consumible,actualizado_por_id)
      VALUES(${tipo}::"TipoInventarioBeck",${itemId}::uuid,${value},${actor}::uuid)
      ON CONFLICT(tipo_item,item_id) DO UPDATE SET consumible=EXCLUDED.consumible,actualizado_por_id=EXCLUDED.actualizado_por_id,updated_at=NOW()`;
  }
  const rows = await prisma.$queryRaw<{ consumible: boolean }[]>`SELECT consumible FROM politicas_consumo_inventario_beck WHERE tipo_item::text=${tipo} AND item_id=${itemId}::uuid`;
  return { habilitado: true, consumible: rows[0]?.consumible === true };
}
export async function solicitarConsumo(operarioId: string, asignacionId: unknown, input: { requestId?: unknown; cantidad?: unknown; subSkus?: unknown; observacion?: unknown }) {
  const id = uuid(input.requestId), aid = uuid(asignacionId), observacion = nota(input.observacion);
  await exigirMigracion();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(749182)::text`;
    const previous = await tx.$queryRaw<any[]>`SELECT * FROM consumos_inventario_beck WHERE id=${id}::uuid`;
    if (previous.length) {
      const p = previous[0];
      if (p.trabajador_id !== operarioId || p.asignacion_id !== aid || p.cantidad !== input.cantidad ||
          p.observacion !== observacion || JSON.stringify([...p.sub_skus].sort()) !== JSON.stringify(Array.isArray(input.subSkus) ? [...input.subSkus].sort() : []))
        throw new ConsumoError("Este identificador ya se usó para otra solicitud.", 409);
      return p;
    }
    const rows = await tx.$queryRaw<any[]>`SELECT * FROM asignaciones_inventario_beck WHERE id=${aid}::uuid FOR UPDATE`;
    const a = rows[0];
    if (!a || a.trabajador_id !== operarioId || a.estado !== "asignado") throw new ConsumoError("No tienes esta asignación activa.", 404);
    if (!a.recepcion_confirmada_at) throw new ConsumoError("Primero confirma la recepción del artículo.");
    if (a.devolucion_solicitada_at) throw new ConsumoError("Ya hay una devolución en curso.", 409);
    await bloquearConsumoPendiente(tx, aid);
    const policies = await tx.$queryRaw<{ consumible: boolean }[]>`SELECT consumible FROM politicas_consumo_inventario_beck
      WHERE tipo_item=${a.tipo_item}::"TipoInventarioBeck" AND item_id=${a.epp_id || a.implemento_id || a.herramienta_id}::uuid`;
    if (!policies[0]?.consumible) throw new ConsumoError("Bodega no ha marcado este artículo como consumible.", 409);
    const codes = validarCantidadConsumo(input.cantidad, a.cantidad, a.sub_skus, input.subSkus ?? []);
    const [request] = await tx.$queryRaw<any[]>`INSERT INTO consumos_inventario_beck
      (id,asignacion_id,trabajador_id,jefe_obra_id,obra_id,cantidad,sub_skus,observacion)
      VALUES(${id}::uuid,${aid}::uuid,${operarioId}::uuid,${a.jefe_obra_id}::uuid,${a.obra_id}::uuid,${input.cantidad as number},${codes}::text[],${observacion}) RETURNING *`;
    await eventoConsumo(tx, a, aid, operarioId, request.cantidad, "CONSUMO_SOLICITADO_OPERARIO", observacion || "Operario informó consumo pendiente de confirmación", id, codes);
    return request;
  });
}
async function eventoConsumo(tx: Prisma.TransactionClient, a: any, asignacionId: string, actor: string, cantidad: number, accion: string, detalle: string, requestId: string, codes: string[]) {
  await tx.$executeRaw`INSERT INTO trazabilidad_inventario_beck(asignacion_id,obra_id,actor_id,jefe_obra_id,trabajador_id,accion,cantidad,detalle,datos)
    VALUES(${asignacionId}::uuid,${a.obra_id}::uuid,${actor}::uuid,${a.jefe_obra_id}::uuid,${a.trabajador_id}::uuid,${accion},${cantidad},${detalle},
      ${JSON.stringify({ consumoId: requestId, subSkus: codes })}::jsonb)`;
}
export async function resolverConsumo(supervisorId: string, requestId: unknown, confirmar: unknown, motivoRaw?: unknown) {
  const id = uuid(requestId);
  if (typeof confirmar !== "boolean") throw new ConsumoError("Resolución inválida.");
  const motivo = nota(motivoRaw, !confirmar);
  await exigirMigracion();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(749182)::text`;
    const [c] = await tx.$queryRaw<any[]>`SELECT * FROM consumos_inventario_beck WHERE id=${id}::uuid FOR UPDATE`;
    if (!c || c.jefe_obra_id !== supervisorId) throw new ConsumoError("No tienes acceso a este consumo.", 404);
    const estado = confirmar ? "confirmado" : "rechazado";
    if (c.estado !== "pendiente") {
      if (c.estado === estado) return c;
      throw new ConsumoError("El consumo ya fue resuelto.", 409);
    }
    const [a] = await tx.$queryRaw<any[]>`SELECT * FROM asignaciones_inventario_beck WHERE id=${c.asignacion_id}::uuid FOR UPDATE`;
    if (!a || a.estado !== "asignado" || a.trabajador_id !== c.trabajador_id || a.jefe_obra_id !== supervisorId || a.devolucion_solicitada_at)
      throw new ConsumoError("La asignación cambió. No se puede resolver el consumo.", 409);
    validarCantidadConsumo(c.cantidad, a.cantidad, a.sub_skus, c.sub_skus);
    await tx.$executeRaw`UPDATE consumos_inventario_beck SET estado=${estado},resuelto_at=NOW(),resuelto_por_id=${supervisorId}::uuid,motivo_rechazo=${confirmar ? null : motivo} WHERE id=${id}::uuid`;
    let consumedId: string | null = null;
    if (confirmar) {
      if (c.cantidad === a.cantidad) {
        await tx.$executeRaw`UPDATE asignaciones_inventario_beck SET estado='consumido' WHERE id=${a.id}::uuid`;
        consumedId = a.id;
      } else {
        const remaining = a.sub_skus.filter((s: string) => !c.sub_skus.includes(s));
        await tx.$executeRaw`UPDATE asignaciones_inventario_beck SET cantidad=cantidad-${c.cantidad},sub_skus=${remaining}::text[] WHERE id=${a.id}::uuid`;
        const [child] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO asignaciones_inventario_beck
          (obra_id,jefe_obra_id,asignado_por_id,tipo_item,epp_id,implemento_id,herramienta_id,cantidad,observacion,estado,trabajador_id,reasignado_at,sub_skus,asignacion_origen_id,recepcion_confirmada_at,recepcion_confirmada_por_id)
          SELECT obra_id,jefe_obra_id,asignado_por_id,tipo_item,epp_id,implemento_id,herramienta_id,${c.cantidad},observacion,'consumido',trabajador_id,reasignado_at,${c.sub_skus}::text[],id,recepcion_confirmada_at,recepcion_confirmada_por_id
          FROM asignaciones_inventario_beck WHERE id=${a.id}::uuid RETURNING id`;
        consumedId = child.id;
      }
      // Las herramientas representan unidades físicas: no volver a ofrecerlas.
      if (a.herramienta_id) await tx.$executeRaw`UPDATE inventario_beck_herramientas SET activo=false WHERE id=${a.herramienta_id}::uuid`;
      await tx.$executeRaw`UPDATE consumos_inventario_beck SET asignacion_consumida_id=${consumedId}::uuid WHERE id=${id}::uuid`;
    }
    // En el lote original queda la resolución incluso al separar un consumo parcial.
    // El lote consumido hereda esta trazabilidad mediante asignacion_origen_id.
    await eventoConsumo(tx, a, a.id, supervisorId, c.cantidad,
      confirmar ? "CONSUMO_CONFIRMADO_SUPERVISOR" : "CONSUMO_RECHAZADO_SUPERVISOR",
      confirmar ? "Supervisor confirmó el consumo. No corresponde devolución ni reintegro de stock." : "Supervisor rechazó el consumo: " + motivo, id, c.sub_skus);
    return { ...c, estado, asignacion_consumida_id: consumedId };
  });
}
export async function listarConsumos(scope: "supervisor" | "operario" | "bodega", actorId: string, query: Record<string, unknown>) {
  if (!await consumosHabilitados()) return { habilitado: false, items: [], pendientes: 0, hasMore: false, page: 1 };
  const page = Number(query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new ConsumoError("Página inválida.");
  const estado = String(query.estado || "todos");
  if (!["todos","pendiente","confirmado","rechazado"].includes(estado)) throw new ConsumoError("Estado inválido.");
  const owner = scope === "supervisor" ? Prisma.sql`c.jefe_obra_id=${actorId}::uuid`
    : scope === "operario" ? Prisma.sql`c.trabajador_id=${actorId}::uuid` : Prisma.sql`TRUE`;
  const obra = query.obraId ? Prisma.sql`AND c.obra_id=${uuid(query.obraId)}::uuid` : Prisma.empty;
  const condition = estado === "todos" ? Prisma.empty : Prisma.sql`AND c.estado=${estado}`;
  const items = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT c.*,a.tipo_item,
    COALESCE(e.item,i.item,h.nombre) AS nombre,o.nombre AS obra,t.nombre AS operario,s.nombre AS supervisor,
    r.nombre AS resuelto_por
    FROM consumos_inventario_beck c JOIN asignaciones_inventario_beck a ON a.id=c.asignacion_id
    JOIN obras o ON o.id=c.obra_id JOIN usuarios t ON t.id=c.trabajador_id JOIN usuarios s ON s.id=c.jefe_obra_id
    LEFT JOIN usuarios r ON r.id=c.resuelto_por_id
    LEFT JOIN inventario_beck_epp e ON e.id=a.epp_id LEFT JOIN inventario_beck_implementos i ON i.id=a.implemento_id LEFT JOIN inventario_beck_herramientas h ON h.id=a.herramienta_id
    WHERE ${owner} ${obra} ${condition}
    ORDER BY c.solicitado_at DESC,c.id DESC LIMIT 51 OFFSET ${(page-1)*50}`);
  const [count] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM consumos_inventario_beck c WHERE ${owner} ${obra} AND c.estado='pendiente'`);
  return { habilitado: true, items: items.slice(0,50), hasMore: items.length > 50, pendientes: count.total, page };
}
