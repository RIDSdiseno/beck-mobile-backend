import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { getMisObrasByUser } from "../services/obras.service";

const CAMPOS_CONFIGURABLES_REGISTRO = [
  "cieloModular",
  "aislacion",
  "reparacionTabique",
] as const;

export async function getMisObras(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const rol = req.user?.rol;

    if (!userId || !rol) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    const obras = await getMisObrasByUser(userId, rol);

    return res.json({
      success: true,
      data: obras,
    });
  } catch (error) {
    console.error("GET MIS OBRAS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudieron obtener las obras disponibles",
    });
  }
}

export async function getConfiguracionRegistro(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const rol = req.user?.rol;
    const obraId = typeof req.params.id === "string" ? req.params.id : "";

    if (!userId || !rol) {
      return res.status(401).json({
        success: false,
        error: "Usuario no autenticado",
      });
    }

    if (!obraId) {
      return res.status(400).json({
        success: false,
        error: "Falta id de la obra",
      });
    }

    if (rol !== "terreno" && rol !== "jefeobra") {
      return res.status(403).json({
        success: false,
        error: "Tu rol no utiliza configuracion de registro movil",
      });
    }

    const obrasDisponibles = await getMisObrasByUser(userId, rol);
    if (!obrasDisponibles.some((obra) => obra.id === obraId)) {
      return res.status(403).json({
        success: false,
        error: "No tienes acceso a la configuracion de esta obra",
      });
    }

    const configuracion = await prisma.configuracion_campos_registro.findMany({
      where: {
        obra_id: obraId,
        rol: rol === "terreno" ? "trabajador" : "jefeobra",
        campo: { in: [...CAMPOS_CONFIGURABLES_REGISTRO] },
      },
      select: {
        campo: true,
        visible: true,
      },
    });
    const configuracionPorCampo = new Map(
      configuracion.map((campo) => [campo.campo, campo.visible]),
    );

    return res.json({
      success: true,
      data: CAMPOS_CONFIGURABLES_REGISTRO.map((campo) => ({
        campo,
        visible: configuracionPorCampo.get(campo) ?? true,
      })),
    });
  } catch (error) {
    console.error("GET CONFIGURACION REGISTRO ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "No se pudo obtener la configuracion del registro",
    });
  }
}
