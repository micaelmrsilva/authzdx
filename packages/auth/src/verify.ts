import { type JSONWebKeySet, createLocalJWKSet, jwtVerify } from "jose";
import type { AuthzdxClaims } from "./claims";

export interface VerifyOptions {
  issuer?: string;
  audience?: string;
}

/**
 * API-side verification: verify a JWT against the issuer's JWKS — offline, no
 * round-trip — and return the authzdx claims. This is what the data API must run
 * before it ever sets `request.jwt.claims`. Claims are NEVER trusted from the
 * client without passing through here.
 */
export async function verifyClaims(
  token: string,
  jwks: JSONWebKeySet,
  opts: VerifyOptions = {},
): Promise<AuthzdxClaims> {
  const keySet = createLocalJWKSet(jwks);
  const { payload } = await jwtVerify(token, keySet, {
    issuer: opts.issuer,
    audience: opts.audience,
  });

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("verified token is missing a 'sub' claim");
  }

  const org = payload.org_id;
  const role = payload.role;
  return {
    ...payload,
    sub: payload.sub,
    org_id: typeof org === "string" ? org : null,
    role: typeof role === "string" ? role : null,
  };
}
