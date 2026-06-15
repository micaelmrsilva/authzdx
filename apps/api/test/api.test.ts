import { buildClaims } from "@authzdx/auth";
import { type Db, initProjectDb, openDb } from "@authzdx/db";
import { presets } from "@authzdx/rules";
import { type JSONWebKeySet, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const KID = "api-test-key";

async function makeIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwks: JSONWebKeySet = { keys: [{ ...jwk, kid: KID, alg: "EdDSA", use: "sig" }] };
  const sign = (claims: Record<string, unknown>) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "EdDSA", kid: KID })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey);
  return { jwks, sign };
}

type TablesBody = { tables: { name: string; status: string }[] };
type DataBody = { rows: { id: number }[]; blocked: boolean };

/**
 * The whole stack over HTTP: publish a rule via the API -> it compiles to RLS on
 * the live (pglite) database -> a verified JWT reads through RLS and sees only
 * its own rows. This is the end-to-end proof that the pieces fit.
 */
describe("data API end to end", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let issuer: Awaited<ReturnType<typeof makeIssuer>>;

  beforeAll(async () => {
    db = await openDb();
    await initProjectDb(db);
    await db.exec(
      "create table public.posts (id int primary key, title text not null, user_id text not null);",
    );
    await db.exec(
      "insert into public.posts (id, title, user_id) values (1, 'Alice', 'user_alice'), (2, 'Bob', 'user_bob');",
    );
    issuer = await makeIssuer();
    app = createApp({ db, jwks: issuer.jwks });
  });

  afterAll(async () => {
    await db?.close();
  });

  it("a freshly created table reports as exposed (RLS off)", async () => {
    const body = (await (await app.request("/tables")).json()) as TablesBody;
    expect(body.tables.find((t) => t.name === "posts")?.status).toBe("exposed");
  });

  it("publishing the owner rule locks it down", async () => {
    const res = await app.request("/tables/posts/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules: { read: [presets.owner("user_id")] } }),
    });
    expect(res.status).toBe(200);
    const body = (await (await app.request("/tables")).json()) as TablesBody;
    expect(body.tables.find((t) => t.name === "posts")?.status).toBe("configured");
  });

  it("a verified JWT sees only the caller's rows", async () => {
    const token = await issuer.sign(buildClaims({ userId: "user_alice" }));
    const body = (await (
      await app.request("/data/posts", { headers: { authorization: `Bearer ${token}` } })
    ).json()) as DataBody;
    expect(body.rows.map((r) => r.id)).toEqual([1]);
  });

  it("no token -> anon -> hard-blocked (safe by default)", async () => {
    const body = (await (await app.request("/data/posts")).json()) as DataBody;
    expect(body.blocked).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it("a forged token is rejected with 401", async () => {
    const attacker = await makeIssuer();
    const forged = await attacker.sign(buildClaims({ userId: "user_alice" }));
    const res = await app.request("/data/posts", {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });

  it("simulate answers 'as user X' against the live table", async () => {
    const res = await app.request("/tables/posts/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ as: { sub: "user_bob" } }),
    });
    const body = (await res.json()) as DataBody;
    expect(body.rows.map((r) => r.id)).toEqual([2]);
  });
});
