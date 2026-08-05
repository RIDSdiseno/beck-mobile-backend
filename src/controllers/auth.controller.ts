import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { signAppToken } from "../services/jwt.service";
import { verifyMicrosoftIdToken } from "../services/microsoftAuth.service";
import {
  normalizarEmpresa,
  obtenerEmpresaUsuario,
} from "../services/empresa.service";

const IS_PROD = process.env.NODE_ENV === "production";

function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function logAuthFail(email: string, ip: string, reason: string) {
  console.warn("AUTH_FAIL", {
    emailDomain: email.split("@")[1] || "invalid",
    ip,
    reason,
    at: new Date().toISOString(),
  });
}

function logAuthOk(email: string, userId: string, rol: string, ip: string) {
  console.info("AUTH_OK", {
    emailDomain: email.split("@")[1] || "invalid",
    userId,
    rol,
    ip,
    at: new Date().toISOString(),
  });
}

function buildAppUser(usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: string;
}) {
  const empresa = obtenerEmpresaUsuario(usuario.email, usuario.rol);
  if (!empresa) {
    throw new Error("USER_COMPANY_MISMATCH");
  }

  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    empresa,
  };
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
    error: "Tu cuenta no está autorizada para esta aplicación",
  });
}

function companyMismatchResponse(res: Response, empresa: "beck" | "firemat") {
  const nombre = empresa === "firemat" ? "Firemat" : "Beck";
  return res.status(403).json({
    success: false,
    error: `Esta cuenta pertenece al acceso ${nombre}`,
    code: "EMPRESA_MISMATCH",
    empresa,
  });
}

export async function microsoftLogin(req: Request, res: Response) {
  try {
    const idToken = req.body?.idToken;
    const empresaSolicitada = normalizarEmpresa(req.body?.empresa);

    if (
      typeof idToken !== "string" ||
      !idToken.trim() ||
      idToken.length > 20_000
    ) {
      return res.status(400).json({
        success: false,
        error: "Falta un idToken válido",
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

    const empresaUsuario = obtenerEmpresaUsuario(usuario.email, usuario.rol);
    if (!empresaUsuario) {
      logAuthFail(microsoftUser.email, getClientIp(req), "role_not_allowed");
      return unauthorizedLoginResponse(res);
    }
    if (empresaSolicitada && empresaSolicitada !== empresaUsuario) {
      logAuthFail(microsoftUser.email, getClientIp(req), "company_mismatch");
      return companyMismatchResponse(res, empresaUsuario);
    }

    if (usuario.azure_id && usuario.azure_id !== microsoftUser.oid) {
      logAuthFail(microsoftUser.email, getClientIp(req), "identity_mismatch");
      return unauthorizedLoginResponse(res);
    }

    if (!usuario.azure_id) {
      const linked = await prisma.usuarios.updateMany({
        where: {
          id: usuario.id,
          azure_id: null,
        },
        data: {
          azure_id: microsoftUser.oid,
          updated_at: new Date(),
        },
      });

      if (linked.count !== 1) {
        const currentOwner = await prisma.usuarios.findFirst({
          where: {
            azure_id: microsoftUser.oid,
            activo: true,
          },
        });

        if (currentOwner?.id !== usuario.id) {
          logAuthFail(microsoftUser.email, getClientIp(req), "link_conflict");
          return unauthorizedLoginResponse(res);
        }

        usuario = currentOwner;
      }
    }

    logAuthOk(microsoftUser.email, usuario.id, usuario.rol, getClientIp(req));
    return res.json(createLoginResponse(usuario));
  } catch (error) {
    console.error(
      "MICROSOFT LOGIN ERROR:",
      IS_PROD ? (error instanceof Error ? error.message : "error") : error
    );

    return res.status(401).json({
      success: false,
      error: "No se pudo iniciar sesión con Microsoft",
    });
  }
}

export async function emailLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body ?? {};
    const empresaSolicitada = normalizarEmpresa(req.body?.empresa);
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

    const empresaUsuario = obtenerEmpresaUsuario(usuario.email, usuario.rol);
    if (!empresaUsuario) {
      logAuthFail(normalizedEmail, getClientIp(req), "role_not_allowed");
      return unauthorizedLoginResponse(res);
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

    if (empresaSolicitada && empresaSolicitada !== empresaUsuario) {
      logAuthFail(normalizedEmail, getClientIp(req), "company_mismatch");
      return companyMismatchResponse(res, empresaUsuario);
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
