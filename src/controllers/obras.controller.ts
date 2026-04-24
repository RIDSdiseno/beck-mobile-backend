import { Request, Response } from "express";
import { getMisObrasByUser } from "../services/obras.service";

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
      error: "No se pudieron obtener las obras asignadas",
    });
  }
}