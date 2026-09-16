import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  InventarioBeckError,
  parseLineasInventario,
} from "./inventarioBeck.service";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";

type Tx = Prisma.TransactionClient;
export type TipoBodega = "epp" | "implemento" | "herramienta";
const tablas = {
  epp: "inventario_beck_epp",
  implemento: "inventario_beck_implementos",
  herramienta: "inventario_beck_herramientas",
};
const camposItem = {
  epp: "epp_id",
  implemento: "implemento_id",
  herramienta: "herramienta_id",
};
type Item = {
  id: string;
  sku: string | null;
  nombre: string;
  saldo: number;
  activo: boolean;
  unidades_generadas?: number;
  sub_sku_unidad?: string | null;
};
export function tipoBodega(value: unknown): TipoBodega {
  if (value !== "epp" && value !== "implemento" && value !== "herramienta")
    throw new InventarioBeckError("Tipo de artículo inválido.");
  return value;
}
export function uuidBodega(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  )
    throw new InventarioBeckError("Identificador inválido.");
  return value;
}
export function enteroBodega(value: unknown, min = 0): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  )
    throw new InventarioBeckError("Ingresa una cantidad válida.");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || Math.abs(n) > 1000000)
    throw new InventarioBeckError("La cantidad debe ser un entero válido.");
  return n;
}
const texto = (v: unknown, max = 255) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const tabla = (tipo: TipoBodega) => Prisma.raw(tablas[tipo]);
const columnaNombre = (tipo: TipoBodega) =>
  Prisma.raw(tipo === "herramienta" ? "nombre" : "item");
const campoItem = (tipo: TipoBodega) => Prisma.raw(camposItem[tipo]);

async function itemTx(tx: Tx, tipo: TipoBodega, id: string): Promise<Item> {
  const rows = await tx.$queryRaw<Item[]>(
    Prisma.sql`SELECT *, ${columnaNombre(tipo)} AS nombre FROM ${tabla(tipo)} WHERE id=${id}::uuid FOR UPDATE`,
  );
  if (!rows[0]) throw new InventarioBeckError("Artículo no encontrado.", 404);
  return rows[0];
}

async function registrar(
  tx: Tx,
  actorId: string,
  accion: string,
  datos: Record<string, unknown>,
  requestId: string,
) {
  const tipo =
    accion === "ASIGNADO_SUPERVISOR"
      ? "ASIGNACION_INVENTARIO_CREADA"
      : accion === "DEVOLUCION_RECIBIDA_BODEGA"
        ? "ASIGNACION_INVENTARIO_DEVUELTA"
        : "REGISTRO_CREADO";
  await tx.$executeRaw(Prisma.sql`INSERT INTO movimientos_crm (id, usuario_id, modulo, tipo, descripcion, datos, created_at)
    VALUES (${requestId}::uuid, ${actorId}::uuid, 'INVENTARIO', ${tipo}::"TipoMovimientoCRM", ${`Bodega BECK · ${accion}`}, ${JSON.stringify({ ...datos, accion, origen: "app_bodega_beck" })}::jsonb, NOW())`);
}

