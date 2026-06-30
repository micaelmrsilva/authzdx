import { type JSONWebKeySet, type JWTVerifyGetKey, createLocalJWKSet, jwtVerify } from "jose";
import type { AuthzdxClaims } from "./claims";

export interface VerifyOptions {
  issuer?: string;
  audience?: string;
}

/**
 * A key source: either a static JWKS (verified against an in-memory set) or a
 * jose key-getter — e.g. `createRemoteJWKSet(url)`, which fetches on demand,
 * caches, and follows key rotation. Both verify the signature locally; only how
 * the public keys are obtained differs.
 */
export type KeySource = JSONWebKeySet | JWTVerifyGetKey;

/**
 * API-side verification: verify a JWT against the issuer's keys and return the
 * authzdx claims. This is what the data API must run before it ever sets
 * `request.jwt.claims`. Claims are NEVER trusted from the client without passing
 * through here.
 */
export async function verifyClaims(
  token: string,
  keys: KeySource,
  opts: VerifyOptions = {},
): Promise<AuthzdxClaims> {
  const keySet = typeof keys === "function" ? keys : createLocalJWKSet(keys);
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
