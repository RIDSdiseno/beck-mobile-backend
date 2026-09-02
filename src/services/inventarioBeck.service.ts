import { Prisma, TipoInventarioBeck } from "@prisma/client";

import { prisma } from "../config/prisma";

type LineaAsignacion = {
  tipoItem: TipoInventarioBeck;
  itemId: string;
  cantidad: number;
};

const TIPOS_VALIDOS = new Set<string>(Object.values(TipoInventarioBeck));

export class InventarioBeckError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "InventarioBeckError";
  }
}

function nombreItem(asignacion: {
  inventario_beck_epp?: { item: string } | null;
  inventario_beck_implementos?: { item: string } | null;
  inventario_beck_herramientas?: { nombre: string } | null;
}) {
  return asignacion.inventario_beck_epp?.item
    ?? asignacion.inventario_beck_implementos?.item
    ?? asignacion.inventario_beck_herramientas?.nombre
    ?? "Item sin nombre";
}

export function parseLineasInventario(raw: unknown): LineaAsignacion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InventarioBeckError("Debes seleccionar al menos un item.");
  }

  const repetidos = new Set<string>();
  return raw.map((value, index) => {
    const linea = value as Record<string, unknown>;
    const tipoItem = typeof linea?.tipoItem === "string" ? linea.tipoItem : "";
    const itemId = typeof linea?.itemId === "string" ? linea.itemId.trim() : "";
    const cantidad = Number(linea?.cantidad);

    if (!TIPOS_VALIDOS.has(tipoItem)) {
      throw new InventarioBeckError(`Línea ${index + 1}: tipo de item inválido.`);
    }
    if (!itemId) {
      throw new InventarioBeckError(`Línea ${index + 1}: falta el item.`);
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw new InventarioBeckError(`Línea ${index + 1}: la cantidad debe ser mayor a cero.`);
    }
    if (tipoItem === TipoInventarioBeck.herramienta && cantidad !== 1) {
      throw new InventarioBeckError("Las herramientas se asignan de una en una.");
    }

    const clave = `${tipoItem}:${itemId}`;
    if (repetidos.has(clave)) {
      throw new InventarioBeckError("No repitas el mismo item en una asignación.");
    }
    repetidos.add(clave);

    return { tipoItem: tipoItem as TipoInventarioBeck, itemId, cantidad };
  });
}

const ITEM_SELECT = {
  inventario_beck_epp: {
    select: {
      id: true,
      item: true,
      sku: true,
      modelo_marca: true,
      talla: true,
      color: true,
      unidad_medida: true,
    },
  },
  inventario_beck_implementos: {
    select: {
      id: true,
      item: true,
      sku: true,
      modelo_marca: true,
      talla_medida: true,
      color: true,
      unidad_medida: true,
    },
  },
  inventario_beck_herramientas: {
    select: {
      id: true,
      nombre: true,
      sku: true,
      marca: true,
      modelo: true,
      categoria: true,
    },
  },
} satisfies Prisma.asignaciones_inventario_beckSelect;

function serializarItem(asignacion: any) {
  const epp = asignacion.inventario_beck_epp;
  const implemento = asignacion.inventario_beck_implementos;
  const herramienta = asignacion.inventario_beck_herramientas;
  const item = epp ?? implemento ?? herramienta;

  return {
    itemId: asignacion.epp_id ?? asignacion.implemento_id ?? asignacion.herramienta_id,
    tipoItem: asignacion.tipo_item,
    nombre: nombreItem(asignacion),
    sku: item?.sku ?? null,
    detalle: epp?.modelo_marca
      ?? implemento?.modelo_marca
      ?? [herramienta?.marca, herramienta?.modelo].filter(Boolean).join(" · ")
      ?? null,
    talla: epp?.talla ?? implemento?.talla_medida ?? null,
    color: epp?.color ?? implemento?.color ?? null,
    unidadMedida: epp?.unidad_medida ?? implemento?.unidad_medida ?? null,
  };
}

async function registrarEvento(
  tx: Prisma.TransactionClient,
  input: {
    asignacionId: string;
    obraId: string;
    actorId: string;
    jefeObraId: string;
    trabajadorId?: string | null;
    accion: string;
    cantidad: number;
    detalle: string;
    datos?: Prisma.InputJsonValue;
  },
) {
  return tx.trazabilidad_inventario_beck.create({
    data: {
      asignacion_id: input.asignacionId,
      obra_id: input.obraId,
      actor_id: input.actorId,
      jefe_obra_id: input.jefeObraId,
      trabajador_id: input.trabajadorId ?? null,
      accion: input.accion,
      cantidad: input.cantidad,
      detalle: input.detalle,
      datos: input.datos,
    },
  });
}

