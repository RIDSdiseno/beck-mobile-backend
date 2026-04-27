import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { verifyMicrosoftIdToken } from "../services/microsoftAuth.service";
import { signAppToken } from "../services/jwt.service";

export async function microsoftLogin(req: Request, res: Response) {
  try {
    const { idToken } = req.body ?? {};

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: "Falta idToken",
      });
    }

    const microsoftUser = await verifyMicrosoftIdToken(idToken);

    let usuario = await prisma.usuarios.findFirst({
      where: {
        azure_id: microsoftUser.oid,
        activo: true,
      },
    });

    if (!usuario) {
      usuario = await prisma.usuarios.findFirst({
        where: {
          email: microsoftUser.email,
          activo: true,
        },
      });
    }

    if (!usuario) {
      return res.status(403).json({
        success: false,
        error: "Tu cuenta no está autorizada en Beck",
      });
    }

    if (!usuario.azure_id) {
      usuario = await prisma.usuarios.update({
        where: { id: usuario.id },
        data: {
          azure_id: microsoftUser.oid,
          updated_at: new Date(),
        },
      });
    }

    const appUser = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
    };

    console.log("USUARIO BD LOGIN =>", appUser);

    const token = signAppToken(appUser);

    return res.json({
      success: true,
      token,
      user: appUser,
    });
  } catch (error: any) {
    console.error("MICROSOFT LOGIN CONTROLLER ERROR:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message || "Error interno al iniciar sesión con Microsoft",
    });
  }
}