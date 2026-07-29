import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${name}`);
  }
  return value;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres");
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const port = Number(process.env.PORT || 3001);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT debe ser un puerto TCP válido");
}

export const env = {
  nodeEnv,
  isProduction,
  port,
  corsOrigin: process.env.CORS_ORIGIN || "none",
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  jwtIssuer: process.env.JWT_ISSUER || "beck-mobile-backend",
  jwtAudience: process.env.JWT_AUDIENCE || "beck-app",
  cloudinaryCloudName: required("CLOUDINARY_CLOUD_NAME"),
  cloudinaryApiKey: required("CLOUDINARY_API_KEY"),
  cloudinaryApiSecret: required("CLOUDINARY_API_SECRET"),
  databaseSsl: process.env.DATABASE_SSL !== "false",
  trustProxy: process.env.TRUST_PROXY || (isProduction ? "1" : "false"),
};