export async function listarObrasInventarioSupervisor(supervisorId: string) {
  const asignaciones = await prisma.asignaciones_inventario_beck.findMany({
    where: { jefe_obra_id: supervisorId },
    distinct: ["obra_id"],
    select: {
      obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return asignaciones
    .map((asignacion) => asignacion.obras)
    .filter((obra) => obra.estado === "activa" || obra.estado === "pausada")
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function listarDisponibleSupervisor(supervisorId: string, obraId: string) {
  const lotes = await prisma.asignaciones_inventario_beck.findMany({
    where: {
      jefe_obra_id: supervisorId,
      obra_id: obraId,
      estado: "asignado",
      trabajador_id: null,
    },
    select: {
      id: true,
      tipo_item: true,
      epp_id: true,
      implemento_id: true,
      herramienta_id: true,
      cantidad: true,
      ...ITEM_SELECT,
    },
    orderBy: { created_at: "asc" },
  });

  const agrupados = new Map<string, ReturnType<typeof serializarItem> & { disponible: number }>();
  for (const lote of lotes) {
    const item = serializarItem(lote);
    const clave = `${item.tipoItem}:${item.itemId}`;
    const anterior = agrupados.get(clave);
    agrupados.set(clave, { ...item, disponible: (anterior?.disponible ?? 0) + lote.cantidad });
  }

  return Array.from(agrupados.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function listarEntregadosSupervisor(supervisorId: string, obraId: string) {
  const asignaciones = await prisma.asignaciones_inventario_beck.findMany({
    where: {
      jefe_obra_id: supervisorId,
      obra_id: obraId,
      estado: "asignado",
      trabajador_id: { not: null },
    },
    select: {
      id: true,
      cantidad: true,
      observacion: true,
      created_at: true,
      reasignado_at: true,
      tipo_item: true,
      epp_id: true,
      implemento_id: true,
      herramienta_id: true,
      recepcion_confirmada_at: true,
      devolucion_solicitada_at: true,
      devolucion_motivo: true,
      usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: {
        select: { id: true, nombre: true, email: true },
      },
      ...ITEM_SELECT,
    },
    orderBy: [{ reasignado_at: "desc" }, { created_at: "desc" }],
  });

  return asignaciones.map((asignacion) => ({
    id: asignacion.id,
    ...serializarItem(asignacion),
    cantidad: asignacion.cantidad,
    observacion: asignacion.observacion,
    entregadoAt: asignacion.reasignado_at ?? asignacion.created_at,
    recepcionConfirmadaAt: asignacion.recepcion_confirmada_at,
    devolucionSolicitadaAt: asignacion.devolucion_solicitada_at,
    devolucionMotivo: asignacion.devolucion_motivo,
    trabajador: asignacion.usuarios_asignaciones_inventario_beck_trabajador_idTousuarios,
  }));
}

export async function listarOperariosObra(supervisorId: string, obraId: string) {
  const accesoSupervisor = await prisma.asignaciones_inventario_beck.findFirst({
    where: { jefe_obra_id: supervisorId, obra_id: obraId },
    select: { id: true },
  });
  if (!accesoSupervisor) throw new InventarioBeckError("No tienes inventario asignado en esta obra.", 403);

  const vinculaciones = await prisma.usuarios_obras.findMany({
    where: {
      obra_id: obraId,
      usuarios: { rol: "terreno", activo: true },
    },
    select: { usuarios: { select: { id: true, nombre: true, email: true } } },
    orderBy: { usuarios: { nombre: "asc" } },
  });

  return vinculaciones.map((vinculacion) => vinculacion.usuarios);
}

export async function listarAsignacionesOperario(operarioId: string) {
  const asignaciones = await prisma.asignaciones_inventario_beck.findMany({
    where: { trabajador_id: operarioId, estado: "asignado" },
    select: {
      id: true,
      cantidad: true,
      observacion: true,
      created_at: true,
      reasignado_at: true,
      tipo_item: true,
      epp_id: true,
      implemento_id: true,
      herramienta_id: true,
      recepcion_confirmada_at: true,
      devolucion_solicitada_at: true,
      devolucion_motivo: true,
      obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
      usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: {
        select: { id: true, nombre: true, email: true },
      },
      ...ITEM_SELECT,
    },
    orderBy: [{ reasignado_at: "desc" }, { created_at: "desc" }],
  });

  return asignaciones.map((asignacion) => ({
    id: asignacion.id,
    ...serializarItem(asignacion),
    cantidad: asignacion.cantidad,
    observacion: asignacion.observacion,
    entregadoAt: asignacion.reasignado_at ?? asignacion.created_at,
    recepcionConfirmadaAt: asignacion.recepcion_confirmada_at,
    devolucionSolicitadaAt: asignacion.devolucion_solicitada_at,
    devolucionMotivo: asignacion.devolucion_motivo,
    obra: asignacion.obras,
    supervisor: asignacion.usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios,
  }));
}

function whereItem(linea: LineaAsignacion) {
  if (linea.tipoItem === TipoInventarioBeck.epp) return { epp_id: linea.itemId };
  if (linea.tipoItem === TipoInventarioBeck.implemento) return { implemento_id: linea.itemId };
  return { herramienta_id: linea.itemId };
}

async function ejecutarAsignacion(
  supervisorId: string,
  obraId: string,
  trabajadorId: string,
  lineas: LineaAsignacion[],
  observacion: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const trabajadorEnObra = await tx.usuarios_obras.findFirst({
      where: {
        obra_id: obraId,
        usuario_id: trabajadorId,
        usuarios: { rol: "terreno", activo: true },
      },
      select: { id: true },
    });
    if (!trabajadorEnObra) {
      throw new InventarioBeckError("El operario no está asignado a esta obra.", 403);
    }

    const creadas: string[] = [];
    for (const linea of lineas) {
      if (linea.tipoItem === TipoInventarioBeck.herramienta) {
        const yaEntregada = await tx.asignaciones_inventario_beck.findFirst({
          where: {
            herramienta_id: linea.itemId,
            estado: "asignado",
            trabajador_id: { not: null },
          },
          select: { id: true },
        });
        if (yaEntregada) throw new InventarioBeckError("La herramienta ya está entregada a un operario.", 409);
      }

      const lotes = await tx.asignaciones_inventario_beck.findMany({
        where: {
          jefe_obra_id: supervisorId,
          obra_id: obraId,
          estado: "asignado",
          trabajador_id: null,
          ...whereItem(linea),
        },
        orderBy: { created_at: "asc" },
      });

      const disponible = lotes.reduce((total, lote) => total + lote.cantidad, 0);
      if (disponible < linea.cantidad) {
        throw new InventarioBeckError(`Stock insuficiente para la asignación (disponible: ${disponible}).`, 409);
      }

      let restante = linea.cantidad;
      for (const lote of lotes) {
        if (restante === 0) break;

        const cantidadMover = Math.min(restante, lote.cantidad);
        if (cantidadMover === lote.cantidad) {
          const actualizada = await tx.asignaciones_inventario_beck.updateMany({
            where: { id: lote.id, trabajador_id: null, estado: "asignado", cantidad: lote.cantidad },
            data: {
              trabajador_id: trabajadorId,
              reasignado_at: new Date(),
              recepcion_confirmada_at: null,
              recepcion_confirmada_por_id: null,
              devolucion_solicitada_at: null,
              devolucion_solicitada_por_id: null,
              devolucion_motivo: null,
              devolucion_recibida_at: null,
              devolucion_recibida_por_id: null,
              ...(observacion ? { observacion } : {}),
            },
          });
          if (actualizada.count !== 1) throw new InventarioBeckError("El stock cambió mientras asignabas. Intenta nuevamente.", 409);
          await registrarEvento(tx, {
            asignacionId: lote.id,
            obraId,
            actorId: supervisorId,
            jefeObraId: supervisorId,
            trabajadorId,
            accion: "ASIGNADO_OPERARIO",
            cantidad: cantidadMover,
            detalle: "Supervisor entregó el artículo al operario",
          });
          creadas.push(lote.id);
        } else {
          const reducida = await tx.asignaciones_inventario_beck.updateMany({
            where: { id: lote.id, trabajador_id: null, estado: "asignado", cantidad: lote.cantidad },
            data: { cantidad: { decrement: cantidadMover } },
          });
          if (reducida.count !== 1) throw new InventarioBeckError("El stock cambió mientras asignabas. Intenta nuevamente.", 409);

          const creada = await tx.asignaciones_inventario_beck.create({
            data: {
              obra_id: obraId,
              jefe_obra_id: supervisorId,
              asignado_por_id: lote.asignado_por_id,
              tipo_item: lote.tipo_item,
              epp_id: lote.epp_id,
              implemento_id: lote.implemento_id,
              herramienta_id: lote.herramienta_id,
              asignacion_origen_id: lote.id,
              cantidad: cantidadMover,
              observacion: observacion ?? lote.observacion,
              trabajador_id: trabajadorId,
              reasignado_at: new Date(),
            },
          });
          await registrarEvento(tx, {
            asignacionId: creada.id,
            obraId,
            actorId: supervisorId,
            jefeObraId: supervisorId,
            trabajadorId,
            accion: "ASIGNADO_OPERARIO",
            cantidad: cantidadMover,
            detalle: "Supervisor entregó el artículo al operario",
            datos: { asignacionOrigenId: lote.id },
          });
          creadas.push(creada.id);
        }
        restante -= cantidadMover;
      }

      if (linea.tipoItem === TipoInventarioBeck.herramienta) {
        const trabajador = await tx.usuarios.findUnique({
          where: { id: trabajadorId },
          select: { nombre: true },
        });
        await tx.inventario_beck_herramientas.update({
          where: { id: linea.itemId },
          data: { encargado: trabajador?.nombre ?? null },
        });
      }
    }

    return creadas;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function asignarInventarioAOperario(input: {
  supervisorId: string;
  obraId: unknown;
  trabajadorId: unknown;
  lineas: unknown;
  observacion?: unknown;
}) {
  const obraId = typeof input.obraId === "string" ? input.obraId.trim() : "";
  const trabajadorId = typeof input.trabajadorId === "string" ? input.trabajadorId.trim() : "";
  const observacion = typeof input.observacion === "string" && input.observacion.trim()
    ? input.observacion.trim().slice(0, 1000)
    : null;
  if (!obraId) throw new InventarioBeckError("Debes seleccionar una obra.");
  if (!trabajadorId) throw new InventarioBeckError("Debes seleccionar un operario.");
  const lineas = parseLineasInventario(input.lineas);

  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const ids = await ejecutarAsignacion(
        input.supervisorId,
        obraId,
        trabajadorId,
        lineas,
        observacion,
      );
      return { ids, cantidadLineas: lineas.length };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && intento < 2) {
        continue;
      }
      throw error;
    }
  }

  throw new InventarioBeckError("No se pudo completar la asignación. Intenta nuevamente.", 409);
}

export async function confirmarRecepcionOperario(operarioId: string, asignacionId: string) {
  return prisma.$transaction(async (tx) => {
    const asignacion = await tx.asignaciones_inventario_beck.findFirst({
      where: { id: asignacionId, trabajador_id: operarioId, estado: "asignado" },
    });
    if (!asignacion) throw new InventarioBeckError("La asignación no existe o no te pertenece.", 404);
    if (asignacion.recepcion_confirmada_at) return { yaConfirmada: true };

    const ahora = new Date();
    const updated = await tx.asignaciones_inventario_beck.updateMany({
      where: {
        id: asignacion.id,
        trabajador_id: operarioId,
        estado: "asignado",
        recepcion_confirmada_at: null,
      },
      data: { recepcion_confirmada_at: ahora, recepcion_confirmada_por_id: operarioId },
    });
    if (updated.count !== 1) throw new InventarioBeckError("La recepción ya fue modificada. Recarga e intenta nuevamente.", 409);

    await registrarEvento(tx, {
      asignacionId: asignacion.id,
      obraId: asignacion.obra_id,
      actorId: operarioId,
      jefeObraId: asignacion.jefe_obra_id,
      trabajadorId: operarioId,
      accion: "RECEPCION_CONFIRMADA_OPERARIO",
      cantidad: asignacion.cantidad,
      detalle: "Operario confirmó la recepción del artículo",
    });
    return { yaConfirmada: false, confirmadaAt: ahora };
  });
}

export async function solicitarDevolucionOperario(
  operarioId: string,
  asignacionId: string,
  motivoRaw: unknown,
) {
  const motivo = typeof motivoRaw === "string" && motivoRaw.trim()
    ? motivoRaw.trim().slice(0, 1000)
    : null;

  return prisma.$transaction(async (tx) => {
    const asignacion = await tx.asignaciones_inventario_beck.findFirst({
      where: { id: asignacionId, trabajador_id: operarioId, estado: "asignado" },
    });
    if (!asignacion) throw new InventarioBeckError("La asignación no existe o no te pertenece.", 404);
    if (!asignacion.recepcion_confirmada_at) {
      throw new InventarioBeckError("Primero debes confirmar que recibiste el artículo.");
    }
    if (asignacion.devolucion_solicitada_at) return { yaSolicitada: true };

    const ahora = new Date();
    const updated = await tx.asignaciones_inventario_beck.updateMany({
      where: {
        id: asignacion.id,
        trabajador_id: operarioId,
        estado: "asignado",
        devolucion_solicitada_at: null,
      },
      data: {
        devolucion_solicitada_at: ahora,
        devolucion_solicitada_por_id: operarioId,
        devolucion_motivo: motivo,
      },
    });
    if (updated.count !== 1) throw new InventarioBeckError("La devolución ya fue modificada. Recarga e intenta nuevamente.", 409);

    await registrarEvento(tx, {
      asignacionId: asignacion.id,
      obraId: asignacion.obra_id,
      actorId: operarioId,
      jefeObraId: asignacion.jefe_obra_id,
      trabajadorId: operarioId,
      accion: "DEVOLUCION_SOLICITADA_OPERARIO",
      cantidad: asignacion.cantidad,
      detalle: motivo ? `Operario solicitó devolución: ${motivo}` : "Operario solicitó devolución",
    });
    return { yaSolicitada: false, solicitadaAt: ahora };
  });
}

export async function recibirDevolucionSupervisor(supervisorId: string, asignacionId: string) {
  return prisma.$transaction(async (tx) => {
    const asignacion = await tx.asignaciones_inventario_beck.findFirst({
      where: { id: asignacionId, jefe_obra_id: supervisorId, estado: "asignado" },
      include: {
        usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: { select: { nombre: true } },
      },
    });
    if (!asignacion) throw new InventarioBeckError("La asignación no existe o no te pertenece.", 404);
    if (!asignacion.trabajador_id || !asignacion.devolucion_solicitada_at) {
      throw new InventarioBeckError("El operario no tiene una devolución pendiente para este artículo.", 409);
    }

    const ahora = new Date();
    const trabajadorId = asignacion.trabajador_id;
    const updated = await tx.asignaciones_inventario_beck.updateMany({
      where: {
        id: asignacion.id,
        jefe_obra_id: supervisorId,
        trabajador_id: trabajadorId,
        devolucion_solicitada_at: asignacion.devolucion_solicitada_at,
      },
      data: {
        trabajador_id: null,
        devolucion_recibida_at: ahora,
        devolucion_recibida_por_id: supervisorId,
      },
    });
    if (updated.count !== 1) throw new InventarioBeckError("La devolución cambió mientras la recibías. Recarga e intenta nuevamente.", 409);

    if (asignacion.tipo_item === TipoInventarioBeck.herramienta && asignacion.herramienta_id) {
      await tx.inventario_beck_herramientas.update({
        where: { id: asignacion.herramienta_id },
        data: { encargado: asignacion.usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios.nombre },
      });
    }

    await registrarEvento(tx, {
      asignacionId: asignacion.id,
      obraId: asignacion.obra_id,
      actorId: supervisorId,
      jefeObraId: supervisorId,
      trabajadorId,
      accion: "DEVOLUCION_RECIBIDA_SUPERVISOR",
      cantidad: asignacion.cantidad,
      detalle: "Supervisor confirmó la recepción de la devolución",
    });
    return { recibidaAt: ahora };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function devolverInventarioABodega(input: {
  supervisorId: string;
  obraId: unknown;
  tipoItem: unknown;
  itemId: unknown;
  cantidad: unknown;
  motivo?: unknown;
}) {
  const obraId = typeof input.obraId === "string" ? input.obraId.trim() : "";
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  const tipoItem = typeof input.tipoItem === "string" ? input.tipoItem : "";
  const cantidad = Number(input.cantidad);
  const motivo = typeof input.motivo === "string" && input.motivo.trim()
    ? input.motivo.trim().slice(0, 1000)
    : null;
  const [linea] = parseLineasInventario([{ tipoItem, itemId, cantidad }]);
  if (!obraId) throw new InventarioBeckError("Debes seleccionar una obra.");

  return prisma.$transaction(async (tx) => {
    const lotes = await tx.asignaciones_inventario_beck.findMany({
      where: {
        jefe_obra_id: input.supervisorId,
        obra_id: obraId,
        estado: "asignado",
        trabajador_id: null,
        ...whereItem(linea),
      },
      orderBy: { created_at: "asc" },
    });
    const disponible = lotes.reduce((total, lote) => total + lote.cantidad, 0);
    if (disponible < linea.cantidad) {
      throw new InventarioBeckError(`No tienes suficiente stock para devolver (disponible: ${disponible}).`, 409);
    }

    const ahora = new Date();
    let restante = linea.cantidad;
    const devueltas: string[] = [];
    for (const lote of lotes) {
      if (restante === 0) break;
      const cantidadMover = Math.min(restante, lote.cantidad);
      let asignacionDevueltaId = lote.id;

      if (cantidadMover === lote.cantidad) {
        const updated = await tx.asignaciones_inventario_beck.updateMany({
          where: { id: lote.id, trabajador_id: null, estado: "asignado", cantidad: lote.cantidad },
          data: { estado: "devuelto", devuelto_at: ahora, devuelto_por_id: input.supervisorId },
        });
        if (updated.count !== 1) throw new InventarioBeckError("El stock cambió mientras devolvías. Intenta nuevamente.", 409);
      } else {
        const updated = await tx.asignaciones_inventario_beck.updateMany({
          where: { id: lote.id, trabajador_id: null, estado: "asignado", cantidad: lote.cantidad },
          data: { cantidad: { decrement: cantidadMover } },
        });
        if (updated.count !== 1) throw new InventarioBeckError("El stock cambió mientras devolvías. Intenta nuevamente.", 409);
        const creada = await tx.asignaciones_inventario_beck.create({
          data: {
            obra_id: lote.obra_id,
            jefe_obra_id: lote.jefe_obra_id,
            asignado_por_id: lote.asignado_por_id,
            tipo_item: lote.tipo_item,
            epp_id: lote.epp_id,
            implemento_id: lote.implemento_id,
            herramienta_id: lote.herramienta_id,
            cantidad: cantidadMover,
            observacion: motivo ?? lote.observacion,
            estado: "devuelto",
            devuelto_at: ahora,
            devuelto_por_id: input.supervisorId,
            asignacion_origen_id: lote.id,
          },
        });
        asignacionDevueltaId = creada.id;
      }

      await registrarEvento(tx, {
        asignacionId: asignacionDevueltaId,
        obraId,
        actorId: input.supervisorId,
        jefeObraId: input.supervisorId,
        accion: "DEVUELTO_BODEGA",
        cantidad: cantidadMover,
        detalle: motivo ? `Supervisor devolvió a bodega: ${motivo}` : "Supervisor devolvió el artículo a bodega",
      });
      devueltas.push(asignacionDevueltaId);
      restante -= cantidadMover;
    }

    if (linea.tipoItem === TipoInventarioBeck.epp) {
      const item = await tx.inventario_beck_epp.findUniqueOrThrow({ where: { id: linea.itemId }, select: { salida: true } });
      await tx.inventario_beck_epp.update({
        where: { id: linea.itemId },
        data: { saldo: { increment: linea.cantidad }, salida: Math.max(0, item.salida - linea.cantidad) },
      });
    } else if (linea.tipoItem === TipoInventarioBeck.implemento) {
      const item = await tx.inventario_beck_implementos.findUniqueOrThrow({ where: { id: linea.itemId }, select: { salida: true } });
      await tx.inventario_beck_implementos.update({
        where: { id: linea.itemId },
        data: { saldo: { increment: linea.cantidad }, salida: Math.max(0, item.salida - linea.cantidad) },
      });
    } else {
      await tx.inventario_beck_herramientas.update({ where: { id: linea.itemId }, data: { encargado: null } });
    }

    return { ids: devueltas, cantidad: linea.cantidad };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listarTrazabilidadAsignacion(
  usuarioId: string,
  rol: "jefeobra" | "terreno",
  asignacionId: string,
) {
  const asignacion = await prisma.asignaciones_inventario_beck.findUnique({
    where: { id: asignacionId },
    select: {
      id: true,
      jefe_obra_id: true,
      trabajador_id: true,
      asignacion_origen_id: true,
      created_at: true,
      trazabilidad_inventario_beck: {
        where: rol === "terreno" ? { trabajador_id: usuarioId } : undefined,
        select: { id: true },
        take: 1,
      },
    },
  });
  const autorizado = rol === "jefeobra"
    ? asignacion?.jefe_obra_id === usuarioId
    : asignacion?.trabajador_id === usuarioId || Boolean(asignacion?.trazabilidad_inventario_beck.length);
  if (!asignacion || !autorizado) throw new InventarioBeckError("No tienes acceso a esta trazabilidad.", 403);

  const tramosLinaje: Array<{ asignacion_id: string; created_at?: { lte: Date } }> = [
    { asignacion_id: asignacion.id },
  ];
  let origenId = asignacion.asignacion_origen_id;
  let limite = asignacion.created_at;
  for (let nivel = 0; origenId && nivel < 20; nivel += 1) {
    tramosLinaje.push({ asignacion_id: origenId, created_at: { lte: limite } });
    const origen = await prisma.asignaciones_inventario_beck.findUnique({
      where: { id: origenId },
      select: { asignacion_origen_id: true, created_at: true },
    });
    if (!origen) break;
    origenId = origen.asignacion_origen_id;
    limite = origen.created_at;
  }

  return prisma.trazabilidad_inventario_beck.findMany({
    where: { OR: tramosLinaje },
    select: {
      id: true,
      accion: true,
      cantidad: true,
      detalle: true,
      datos: true,
      created_at: true,
      usuarios_trazabilidad_inventario_beck_actor_idTousuarios: {
        select: { id: true, nombre: true, rol: true },
      },
      usuarios_trazabilidad_inventario_beck_trabajador_idTousuarios: {
        select: { id: true, nombre: true },
      },
    },
    orderBy: { created_at: "asc" },
  });
}

export async function listarTrazabilidadItemSupervisor(
  supervisorId: string,
  obraId: string,
  tipoItemRaw: string,
  itemId: string,
) {
  if (!obraId || !itemId || !TIPOS_VALIDOS.has(tipoItemRaw)) {
    throw new InventarioBeckError("Los datos del artículo son inválidos.");
  }
  const tipoItem = tipoItemRaw as TipoInventarioBeck;
  return prisma.trazabilidad_inventario_beck.findMany({
    where: {
      asignaciones_inventario_beck: {
        jefe_obra_id: supervisorId,
        obra_id: obraId,
        ...whereItem({ tipoItem, itemId, cantidad: 1 }),
      },
    },
    select: {
      id: true,
      accion: true,
      cantidad: true,
      detalle: true,
      datos: true,
      created_at: true,
      usuarios_trazabilidad_inventario_beck_actor_idTousuarios: {
        select: { id: true, nombre: true, rol: true },
      },
      usuarios_trazabilidad_inventario_beck_trabajador_idTousuarios: {
        select: { id: true, nombre: true },
      },
    },
    orderBy: { created_at: "asc" },
  });
}

export async function listarHistorialInventarioOperario(operarioId: string) {
  const eventos = await prisma.trazabilidad_inventario_beck.findMany({
    where: { trabajador_id: operarioId },
    select: {
      id: true,
      accion: true,
      cantidad: true,
      detalle: true,
      created_at: true,
      usuarios_trazabilidad_inventario_beck_actor_idTousuarios: { select: { id: true, nombre: true, rol: true } },
      asignaciones_inventario_beck: {
        select: {
          id: true,
          tipo_item: true,
          epp_id: true,
          implemento_id: true,
          herramienta_id: true,
          obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
          ...ITEM_SELECT,
        },
      },
    },
    orderBy: { created_at: "desc" },
    take: 300,
  });

  return eventos.map((evento) => ({
    id: evento.id,
    asignacionId: evento.asignaciones_inventario_beck.id,
    ...serializarItem(evento.asignaciones_inventario_beck),
    obra: evento.asignaciones_inventario_beck.obras,
    accion: evento.accion,
    cantidad: evento.cantidad,
    detalleEvento: evento.detalle,
    fecha: evento.created_at,
    actor: evento.usuarios_trazabilidad_inventario_beck_actor_idTousuarios,
  }));
}

export async function buscarInventarioPorCodigo(supervisorId: string, codigoRaw: unknown) {
  const codigo = typeof codigoRaw === "string" ? codigoRaw.trim().slice(0, 100) : "";
  if (!codigo) throw new InventarioBeckError("El código de barras está vacío.");

  const [epp, implementos, herramientas] = await Promise.all([
    prisma.inventario_beck_epp.findMany({
      where: { sku: { equals: codigo, mode: "insensitive" }, activo: true },
      select: {
        id: true, item: true, sku: true, modelo_marca: true, talla: true, color: true,
        unidad_medida: true, saldo: true,
        asignaciones_inventario_beck: {
          where: { estado: "asignado" },
          select: {
            id: true, cantidad: true, jefe_obra_id: true, trabajador_id: true,
            obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
            usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: { select: { id: true, nombre: true } },
            usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: { select: { id: true, nombre: true } },
          },
        },
      },
    }),
    prisma.inventario_beck_implementos.findMany({
      where: { sku: { equals: codigo, mode: "insensitive" }, activo: true },
      select: {
        id: true, item: true, sku: true, modelo_marca: true, talla_medida: true, color: true,
        unidad_medida: true, saldo: true,
        asignaciones_inventario_beck: {
          where: { estado: "asignado" },
          select: {
            id: true, cantidad: true, jefe_obra_id: true, trabajador_id: true,
            obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
            usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: { select: { id: true, nombre: true } },
            usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: { select: { id: true, nombre: true } },
          },
        },
      },
    }),
    prisma.inventario_beck_herramientas.findMany({
      where: { sku: { equals: codigo, mode: "insensitive" }, activo: true },
      select: {
        id: true, nombre: true, sku: true, marca: true, modelo: true, categoria: true,
        asignaciones_inventario_beck: {
          where: { estado: "asignado" },
          select: {
            id: true, cantidad: true, jefe_obra_id: true, trabajador_id: true,
            obras: { select: { id: true, nombre: true, codigo: true, estado: true } },
            usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios: { select: { id: true, nombre: true } },
            usuarios_asignaciones_inventario_beck_trabajador_idTousuarios: { select: { id: true, nombre: true } },
          },
        },
      },
    }),
  ]);

  const serializar = (
    tipoItem: TipoInventarioBeck,
    item: any,
    nombre: string,
    detalle: string | null,
    talla: string | null,
    saldoBodega: number | null,
  ) => {
    const disponiblesPorObra = new Map<string, { obra: any; cantidad: number }>();
    const custodios = item.asignaciones_inventario_beck.map((asignacion: any) => {
      if (asignacion.jefe_obra_id === supervisorId && !asignacion.trabajador_id) {
        const actual = disponiblesPorObra.get(asignacion.obras.id);
        disponiblesPorObra.set(asignacion.obras.id, {
          obra: asignacion.obras,
          cantidad: (actual?.cantidad ?? 0) + asignacion.cantidad,
        });
      }
      const trabajador = asignacion.usuarios_asignaciones_inventario_beck_trabajador_idTousuarios;
      const supervisor = asignacion.usuarios_asignaciones_inventario_beck_jefe_obra_idTousuarios;
      return {
        asignacionId: asignacion.id,
        cantidad: asignacion.cantidad,
        obra: asignacion.obras,
        custodio: trabajador
          ? { id: trabajador.id, nombre: trabajador.nombre, rol: "operario" }
          : { id: supervisor.id, nombre: supervisor.nombre, rol: "supervisor" },
        supervisor: { id: supervisor.id, nombre: supervisor.nombre },
        esMio: asignacion.jefe_obra_id === supervisorId,
      };
    });

    return {
      itemId: item.id,
      tipoItem,
      sku: item.sku,
      nombre,
      detalle,
      talla,
      color: item.color ?? null,
      unidadMedida: item.unidad_medida ?? null,
      saldoBodega,
      custodios,
      disponibleSupervisorPorObra: Array.from(disponiblesPorObra.values()),
    };
  };

  const resultados = [
    ...epp.map((item) => serializar(
      TipoInventarioBeck.epp,
      item,
      item.item,
      item.modelo_marca,
      item.talla,
      item.saldo,
    )),
    ...implementos.map((item) => serializar(
      TipoInventarioBeck.implemento,
      item,
      item.item,
      item.modelo_marca,
      item.talla_medida,
      item.saldo,
    )),
    ...herramientas.map((item) => serializar(
      TipoInventarioBeck.herramienta,
      item,
      item.nombre,
      [item.marca, item.modelo, item.categoria].filter(Boolean).join(" · ") || null,
      null,
      item.asignaciones_inventario_beck.length === 0 ? 1 : 0,
    )),
  ];

  return { codigo, resultados };
}
