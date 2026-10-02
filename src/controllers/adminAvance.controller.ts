import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  consultaAvanceObra,
  PERIODOS_AVANCE,
  PeriodoAvance,
} from "../services/adminAvance.service";

function autorizado(req: Request, res: Response) {
  if (!req.user?.id) {
    res.status(401).json({ success: false, error: "Usuario no autenticado" });
    return false;
  }
  if (req.user.rol !== "administrador" || req.user.empresa !== "beck") {
    res
      .status(403)
      .json({
        success: false,
        error: "Acceso exclusivo para administradores BECK",
      });
    return false;
  }
  return true;
}

export async function getAdminAvanceObras(req: Request, res: Response) {
  if (!autorizado(req, res)) return;
  try {
    const obras = await prisma.obras.findMany({
      select: { id: true, nombre: true, codigo: true, estado: true },
      orderBy: [{ nombre: "asc" }, { id: "asc" }],
    });
    return res.json({ success: true, data: obras });
  } catch (error) {
    console.error("GET ADMIN AVANCE OBRAS ERROR:", error);
    return res
      .status(500)
      .json({ success: false, error: "No se pudieron cargar las obras" });
  }
}

export async function getAdminAvance(req: Request, res: Response) {
  if (!autorizado(req, res)) return;
  const { obraId, periodo = "todo" } = req.query;
  if (
    typeof obraId !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(obraId) ||
    typeof periodo !== "string" ||
    !PERIODOS_AVANCE.includes(periodo as PeriodoAvance)
  ) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Selecciona una obra y un período válido",
      });
  }
  try {
    const obra = await prisma.obras.findUnique({
      where: { id: obraId },
      select: { id: true, nombre: true, codigo: true, estado: true },
    });
    if (!obra)
      return res
        .status(404)
        .json({ success: false, error: "Obra no encontrada" });
    const rows = await prisma.$queryRaw<{ data: Record<string, unknown> }[]>(
      consultaAvanceObra(obraId, periodo as PeriodoAvance),
    );
    return res.json({ success: true, data: { ...rows[0].data, obra } });
  } catch (error) {
    console.error("GET ADMIN AVANCE ERROR:", error);
    return res
      .status(500)
      .json({
        success: false,
        error: "No se pudo cargar el avance de la obra",
      });
  }
}
