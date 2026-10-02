import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { leerFiltroTipoRegistro } from "../utils/filtroTipoRegistro";

export async function getResumenOperario(req: Request, res: Response) {
  if (!req.user?.id) return res.status(401).json({ success: false, error: "Usuario no autenticado" });
  if (req.user.rol !== "terreno") return res.status(403).json({ success: false, error: "Acceso exclusivo del operario" });
  const tipo = leerFiltroTipoRegistro(req.query.tipoRegistro, res);
  if (tipo === false) return;
  const obraId = req.query.obraId === undefined || req.query.obraId === "todas" ? undefined : req.query.obraId;
  if (obraId !== undefined && (typeof obraId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(obraId))) {
    return res.status(400).json({ success: false, error: "Obra no válida" });
  }
  // Misma visibilidad del listado del operario: las copias pendientes del supervisor
  // no se muestran hasta que se devuelvan al operario o ya hayan sido corregidas.
  const base: Prisma.registros_terrenoWhereInput = {
    usuario_id: req.user.id,
    carga_completa: true,
    OR: [
      { es_correccion: false },
      { es_correccion: true, devuelto_a_tecnico: true },
      { es_correccion: true, corregido_at: { not: null } },
      { estado: { not: "pendiente" } },
    ],
  };
  const where: Prisma.registros_terrenoWhereInput = {
    ...base,
    ...(tipo ? { tipo_registro: tipo } : {}),
    ...(obraId ? { obra_id: obraId } : {}),
  };
  try {
    const [total, registrosRealizados, pendientes, enRevision, validados, correccionesRecibidas, porObra, recientes, obras] = await prisma.$transaction([
      prisma.registros_terreno.count({ where }),
      prisma.registros_terreno.count({ where: { ...where, es_correccion: false, registro_origen_id: null } }),
      prisma.registros_terreno.count({ where: { ...where, estado: "pendiente", NOT: { es_correccion: true, devuelto_a_tecnico: true } } }),
      prisma.registros_terreno.count({ where: { ...where, estado: "en_revision" } }),
      prisma.registros_terreno.count({ where: { ...where, estado: "validado" } }),
      prisma.registros_terreno.count({ where: { ...where, estado: "pendiente", es_correccion: true, devuelto_a_tecnico: true } }),
      prisma.registros_terreno.groupBy({ by: ["obra_id"], where, _count: { _all: true }, orderBy: [{ _count: { obra_id: "desc" } }, { obra_id: "asc" }], take: 1 }),
      prisma.registros_terreno.findMany({
        where, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 4,
        select: { id: true, tipo_registro: true, fecha: true, created_at: true, numero_sello: true, estado: true, obras: { select: { id: true, nombre: true, codigo: true } } },
      }),
      // Las opciones no dependen de los filtros, para poder cambiar de obra incluso sin resultados.
      prisma.obras.findMany({ where: { registros_terreno: { some: base } }, select: { id: true, nombre: true, codigo: true }, orderBy: [{ nombre: "asc" }, { id: "asc" }] }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return res.json({ success: true, data: {
      metrics: { total, registrosRealizados, pendientes, enRevision, validados, correccionesRecibidas,
        avance: total ? Math.round(validados / total * 100) : 0,
        obraPrincipal: obras.find((obra) => obra.id === porObra[0]?.obra_id)?.nombre ?? "Sin actividad",
      },
      recientes, obras,
    } });
  } catch (error) {
    console.error("Error al obtener resumen del operario:", error);
    return res.status(500).json({ success: false, error: "No se pudo cargar el resumen del operario" });
  }
}
