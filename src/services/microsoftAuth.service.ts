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

function decodeName(payload: any): string {
  return (
    payload.name ||
    payload.preferred_username ||
    payload.email ||
    "Usuario Microsoft"
  );
}

function decodeEmail(payload: any): string {
  return String(
    payload.preferred_username || payload.email || payload.upn || ""
  )
    .toLowerCase()
    .trim();
}

export async function verifyMicrosoftIdToken(
  idToken: string
): Promise<MicrosoftUserClaims> {
  const { jwtVerify, jwks } = await getMicrosoftJwtVerifier();

  const verified = await jwtVerify(idToken, jwks, {
    issuer,
    audience: env.azureClientId,
  });

  const payloadJwt = verified.payload as any;

  const email = decodeEmail(payloadJwt);
  const oid = String(payloadJwt.oid || payloadJwt.sub || "").trim();
  const name = decodeName(payloadJwt);

  if (!email) {
    throw new Error("Microsoft no devolvió un email válido");
  }

  if (!oid) {
    throw new Error("Microsoft no devolvió un oid válido");
  }

  return {
    oid,
    email,
    name,
  };
}
