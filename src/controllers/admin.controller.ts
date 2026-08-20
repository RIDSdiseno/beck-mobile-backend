import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../config/prisma";

function requireAdmin(req: Request, res: Response) {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: "Usuario no autenticado" });
    return null;
  }
  if (req.user.rol !== "administrador") {
    res.status(403).json({ success: false, error: "Acceso exclusivo para administradores" });
    return null;
  }
  return req.user.id;
}

function parseLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.trunc(parsed), 50) : 25;
}

export async function getAdminResumen(req: Request, res: Response) {
  try {
    const userId = requireAdmin(req, res);
    if (!userId) return;
    const complete = { carga_completa: true };
    const [total, pendientesSupervisor, enRevision, rechazados, validados, correcciones, accionesAdministrador] = await prisma.$transaction([
      prisma.registros_terreno.count({ where: complete }),
      prisma.registros_terreno.count({ where: { ...complete, estado: "pendiente", devuelto_a_tecnico: false } }),
      prisma.registros_terreno.count({ where: { ...complete, estado: "en_revision" } }),
      prisma.registros_terreno.count({ where: { ...complete, estado: "rechazado" } }),
      prisma.registros_terreno.count({ where: { ...complete, estado: "validado" } }),
      prisma.registros_terreno.count({ where: { ...complete, es_correccion: true, estado: "pendiente" } }),
      prisma.actividad_app.count({ where: { usuario_id: userId } }),
    ]);
    return res.json({
      success: true,
      data: { total, pendientesSupervisor, enRevision, rechazados, validados, correcciones, accionesAdministrador },
    });
  } catch (error) {
    console.error("GET ADMIN RESUMEN ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo cargar el resumen administrativo" });
  }
}

export async function getAdminActividad(req: Request, res: Response) {
  try {
    const userId = requireAdmin(req, res);
    if (!userId) return;
    const search = String(req.query.search ?? "").trim();
    const fecha = String(req.query.fecha ?? "").trim();
    const modulo = String(req.query.modulo ?? "").trim();
    const cursor = String(req.query.cursor ?? "").trim();
    const limit = parseLimit(req.query.limit);
    const where: Prisma.actividad_appWhereInput = {
      usuario_id: userId,
      ...(modulo && modulo !== "todos" ? { modulo } : {}),
      ...(fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
        ? {
            created_at: {
              gte: new Date(`${fecha}T00:00:00.000Z`),
              lt: new Date(`${fecha}T23:59:59.999Z`),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { descripcion: { contains: search, mode: "insensitive" } },
              { accion: { contains: search, mode: "insensitive" } },
              { modulo: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.actividad_app.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.actividad_app.count({ where }),
    ]);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return res.json({
      success: true,
      data: {
        items,
        total,
        nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
      },
    });
  } catch (error) {
    console.error("GET ADMIN ACTIVIDAD ERROR:", error);
    return res.status(500).json({ success: false, error: "No se pudo cargar la actividad administrativa" });
  }
}
