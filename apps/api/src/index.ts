import { initProjectDb, openDb } from "@authzdx/db";
import { serve } from "@hono/node-server";
import type { JSONWebKeySet } from "jose";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL; // unset -> in-memory pglite
const jwksUrl = process.env.AUTH_JWKS_URL ?? "http://localhost:3000/.well-known/jwks.json";

const db = await openDb({ url: databaseUrl });
await initProjectDb(db);

// v0: snapshot the JWKS at boot. A rotating/remote JWKS (createRemoteJWKSet) is
// the production follow-up.
let jwks: JSONWebKeySet = { keys: [] };
try {
  jwks = (await fetch(jwksUrl).then((r) => r.json())) as JSONWebKeySet;
} catch {
  console.warn(
    `[authzdx api] could not fetch JWKS from ${jwksUrl} — the data plane will reject tokens until auth is up`,
  );
}

const app = createApp({ db, jwks });
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[authzdx api] listening on http://localhost:${info.port}`);
});
