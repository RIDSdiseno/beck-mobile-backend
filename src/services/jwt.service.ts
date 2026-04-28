import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type AppJwtPayload = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
};

export function signAppToken(payload: AppJwtPayload) {
  return jwt.sign(payload, env.jwtSecret as Secret, {
    expiresIn: (env.jwtExpiresIn || "8h") as SignOptions["expiresIn"],
  });
}