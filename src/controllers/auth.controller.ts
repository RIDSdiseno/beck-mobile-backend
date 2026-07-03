import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { verifyMicrosoftIdToken } from "../services/microsoftAuth.service";
import { signAppToken } from "../services/jwt.service";

const IS_PROD = process.env.NODE_ENV === "production";

function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function logAuthFail(email: string, ip: string, reason: string) {
  console.warn("AUTH_FAIL", { email, ip, reason, at: new Date().toISOString() });
}

function logAuthOk(email: string, userId: string, rol: string, ip: string) {
  console.info("AUTH_OK", { email, userId, rol, ip, at: new Date().toISOString() });
}

const ALLOWED_LOGIN_ROLES = new Set([
  "administrador",
  "terreno",
  "jefeobra",
  "ingenieria",
  "cliente",
]);
const ALLOWED_EMAIL_DOMAIN = "@becksoluciones.cl";

function buildAppUser(usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
  };
}

function canLogin(rol: string) {
  return ALLOWED_LOGIN_ROLES.has(rol);
}

function hasAllowedEmailDomain(email: string) {
  return email.toLowerCase().trim().endsWith(ALLOWED_EMAIL_DOMAIN);
}

function canUseEmailWithRole(email: string, rol: string) {
  return rol === "cliente" || hasAllowedEmailDomain(email);
}

function createLoginResponse(usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}) {
  const appUser = buildAppUser(usuario);
  const token = signAppToken(appUser);

  return {
    success: true,
    token,
    user: appUser,
  };
}

function unauthorizedLoginResponse(res: Response) {
  return res.status(403).json({
    success: false,
    error: "Tu cuenta no está autorizada en Beck",
  });
}

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
      logAuthFail(microsoftUser.email, getClientIp(req), "user_not_found");
      return unauthorizedLoginResponse(res);
    }

    if (!canLogin(usuario.rol)) {
      logAuthFail(microsoftUser.email, getClientIp(req), "role_not_allowed");
      return unauthorizedLoginResponse(res);
    }

    if (!canUseEmailWithRole(microsoftUser.email, usuario.rol)) {
      logAuthFail(microsoftUser.email, getClientIp(req), "domain_not_allowed");
      return unauthorizedLoginResponse(res);
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

    logAuthOk(microsoftUser.email, usuario.id, usuario.rol, getClientIp(req));
    return res.json(createLoginResponse(usuario));
  } catch (error: any) {
    console.error("MICROSOFT LOGIN ERROR:", IS_PROD ? error?.message : error);

    return res.status(401).json({
      success: false,
      error: "No se pudo iniciar sesión con Microsoft",
    });
  }
}

export async function emailLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body ?? {};
    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        error: "Debes ingresar correo y contraseña",
      });
    }

    const usuario = await prisma.usuarios.findFirst({
      where: {
        email: normalizedEmail,
        activo: true,
      },
    });

    if (!usuario || !usuario.password_hash) {
      logAuthFail(normalizedEmail, getClientIp(req), "user_not_found");
      return res.status(401).json({
        success: false,
        error: "Correo o contraseña inválidos",
      });
    }

    if (!canLogin(usuario.rol)) {
      logAuthFail(normalizedEmail, getClientIp(req), "role_not_allowed");
      return unauthorizedLoginResponse(res);
    }

    if (!canUseEmailWithRole(normalizedEmail, usuario.rol)) {
      logAuthFail(normalizedEmail, getClientIp(req), "domain_not_allowed");
      return res.status(400).json({
        success: false,
        error: "Correo no válido.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      String(password),
      usuario.password_hash
    );

    if (!passwordMatches) {
      logAuthFail(normalizedEmail, getClientIp(req), "invalid_password");
      return res.status(401).json({
        success: false,
        error: "Correo o contraseña inválidos",
      });
    }

    logAuthOk(normalizedEmail, usuario.id, usuario.rol, getClientIp(req));
    return res.json(createLoginResponse(usuario));
  } catch (error) {
    console.error("EMAIL LOGIN ERROR:", IS_PROD ? (error instanceof Error ? error.message : "error") : error);

    return res.status(500).json({
      success: false,
      error: "Error interno al iniciar sesión",
    });
  }
}
