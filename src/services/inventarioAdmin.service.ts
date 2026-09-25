import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { InventarioBeckError } from "./inventarioBeck.service";
import { trazabilidadBodega, uuidBodega } from "./bodegaBeck.service";

const persona = { select: { id: true, nombre: true } } as const;
export function filtrosInventarioAdmin(query: Record<string, unknown>) {
  const obraId = uuidBodega(query.obraId);
  const vista = query.vista ?? "asignados";
  if (typeof vista !== "string" || !["asignados", "supervisores", "operarios", "devueltos", "consumidos", "todos"].includes(vista))
    throw new InventarioBeckError("Filtro de asignaciones inválido.");
  if (query.q != null && (typeof query.q !== "string" || query.q.length > 100))
    throw new InventarioBeckError("La búsqueda admite hasta 100 caracteres.");
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const cursor = query.cursor ? uuidBodega(query.cursor) : null;
  const text = { contains: q, mode: "insensitive" as const };
  const where: Prisma.asignaciones_inventario_beckWhereInput = {
    obra_id: obraId,
    ...(vista === "todos" ? {} : { estado: vista === "devueltos" ? "devuelto" : vista === "consumidos" ? "consumido" : "asignado" }),
    ...(vista === "supervisores" ? { trabajador_id: null } : vista === "operarios" ? { trabajador_id: { not: null } } : {}),
    ...(q ? { OR: [
      { inventario_beck_epp: { OR: [{ item: text }, { sku: text }] } },
      { inventario_beck_implementos: { OR: [{ item: text }, { sku: text }] } },
      { inventario_beck_herramientas: { OR: [{ nombre: text }, { sku: text }] } },
      { usuarios_asignaciones_inventario_beck_asignado_por_idTousuarios: { nombre: text } },
      { usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: { nombre: text } },
      { usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: { nombre: text } },
      { sub_skus: { has: q } },
    ] } : {}),
  };
  return { obraId, where, cursor };
}

export async function obrasInventarioAdmin() {
  // Incluye obras sin asignaciones y pausadas/cerradas: el administrador puede
  // comprobar explícitamente que una obra aún no registra inventario.
  return prisma.obras.findMany({
    select: { id: true, nombre: true, codigo: true, estado: true },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
}

export async function resumenInventarioAdmin(obraId: string) {
  const grupos = await prisma.asignaciones_inventario_beck.groupBy({
    by: ["estado", "trabajador_id", "jefe_obra_id"], where: { obra_id: obraId }, _sum: { cantidad: true },
  });
  const resultado = { conSupervisores: 0, conOperarios: 0, devueltas: 0, consumidas: 0, supervisores: 0, operarios: 0 };
  const supervisores = new Set<string>(), operarios = new Set<string>();
  for (const grupo of grupos) {
    const cantidad = grupo._sum.cantidad || 0;
    if (grupo.estado === "consumido") resultado.consumidas += cantidad;
    else if (grupo.estado === "devuelto") resultado.devueltas += cantidad;
    else if (grupo.estado === "asignado") {
      supervisores.add(grupo.jefe_obra_id);
      if (grupo.trabajador_id) { operarios.add(grupo.trabajador_id); resultado.conOperarios += cantidad; }
      else resultado.conSupervisores += cantidad;
    }
  }
  return { ...resultado, supervisores: supervisores.size, operarios: operarios.size };
}

export async function asignacionesInventarioAdmin(query: Record<string, unknown>) {
  const { obraId, where, cursor } = filtrosInventarioAdmin(query);
  const [rows, resumen] = await Promise.all([
    prisma.asignaciones_inventario_beck.findMany({
      where, take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: {
        id: true, tipo_item: true, cantidad: true, estado: true, sub_skus: true,
        created_at: true, reasignado_at: true, devuelto_at: true, observacion: true,
        recepcion_confirmada_at: true, devolucion_solicitada_at: true, devolucion_recibida_at: true,
        devolucion_motivo: true,
        inventario_beck_epp: { select: { item: true, sku: true, talla: true, modelo_marca: true } },
        inventario_beck_implementos: { select: { item: true, sku: true, talla_medida: true, modelo_marca: true } },
        inventario_beck_herramientas: { select: { nombre: true, sku: true, marca: true, modelo: true } },
        usuarios_asignaciones_inventario_beck_asignado_por_idTousuarios: persona,
        usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: persona,
        usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: persona,
        consumos: { orderBy: [{ solicitado_at: "desc" }, { id: "desc" }], take: 1,
          select: { id: true, estado: true, cantidad: true, observacion: true, motivo_rechazo: true, solicitado_at: true, resuelto_at: true } },
      },
    }),
    cursor ? Promise.resolve(undefined) : resumenInventarioAdmin(obraId),
  ]);
  const items = rows.slice(0, 50).map(a => ({
    id: a.id, tipo: a.tipo_item, cantidad: a.cantidad, estado: a.estado,
    nombre: a.inventario_beck_epp?.item ?? a.inventario_beck_implementos?.item ?? a.inventario_beck_herramientas?.nombre ?? "Artículo",
    sku: a.inventario_beck_epp?.sku ?? a.inventario_beck_implementos?.sku ?? a.inventario_beck_herramientas?.sku ?? null,
    detalle: [a.inventario_beck_epp?.modelo_marca ?? a.inventario_beck_implementos?.modelo_marca ?? a.inventario_beck_herramientas?.marca, a.inventario_beck_epp?.talla ?? a.inventario_beck_implementos?.talla_medida ?? a.inventario_beck_herramientas?.modelo].filter(Boolean).join(" · "),
    entregadoPor: a.usuarios_asignaciones_inventario_beck_asignado_por_idTousuarios,
    supervisor: a.usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios,
    operario: a.usuarios_asignaciones_inventario_beck_trabajador_idTousuarios,
    subSkus: a.sub_skus, fecha: a.created_at, entregadoOperarioAt: a.reasignado_at,
    devueltoAt: a.devuelto_at, observacion: a.observacion,
    recepcionConfirmadaAt: a.recepcion_confirmada_at,
    devolucionPendiente: a.estado === "asignado" && !!a.devolucion_solicitada_at && !a.devolucion_recibida_at,
    devolucionMotivo: a.devolucion_motivo,
    ultimoConsumo: a.consumos[0] ?? null,
  }));
  return { items, resumen, nextCursor: rows.length > 50 ? items[items.length - 1].id : null };
}

export async function trazabilidadInventarioAdmin(id: unknown, query: Record<string, unknown>) {
  const obraId = uuidBodega(query.obraId), asignacionId = uuidBodega(id);
  const a = await prisma.asignaciones_inventario_beck.findFirst({ where: { id: asignacionId, obra_id: obraId }, select: { id: true } });
  if (!a) throw new InventarioBeckError("La asignación no pertenece a esta obra.", 404);
  const page = await trazabilidadBodega(asignacionId, query.page ?? 1, obraId);
  return { ...page, items: page.items.map(e => ({
    id: e.id, accion: e.accion, cantidad: e.cantidad, detalle: e.detalle, fecha: e.created_at,
    actor: e.usuarios_trazabilidad_inventario_beck_actor_idTousuarios.nombre,
    supervisor: e.usuarios_trazabilidad_inventario_beck_jefe_obra_idTousuarios.nombre,
    operario: e.usuarios_trazabilidad_inventario_beck_trabajador_idTousuarios?.nombre ?? null,
  })) };
}
