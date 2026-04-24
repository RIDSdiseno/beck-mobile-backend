import { Request, Response } from "express";
import { verifyMicrosoftIdToken } from "../services/microsoftAuth.service";
import { signAppToken } from "../services/jwt.service";

export async function microsoftLogin(req: Request, res: Response) {
  try {
    const { idToken } = req.body ?? {};

    if (!idToken) {
      return res.status(400).json({
        message: "Falta idToken",
      });
    }

    const user = await verifyMicrosoftIdToken(idToken);
    const token = signAppToken(user);

    return res.json({
      token,
      user,
    });
  } catch (error: any) {
    console.error("MICROSOFT LOGIN CONTROLLER ERROR:", error);

    return res.status(500).json({
      message:
        error?.message || "Error interno al iniciar sesión con Microsoft",
    });
  }
}