import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import type { EmpresaApp } from "./empresa.service";

export type AppJwtPayload = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  empresa: EmpresaApp;
};

export function signAppToken(payload: AppJwtPayload) {
  return jwt.sign(payload, env.jwtSecret as Secret, {
    algorithm: "HS256",
    expiresIn: (env.jwtExpiresIn || "8h") as SignOptions["expiresIn"],
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    jwtid: randomUUID(),
  });
}