// Comparte el bloqueo con la asignación del CRM. La clave de operación permite reintentar sin duplicar entregas.
async function operar<T>(
  actorId: string,
  requestId: unknown,
  accion: string,
  payload: unknown,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const key = uuidBodega(requestId);
  const normalizedPayload: unknown = JSON.parse(JSON.stringify(payload));
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(749182)::text`;
      const prev = await tx.$queryRaw<
        {
          usuario_id: string;
          datos: { accion: string; payload: unknown; resultado: T };
        }[]
      >`SELECT usuario_id, datos FROM movimientos_crm WHERE id=${key}::uuid`;
      if (prev[0]) {
        if (
          prev[0].usuario_id !== actorId ||
          prev[0].datos.accion !== accion ||
          estable(prev[0].datos.payload) !== estable(normalizedPayload)
        )
          throw new InventarioBeckError(
            "La operación ya fue utilizada con otros datos.",
            409,
          );
        return prev[0].datos.resultado;
      }
      const result = await fn(tx);
      await registrar(
        tx,
        actorId,
        accion,
        { payload: normalizedPayload, resultado: result },
        key,
      );
      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    },
  );
}
function estable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(estable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${estable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function listarBodega(
  tipoRaw: unknown,
  q: unknown,
  pagina: unknown,
  activo: unknown,
) {
  const tipo = tipoBodega(tipoRaw),
    page = enteroBodega(pagina ?? 1, 1),
    search = `%${texto(q, 100)}%`;
  const estado =
    activo === "todos"
      ? Prisma.empty
      : Prisma.sql`AND i.activo=${activo !== "false"}`;
  const rows = await prisma.$queryRaw<
    Record<string, unknown>[]
  >(Prisma.sql`SELECT i.*, i.${columnaNombre(tipo)} AS nombre,
    ${tipo === "herramienta" ? Prisma.sql`CASE WHEN EXISTS(SELECT 1 FROM asignaciones_inventario_beck a WHERE a.herramienta_id=i.id AND a.estado='asignado') THEN 0 ELSE 1 END` : Prisma.sql`i.saldo`} AS disponible
    FROM ${tabla(tipo)} i WHERE (i.${columnaNombre(tipo)} ILIKE ${search} OR i.sku ILIKE ${search}) ${estado}
    ORDER BY i.${columnaNombre(tipo)}, i.id LIMIT 51 OFFSET ${(page - 1) * 50}`);
  return { items: rows.slice(0, 50), hasMore: rows.length > 50, page };
}

export async function opcionesBodega() {
  const [obras, supervisores] = await Promise.all([
    prisma.obras.findMany({
      where: { estado: { in: ["activa", "pausada"] } },
      select: { id: true, nombre: true, codigo: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.usuarios.findMany({
      where: {
        rol: "jefeobra",
        activo: true,
        email: { endsWith: "@becksoluciones.cl", mode: "insensitive" },
      },
      select: { id: true, nombre: true, email: true },
      orderBy: { nombre: "asc" },
    }),
  ]);
  return { obras, supervisores };
}

export async function guardarArticulo(
  actorId: string,
  tipoRaw: unknown,
  idRaw: unknown,
  body: Record<string, unknown>,
) {
  const tipo = tipoBodega(tipoRaw),
    id = idRaw ? uuidBodega(idRaw) : null;
  const nombre = texto(body.nombre);
  if (!nombre)
    throw new InventarioBeckError("El nombre del artículo es obligatorio.");
  if (body.activo !== undefined && typeof body.activo !== "boolean")
    throw new InventarioBeckError("Estado inválido.");
  const campos: Record<string, unknown> = {
    [tipo === "herramienta" ? "nombre" : "item"]: nombre,
    ...(!id || body.activo !== undefined
      ? { activo: body.activo !== false }
      : {}),
  };
  const permitidos =
    tipo === "herramienta"
      ? ["marca", "modelo", "categoria", "ubicacion"]
      : tipo === "epp"
        ? ["modelo_marca", "unidad_medida", "talla", "color"]
        : [
            "modelo_marca",
            "unidad_medida",
            "talla_medida",
            "color",
            "ubicacion",
          ];
  for (const c of permitidos)
    if (body[c] !== undefined)
      campos[c] =
        texto(
          body[c],
          ["marca", "modelo", "categoria"].includes(c)
            ? 150
            : ["talla", "talla_medida", "color", "unidad_medida"].includes(c)
              ? 100
              : 255,
        ) || null;
  for (const c of tipo === "herramienta"
    ? ["fecha_compra", "fecha_mantencion"]
    : tipo === "implemento"
      ? ["fecha"]
      : []) {
    if (body[c] === undefined) continue;
    const fecha = texto(body[c], 10);
    if (
      fecha &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
        Number.isNaN(new Date(`${fecha}T00:00:00Z`).getTime()) ||
        new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) !== fecha)
    )
      throw new InventarioBeckError(
        "La fecha debe tener formato AAAA-MM-DD y ser válida.",
      );
    campos[c] = fecha ? new Date(`${fecha}T00:00:00Z`) : null;
  }
  return operar(
    actorId,
    body.requestId,
    id ? "ARTICULO_EDITADO" : "ARTICULO_CREADO",
    { tipo, id, campos, stock: body.stock ?? 0 },
    async (tx) => {
      if (id) {
        await itemTx(tx, tipo, id);
        if (campos.activo === false) {
          const asignada = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM asignaciones_inventario_beck WHERE ${campoItem(tipo)}=${id}::uuid AND estado='asignado' LIMIT 1`,
          );
          if (asignada.length)
            throw new InventarioBeckError(
              "No puedes desactivar un artículo con asignaciones activas.",
              409,
            );
        }
        await tx.$executeRaw(
          Prisma.sql`UPDATE ${tabla(tipo)} SET ${Prisma.join(Object.entries(campos).map(([k, v]) => Prisma.sql`${Prisma.raw(k)}=${v}`))}, updated_at=NOW() WHERE id=${id}::uuid`,
        );
        return { id };
      }
      if (tipo !== "herramienta") {
        const stock = enteroBodega(body.stock ?? 0);
        campos[tipo === "epp" ? "stock_inicial" : "cantidad"] = stock;
        campos.saldo = stock;
      }
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO ${tabla(tipo)} (${Prisma.join(Object.keys(campos).map((k) => Prisma.raw(k)))}) VALUES (${Prisma.join(Object.values(campos))}) RETURNING id`,
      );
      return rows[0];
    },
  );
}

export async function ajustarStock(
  actorId: string,
  tipoRaw: unknown,
  idRaw: unknown,
  body: Record<string, unknown>,
) {
  const tipo = tipoBodega(tipoRaw),
    id = uuidBodega(idRaw),
    delta = enteroBodega(body.cantidad, -1000000),
    motivo = texto(body.motivo, 1000);
  if (tipo === "herramienta" || !delta || !motivo)
    throw new InventarioBeckError(
      "Indica el movimiento y su motivo. Las herramientas son activos individuales.",
    );
  return operar(
    actorId,
    body.requestId,
    "STOCK_AJUSTADO",
    { tipo, id, delta, motivo },
    async (tx) => {
      const item = await itemTx(tx, tipo, id);
      if (!item.activo || item.saldo + delta < 0)
        throw new InventarioBeckError(
          "Stock insuficiente o artículo inactivo.",
          409,
        );
      const campo =
        tipo === "epp"
          ? delta > 0
            ? "entrada"
            : "salida"
          : delta > 0
            ? "cantidad"
            : "salida";
      await tx.$executeRaw(
        Prisma.sql`UPDATE ${tabla(tipo)} SET saldo=saldo+${delta}, ${Prisma.raw(campo)}=${Prisma.raw(campo)}+${Math.abs(delta)}, updated_at=NOW() WHERE id=${id}::uuid`,
      );
      return { id, stockAnterior: item.saldo, stockActual: item.saldo + delta };
    },
  );
}

export async function generarSkuBodega(
  actorId: string,
  tipoRaw: unknown,
  idRaw: unknown,
  requestId: unknown,
) {
  const tipo = tipoBodega(tipoRaw),
    id = uuidBodega(idRaw);
  return operar(
    actorId,
    requestId,
    "SKU_GENERADO",
    { tipo, id },
    async (tx) => {
      const item = await itemTx(tx, tipo, id);
      if (item.sku) return { id, sku: item.sku };
      const inicio =
        tipo === "epp" ? 900000 : tipo === "implemento" ? 800000 : 700000;
      const rows = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COALESCE(MAX(CASE WHEN sku ~ ${`^${String(inicio)[0]}[0-9]{5}$`} THEN sku::int END), ${inicio})::int AS n FROM ${tabla(tipo)}`,
      );
      const sku = String(rows[0].n + 1);
      if (Number(sku) >= inicio + 100000)
        throw new InventarioBeckError("Se agotó el rango de códigos.");
      await tx.$executeRaw(
        Prisma.sql`UPDATE ${tabla(tipo)} SET sku=${sku}, updated_at=NOW() WHERE id=${id}::uuid`,
      );
      return { id, sku };
    },
  );
}

