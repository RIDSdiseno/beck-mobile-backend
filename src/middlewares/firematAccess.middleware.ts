import type { Request, Response, NextFunction } from "express";

export function permitirFiremat(soloGestion = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const adminBeck = user?.rol === "administrador" && user.empresa === "beck";
    const roles = soloGestion
      ? ["bodeguero"]
      : ["bodeguero", "vendedor_firemat", "visualizador_firemat"];
    if (!user || (!adminBeck && !roles.includes(user.rol))) {
      return res.status(403).json({ success: false, error: "No tienes permisos para acceder a este recurso" });
    }
    return next();
  };
}
