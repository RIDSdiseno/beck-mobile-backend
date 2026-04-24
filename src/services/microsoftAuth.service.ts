import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env";

type MicrosoftUser = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
};

const issuer = `https://login.microsoftonline.com/${env.azureTenantId}/v2.0`;
const jwks = createRemoteJWKSet(
  new URL(
    `https://login.microsoftonline.com/${env.azureTenantId}/discovery/v2.0/keys`
  )
);

function decodeName(payload: any): string {
  return (
    payload.name ||
    payload.preferred_username ||
    payload.email ||
    "Usuario Microsoft"
  );
}

function decodeEmail(payload: any): string {
  return payload.preferred_username || payload.email || payload.upn || "";
}

function mapRoleByEmail(email: string): string {
  if (!email) return "USUARIO";
  return "USUARIO";
}

export async function verifyMicrosoftIdToken(
  idToken: string
): Promise<MicrosoftUser> {
  const verified = await jwtVerify(idToken, jwks, {
    issuer,
    audience: env.azureClientId,
  });

  const payloadJwt = verified.payload as any;
  const email = decodeEmail(payloadJwt);

  return {
    id: String(payloadJwt.oid || payloadJwt.sub || ""),
    nombre: decodeName(payloadJwt),
    email,
    rol: mapRoleByEmail(email),
  };
}