export async function asignarDesdeBodega(
  actorId: string,
  body: Record<string, unknown>,
) {
  const obraId = uuidBodega(body.obraId),
    supervisorId = uuidBodega(body.supervisorId),
    lineas = parseLineasInventario(body.lineas);
  if (lineas.length > 50 || lineas.some((l) => l.subSku || l.cantidad > 1000))
    throw new InventarioBeckError(
      "Máximo 50 artículos y 1000 unidades por línea. Selecciona el artículo de bodega.",
    );
  for (const [i, l] of lineas.entries()) {
    uuidBodega(l.itemId);
    enteroBodega((body.lineas as Record<string, unknown>[])[i].cantidad, 1);
  }
  return operar(
    actorId,
    body.requestId,
    "ASIGNADO_SUPERVISOR",
    {
      obraId,
      supervisorId,
      lineas,
      observacion: texto(body.observacion, 1000),
    },
    async (tx) => {
      const [obra, supervisor] = await Promise.all([
        tx.obras.findFirst({
          where: { id: obraId, estado: { in: ["activa", "pausada"] } },
        }),
        tx.usuarios.findFirst({
          where: {
            id: supervisorId,
            rol: "jefeobra",
            activo: true,
            email: { endsWith: "@becksoluciones.cl", mode: "insensitive" },
          },
        }),
      ]);
      if (!obra || !supervisor)
        throw new InventarioBeckError(
          "Selecciona una obra activa/pausada y un supervisor BECK activo.",
        );
      const ids: string[] = [];
      for (const l of lineas) {
        const tipo = tipoBodega(l.tipoItem),
          item = await itemTx(tx, tipo, l.itemId);
        if (!item.activo || !item.sku)
          throw new InventarioBeckError(
            "El artículo debe estar activo y tener SKU antes de asignarlo.",
          );
        let subSkus: string[];
        if (tipo === "herramienta") {
          const actual = await tx.asignaciones_inventario_beck.findFirst({
            where: { herramienta_id: item.id, estado: "asignado" },
          });
          if (actual)
            throw new InventarioBeckError(
              "La herramienta ya está asignada. Debe devolverse antes de entregarla nuevamente.",
              409,
            );
          subSkus = [item.sub_sku_unidad || `${item.sku}-1`];
          await tx.inventario_beck_herramientas.update({
            where: { id: item.id },
            data: { encargado: supervisor.nombre, sub_sku_unidad: subSkus[0] },
          });
        } else {
          if (item.saldo < l.cantidad)
            throw new InventarioBeckError(
              `Stock insuficiente de ${item.nombre}.`,
              409,
            );
          const anteriores = await tx.$queryRaw<
            { codigo: string }[]
          >(Prisma.sql`SELECT DISTINCT unnest(a.sub_skus) AS codigo FROM asignaciones_inventario_beck a
          WHERE a.${campoItem(tipo)}=${item.id}::uuid AND a.estado='devuelto'
          EXCEPT SELECT unnest(a.sub_skus) FROM asignaciones_inventario_beck a WHERE a.${campoItem(tipo)}=${item.id}::uuid AND a.estado='asignado'`);
          const reutilizados = anteriores
            .map((r) => r.codigo)
            .sort()
            .slice(0, l.cantidad);
          const nuevas = l.cantidad - reutilizados.length;
          subSkus = [
            ...reutilizados,
            ...Array.from(
              { length: nuevas },
              (_, i) => `${item.sku}-${(item.unidades_generadas || 0) + i + 1}`,
            ),
          ];
          await tx.$executeRaw(
            Prisma.sql`UPDATE ${tabla(tipo)} SET saldo=saldo-${l.cantidad}, salida=salida+${l.cantidad}, unidades_generadas=unidades_generadas+${nuevas}, updated_at=NOW() WHERE id=${item.id}::uuid`,
          );
        }
        const asignacion = await tx.asignaciones_inventario_beck.create({
          data: {
            obra_id: obraId,
            jefe_obra_id: supervisorId,
            asignado_por_id: actorId,
            tipo_item: tipo,
            epp_id: tipo === "epp" ? item.id : null,
            implemento_id: tipo === "implemento" ? item.id : null,
            herramienta_id: tipo === "herramienta" ? item.id : null,
            cantidad: l.cantidad,
            sub_skus: subSkus,
            observacion: texto(body.observacion, 1000) || null,
          },
        });
        await tx.trazabilidad_inventario_beck.create({
          data: {
            asignacion_id: asignacion.id,
            obra_id: obraId,
            actor_id: actorId,
            jefe_obra_id: supervisorId,
            accion: "ASIGNADO_SUPERVISOR",
            cantidad: l.cantidad,
            detalle: "Bodega entregó al supervisor desde la app",
            datos: { subSkus },
          },
        });
        ids.push(asignacion.id);
      }
      await tx.usuarios_obras.upsert({
        where: {
          usuario_id_obra_id: { usuario_id: supervisorId, obra_id: obraId },
        },
        create: { usuario_id: supervisorId, obra_id: obraId },
        update: {},
      });
      return { ids };
    },
  );
}

