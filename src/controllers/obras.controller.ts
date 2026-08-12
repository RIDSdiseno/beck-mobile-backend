import { Request, Response } from "express";
import { canAccessObra, getMisObrasByUser } from "../services/obras.service";
import {
  normalizarRolConfiguracion,
  obtenerConfiguracionRegistro,
} from "../services/configuracionCamposRegistro.service";

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

    const rolConfiguracion = normalizarRolConfiguracion(rol);
    if (!rolConfiguracion) {
      return res.status(403).json({
        success: false,
        error: "Tu rol no utiliza configuracion de registro movil",
      });
    }

    const tieneAcceso = await canAccessObra(userId, rol, obraId);
    if (!tieneAcceso) {
      return res.status(403).json({
        success: false,
        error: "No tienes acceso a la configuracion de esta obra",
      });
    }

    const configuracion = await obtenerConfiguracionRegistro(
      obraId,
      rolConfiguracion,
    );

    return res.json({
      success: true,
      data: configuracion.map((campo) => ({
        campo: campo.appCampo,
        campoOrigen: campo.campo,
        color: campo.color,
        configurable: campo.configurable,
        visible: campo.visible,
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
