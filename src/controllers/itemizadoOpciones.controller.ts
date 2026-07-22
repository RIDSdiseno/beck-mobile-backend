import { Request, Response } from "express";
import { prisma } from "../config/prisma";

function getQueryValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getItemizadoOpciones(req: Request, res: Response) {
  try {
    const search = getQueryValue(req.query.search);
    const elementoPenetra = getQueryValue(req.query.elementoPenetra);
    const materialidad = getQueryValue(req.query.materialidad);
    const obraIdRaw = getQueryValue(req.query.obraId);
    const obraId = UUID_REGEX.test(obraIdRaw) ? obraIdRaw : "";
    const visibleParam = getQueryValue(req.query.visible);
    const limitValue = Number(req.query.limit);
    const take =
      Number.isFinite(limitValue) && limitValue > 0
        ? Math.min(Math.trunc(limitValue), 100)
        : 80;

    const opciones = await prisma.itemizado_opciones.findMany({
      where: {
        elemento_pasante: { not: null },
        // Sin obraId no hay config por obra que consultar: se respeta el flag global.
        ...(obraId ? {} : { visible: true }),
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
        visible: true,
      },
      orderBy: [{ codigo_beck: "asc" }, { created_at: "asc" }],
      take: obraId ? undefined : take,
    });

    if (!obraId) {
      return res.json({
        success: true,
        data: opciones.map(({ visible, ...rest }) => rest),
      });
    }

    const configs = await prisma.configuracion_itemizado_opcion_obra.findMany({
      where: { obra_id: obraId, itemizado_opcion_id: { in: opciones.map((o) => o.id) } },
      select: { itemizado_opcion_id: true, visible: true, nombre_personalizado: true },
    });
    const configMap = new Map(configs.map((c) => [c.itemizado_opcion_id, c]));

    const conVisibilidadObra = opciones.map((op) => {
      const config = configMap.get(op.id);
      return {
        ...op,
        visible: config ? config.visible : op.visible,
        nombre_personalizado: config?.nombre_personalizado ?? null,
      };
    });

    const filtradas =
      visibleParam === "false"
        ? conVisibilidadObra.filter((op) => !op.visible)
        : conVisibilidadObra.filter((op) => op.visible);

    return res.json({
      success: true,
      data: filtradas.slice(0, take).map(({ visible, ...rest }) => rest),
    });
  } catch (error) {
    console.error("GET ITEMIZADO OPCIONES ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las opciones de itemizado",
    });
  }
}