export async function listarAsignacionesBodega(query: Record<string, unknown>) {
  const page = enteroBodega(query.page ?? 1, 1);
  const where: Prisma.asignaciones_inventario_beckWhereInput = {
    ...(query.obraId ? { obra_id: uuidBodega(query.obraId) } : {}),
    ...(query.supervisorId
      ? { jefe_obra_id: uuidBodega(query.supervisorId) }
      : {}),
    ...(query.estado === "devuelto"
      ? { estado: "devuelto" }
      : query.estado === "todos"
        ? {}
        : { estado: "asignado" }),
    ...(query.estado === "por_recibir"
      ? {
          trabajador_id: null,
          devolucion_solicitada_at: { not: null },
          devolucion_recibida_at: null,
        }
      : {}),
  };
  const items = await prisma.asignaciones_inventario_beck.findMany({
    where,
    take: 51,
    skip: (page - 1) * 50,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    include: {
      inventario_beck_epp: true,
      inventario_beck_implementos: true,
      inventario_beck_herramientas: true,
      obras: { select: { nombre: true } },
      usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: {
        select: { nombre: true },
      },
      usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: {
        select: { nombre: true },
      },
    },
  });
  return {
    page,
    hasMore: items.length > 50,
    items: items
      .slice(0, 50)
      .map((a) => ({
        id: a.id,
        nombre:
          a.inventario_beck_epp?.item ||
          a.inventario_beck_implementos?.item ||
          a.inventario_beck_herramientas?.nombre,
        cantidad: a.cantidad,
        estado: a.estado,
        pendienteBodega:
          a.estado === "asignado" &&
          !a.trabajador_id &&
          !!a.devolucion_solicitada_at &&
          !a.devolucion_recibida_at,
        obra: a.obras.nombre,
        supervisor:
          a.usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios.nombre,
        operario:
          a.usuarios_asignaciones_inventario_beck_trabajador_idTousuarios
            ?.nombre,
        subSkus: a.sub_skus,
        fecha: a.created_at,
        motivo: a.devolucion_motivo,
      })),
  };
}

