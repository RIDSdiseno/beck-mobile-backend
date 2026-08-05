import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import {
  obtenerEmpresaUsuario,
  type EmpresaApp,
} from "../services/empresa.service";

export type AppJwtPayload = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  empresa: EmpresaApp;
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

export async function verifyAppToken(
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

    const decoded = jwt.verify(token, env.jwtSecret, {
      algorithms: ["HS256"],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
    }) as AppJwtPayload;

    const currentUser = await prisma.usuarios.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        nombre: true,
        email: true,
        rol: true,
        activo: true,
      },
    });

    if (!currentUser?.activo) {
      return res.status(401).json({
        success: false,
        error: "La sesión ya no está autorizada",
        code: "SESSION_REVOKED",
      });
    }

    const empresa = obtenerEmpresaUsuario(currentUser.email, currentUser.rol);
    if (!empresa) {
      return res.status(401).json({
        success: false,
        error: "La cuenta no pertenece a una empresa autorizada",
        code: "SESSION_COMPANY_INVALID",
      });
    }

    req.user = {
      ...decoded,
      nombre: currentUser.nombre,
      email: currentUser.email,
      rol: currentUser.rol,
      empresa,
    };
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
