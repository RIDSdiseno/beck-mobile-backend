import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type AppJwtPayload = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
};

export function signAppToken(payload: AppJwtPayload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn || "8h",
  });
}