export async function recibirBodega(
  actorId: string,
  idRaw: unknown,
  requestId: unknown,
) {
  const id = uuidBodega(idRaw);
  return operar(
    actorId,
    requestId,
    "DEVOLUCION_RECIBIDA_BODEGA",
    { id },
    async (tx) => {
      const a = await tx.asignaciones_inventario_beck.findUnique({
        where: { id },
      });
      if (
        !a ||
        a.estado !== "asignado" ||
        a.trabajador_id ||
        !a.devolucion_solicitada_at ||
        a.devolucion_recibida_at
      )
        throw new InventarioBeckError(
          "La asignación no tiene una devolución pendiente de bodega.",
          409,
        );
      const tipo = tipoBodega(a.tipo_item),
        itemId = (a.epp_id || a.implemento_id || a.herramienta_id)!;
      await itemTx(tx, tipo, itemId);
      await tx.asignaciones_inventario_beck.update({
        where: { id },
        data: {
          estado: "devuelto",
          devuelto_at: new Date(),
          devuelto_por_id: actorId,
          devolucion_recibida_at: new Date(),
          devolucion_recibida_por_id: actorId,
        },
      });
      if (tipo === "herramienta")
        await tx.inventario_beck_herramientas.update({
          where: { id: itemId },
          data: { encargado: null },
        });
      else
        await tx.$executeRaw(
          Prisma.sql`UPDATE ${tabla(tipo)} SET saldo=saldo+${a.cantidad}, salida=GREATEST(0,salida-${a.cantidad}), updated_at=NOW() WHERE id=${itemId}::uuid`,
        );
      await tx.trazabilidad_inventario_beck.create({
        data: {
          asignacion_id: id,
          obra_id: a.obra_id,
          actor_id: actorId,
          jefe_obra_id: a.jefe_obra_id,
          accion: "DEVUELTO_BODEGA",
          cantidad: a.cantidad,
          detalle: "Bodeguero confirmó recepción física",
          datos: { subSkus: a.sub_skus },
        },
      });
      return { id, cantidad: a.cantidad };
    },
  );
}

export async function historialBodega(actorId: string, pagina: unknown) {
  const page = enteroBodega(pagina ?? 1, 1);
  const items = await prisma.$queryRaw<
    Record<string, unknown>[]
  >`SELECT id, descripcion, datos, created_at FROM movimientos_crm WHERE usuario_id=${actorId}::uuid AND modulo='INVENTARIO' ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ${(page - 1) * 50}`;
  return { items: items.slice(0, 50), hasMore: items.length > 50, page };
}

