import { Request, Response } from "express";
import { prisma } from "../config/prisma";

function getQueryValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function getItemizadoOpciones(req: Request, res: Response) {
  try {
    const search = getQueryValue(req.query.search);
    const elementoPenetra = getQueryValue(req.query.elementoPenetra);
    const materialidad = getQueryValue(req.query.materialidad);
    const limitValue = Number(req.query.limit);
    const take =
      Number.isFinite(limitValue) && limitValue > 0
        ? Math.min(Math.trunc(limitValue), 100)
        : 80;

    const opciones = await prisma.itemizado_opciones.findMany({
      where: {
        visible: true,
        elemento_pasante: { not: null },
        ...(search
          ? {
              OR: [
                { codigo_beck: { contains: search, mode: "insensitive" } },
                { tipo: { contains: search, mode: "insensitive" } },
                { elemento_pasante: { contains: search, mode: "insensitive" } },
                { elemento_penetra: { contains: search, mode: "insensitive" } },
                { materialidad: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(elementoPenetra
          ? { elemento_penetra: { contains: elementoPenetra, mode: "insensitive" } }
          : {}),
        ...(materialidad
          ? { materialidad: { contains: materialidad, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        codigo_beck: true,
        tipo: true,
        elemento_pasante: true,
        elemento_penetra: true,
        materialidad: true,
      },
      orderBy: [{ codigo_beck: "asc" }, { created_at: "asc" }],
      take,
    });

    return res.json({
      success: true,
      data: opciones,
    });
  } catch (error) {
    console.error("GET ITEMIZADO OPCIONES ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las opciones de itemizado",
    });
  }
}
