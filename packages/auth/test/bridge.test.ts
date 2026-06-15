import { Simulator, type TableRules, presets } from "@authzdx/rules";
import { type JSONWebKeySet, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthzdxClaims, buildClaims, verifyClaims } from "../src/index";

/**
 * The auth -> authz bridge, proven with REAL crypto:
 *   buildClaims -> sign EdDSA JWT -> verify via JWKS (offline) -> request.jwt.claims -> RLS.
 *
 * This is the same asymmetric-sign + JWKS-verify path Better Auth uses, and the
 * same claim names `definePayload` injects. (A full Better-Auth HTTP sign-in e2e
 * is a follow-up — see the m1 plan; here we lock the cryptographic contract.)
 */

const KID = "test-key-1";

async function makeIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwks: JSONWebKeySet = { keys: [{ ...jwk, kid: KID, alg: "EdDSA", use: "sig" }] };

  async function sign(claims: AuthzdxClaims, key = privateKey): Promise<string> {
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: KID })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(key);
  }

  return { jwks, sign };
}

const ddl = `
  create table public.posts (
    id int primary key,
    title text not null,
    user_id text not null
  );
`;
const seedSql = `
  insert into public.posts (id, title, user_id) values
    (1, 'Alice draft', 'user_alice'),
    (2, 'Bob draft', 'user_bob');
`;
const rules: TableRules = { table: "posts", rules: { read: [presets.owner("user_id")] } };

describe("auth -> authz bridge", () => {
  let sim: Simulator;
  let issuer: Awaited<ReturnType<typeof makeIssuer>>;

  beforeAll(async () => {
    sim = await Simulator.create({ ddl, seedSql, rules });
    issuer = await makeIssuer();
  });

  afterAll(async () => {
    await sim?.close();
  });

  it("buildClaims maps a session to the rules contract", () => {
    expect(
      buildClaims({ userId: "u1", activeOrganizationId: "org1", activeRole: "admin" }),
    ).toEqual({
      sub: "u1",
      org_id: "org1",
      role: "admin",
    });
  });

  it("a real JWT for Alice drives RLS to her row only", async () => {
    const token = await issuer.sign(buildClaims({ userId: "user_alice" }));
    const claims = await verifyClaims(token, issuer.jwks);
    expect(claims.sub).toBe("user_alice");

    const r = await sim.read(claims);
    expect(r.blocked).toBe(false);
    expect(r.rows.map((row) => row.id)).toEqual([1]);
  });

  it("a real JWT for Bob drives RLS to his row only", async () => {
    const token = await issuer.sign(buildClaims({ userId: "user_bob" }));
    const claims = await verifyClaims(token, issuer.jwks);
    const r = await sim.read(claims);
    expect(r.rows.map((row) => row.id)).toEqual([2]);
  });

  it("rejects a token signed by an attacker's key (never reaches RLS)", async () => {
    const attacker = await generateKeyPair("EdDSA", { extractable: true });
    const forged = await issuer.sign(buildClaims({ userId: "user_alice" }), attacker.privateKey);
    await expect(verifyClaims(forged, issuer.jwks)).rejects.toThrow();
  });
});