export async function trazabilidadBodega(id: unknown, pagina: unknown) {
  const page = enteroBodega(pagina ?? 1, 1);
  const asignacion = await prisma.asignaciones_inventario_beck.findUnique({
    where: { id: uuidBodega(id) },
  });
  if (!asignacion)
    throw new InventarioBeckError("Asignación no encontrada.", 404);
  const linaje: Prisma.trazabilidad_inventario_beckWhereInput[] = [
    { asignacion_id: asignacion.id },
  ];
  // Conserva el recorrido de las unidades aunque un lote haya sido dividido o reasignado.
  if (asignacion.sub_skus.length)
    linaje.push({
      asignaciones_inventario_beck: {
        sub_skus: { hasSome: asignacion.sub_skus },
      },
    });
  const visitados = new Set([asignacion.id]);
  let origenId = asignacion.asignacion_origen_id,
    limite = asignacion.created_at;
  while (origenId && !visitados.has(origenId)) {
    visitados.add(origenId);
    linaje.push({ asignacion_id: origenId, created_at: { lte: limite } });
    const origen = await prisma.asignaciones_inventario_beck.findUnique({
      where: { id: origenId },
    });
    if (!origen) break;
    origenId = origen.asignacion_origen_id;
    limite = origen.created_at;
  }
  const items = await prisma.trazabilidad_inventario_beck.findMany({
    where: { OR: linaje },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 51,
    skip: (page - 1) * 50,
    include: {
      usuarios_trazabilidad_inventario_beck_actor_idTousuarios: {
        select: { nombre: true },
      },
    },
  });
  return { page, hasMore: items.length > 50, items: items.slice(0, 50) };
}

export async function resumenBodega() {
  const [epp, implementos, herramientas, pendientes] = await Promise.all([
    prisma.inventario_beck_epp.aggregate({
      where: { activo: true },
      _sum: { saldo: true },
    }),
    prisma.inventario_beck_implementos.aggregate({
      where: { activo: true },
      _sum: { saldo: true },
    }),
    prisma.inventario_beck_herramientas.count({
      where: {
        activo: true,
        asignaciones_inventario_beck: { none: { estado: "asignado" } },
      },
    }),
    prisma.asignaciones_inventario_beck.count({
      where: {
        estado: "asignado",
        trabajador_id: null,
        devolucion_solicitada_at: { not: null },
        devolucion_recibida_at: null,
      },
    }),
  ]);
  return {
    epp: epp._sum.saldo || 0,
    implementos: implementos._sum.saldo || 0,
    herramientas,
    pendientes,
  };
}

export async function etiquetasBodega(query: Record<string, unknown>) {
  let codigos: string[] = [],
    nombre = "BECK Soluciones";
  if (query.asignacionId) {
    const a = await prisma.asignaciones_inventario_beck.findUnique({
      where: { id: uuidBodega(query.asignacionId) },
      include: {
        inventario_beck_epp: true,
        inventario_beck_implementos: true,
        inventario_beck_herramientas: true,
      },
    });
    if (!a) throw new InventarioBeckError("Asignación no encontrada.", 404);
    codigos = a.sub_skus;
    nombre =
      a.inventario_beck_epp?.item ||
      a.inventario_beck_implementos?.item ||
      a.inventario_beck_herramientas?.nombre ||
      nombre;
  } else {
    const tipo = tipoBodega(query.tipo),
      id = uuidBodega(query.id);
    const rows = await prisma.$queryRaw<Item[]>(
      Prisma.sql`SELECT sku, ${columnaNombre(tipo)} AS nombre FROM ${tabla(tipo)} WHERE id=${id}::uuid`,
    );
    if (rows[0]?.sku) {
      codigos = [rows[0].sku];
      nombre = rows[0].nombre;
    }
  }
  if (!codigos.length)
    throw new InventarioBeckError(
      "Genera el SKU antes de descargar sus etiquetas.",
    );
  if (codigos.length > 1000)
    throw new InventarioBeckError("Máximo 1000 etiquetas por descarga.");
  const doc = new PDFDocument({ size: "A4", margin: 30 });
  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  try {
    for (let i = 0; i < codigos.length; i++) {
      if (i > 0 && i % 12 === 0) doc.addPage();
      const x = 30 + (i % 2) * 267,
        y = 30 + Math.floor((i % 12) / 2) * 128;
      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: codigos[i],
        scale: 3,
        height: 10,
        includetext: true,
        paddingwidth: 12,
        paddingheight: 3,
      });
      doc.roundedRect(x, y, 255, 116, 6).strokeColor("#d1d5db").stroke();
      doc
        .fontSize(9)
        .fillColor("#111827")
        .text(`BECK · ${nombre}`, x + 10, y + 8, {
          width: 235,
          height: 26,
          ellipsis: true,
        });
      doc.image(png, x + 10, y + 38, { fit: [235, 65], align: "center" });
    }
    doc.end();
    return await output;
  } catch (e) {
    doc.destroy();
    throw e;
  }
}
