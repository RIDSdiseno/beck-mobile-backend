import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type AppJwtPayload = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  iat?: number;
  exp?: number;
};

declare global {
  namespace Express {
    interface Request {
      user?: AppJwtPayload;
    }
  }
}

export function verifyAppToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Token no proporcionado",
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const decoded = jwt.verify(token, env.jwtSecret) as AppJwtPayload;

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Token inválido o expirado",
    });
  }
}

export function checkRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.rol;

    if (!userRole) {
      return res.status(403).json({
        success: false,
        error: "No se pudo determinar el rol del usuario",
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: "No tienes permisos para acceder a este recurso",
      });
    }

    next();
  };
}