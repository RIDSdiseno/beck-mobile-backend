import jwt from "jsonwebtoken";
import { env } from "../config/env";

type AppUser = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
};

export function signAppToken(user: AppUser): string {
  return jwt.sign(user, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as any,
  });
}