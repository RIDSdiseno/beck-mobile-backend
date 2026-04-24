import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 3001),
  azureClientId: required("AZURE_AD_CLIENT_ID"),
  azureTenantId: required("AZURE_AD_TENANT_ID"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
};