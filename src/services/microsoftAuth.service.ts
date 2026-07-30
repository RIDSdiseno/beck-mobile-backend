import { env } from "../config/env";

export type MicrosoftUserClaims = {
  oid: string;
  email: string;
  name: string;
};

const issuer = `https://login.microsoftonline.com/${env.azureTenantId}/v2.0`;
let jwks: any;

async function getMicrosoftJwtVerifier() {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");

  jwks ??= createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${env.azureTenantId}/discovery/v2.0/keys`
    )
  );

  return { jwtVerify, jwks };
}

function stringClaim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function verifyMicrosoftIdToken(
  idToken: string
): Promise<MicrosoftUserClaims> {
  const verifier = await getMicrosoftJwtVerifier();
  const verified = await verifier.jwtVerify(idToken, verifier.jwks, {
    issuer,
    audience: env.azureClientId,
  });
  const payload = verified.payload;
  const email = (
    stringClaim(payload, "preferred_username") ||
    stringClaim(payload, "email") ||
    stringClaim(payload, "upn")
  ).toLowerCase();
  const oid = stringClaim(payload, "oid") || stringClaim(payload, "sub");
  const name =
    stringClaim(payload, "name") ||
    stringClaim(payload, "preferred_username") ||
    email ||
    "Usuario Microsoft";

  if (!email || !email.includes("@")) {
    throw new Error("Microsoft no devolvió un email válido");
  }

  if (!oid) {
    throw new Error("Microsoft no devolvió un identificador válido");
  }

  return { oid, email, name };
}
