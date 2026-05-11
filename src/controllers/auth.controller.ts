import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { verifyMicrosoftIdToken } from "../services/microsoftAuth.service";
import { signAppToken } from "../services/jwt.service";

const ALLOWED_LOGIN_ROLES = new Set([
  "administrador",
  "terreno",
  "jefeobra",
  "ingenieria",
  "visualizador",
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

    if (!hasAllowedEmailDomain(microsoftUser.email)) {
      return unauthorizedLoginResponse(res);
    }

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
      return unauthorizedLoginResponse(res);
    }

    if (!canLogin(usuario.rol)) {
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

    return res.json(createLoginResponse(usuario));
  } catch (error: any) {
    console.error("MICROSOFT LOGIN CONTROLLER ERROR:", error);

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

    if (!hasAllowedEmailDomain(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        error: "Correo no válido.",
      });
    }

    const usuario = await prisma.usuarios.findFirst({
      where: {
        email: normalizedEmail,
        activo: true,
      },
    });

    if (!usuario || !usuario.password_hash) {
      return res.status(401).json({
        success: false,
        error: "Correo o contraseña inválidos",
      });
    }

    if (!canLogin(usuario.rol)) {
      return unauthorizedLoginResponse(res);
    }

    const passwordMatches = await bcrypt.compare(
      String(password),
      usuario.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: "Correo o contraseña inválidos",
      });
    }

    return res.json(createLoginResponse(usuario));
  } catch (error) {
    console.error("EMAIL LOGIN CONTROLLER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Error interno al iniciar sesión",
    });
  }
}
