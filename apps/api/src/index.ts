import { initProjectDb, openDb } from "@authzdx/db";
import { serve } from "@hono/node-server";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL; // unset -> in-memory pglite
const authUrl = process.env.AUTH_URL ?? "http://localhost:3000";
const jwksUrl = process.env.AUTH_JWKS_URL ?? `${authUrl}/api/auth/.well-known/jwks.json`;

const db = await openDb({ url: databaseUrl });
await initProjectDb(db);

// Local demo convenience: on throwaway in-memory pglite, seed a sample table so
// the admin has something to show. Never runs against a real database.
if (!databaseUrl) {
  await db.exec(
    "create table if not exists public.posts (id serial primary key, title text not null, user_id text not null)",
  );
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.posts");
  if (rows[0]?.n === 0) {
    await db.exec(
      "insert into public.posts (title, user_id) values ('Alice draft', 'user_alice'), ('Bob draft', 'user_bob')",
    );
  }
}

// Remote JWKS: fetched lazily on first verify, cached, and re-fetched on key
// rotation. No boot-time race with the auth server, and no snapshot to go stale.
const jwks = createRemoteJWKSet(new URL(jwksUrl));

const app = createApp({ db, jwks });
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[authzdx api] listening on http://localhost:${info.port}`);
  console.log(`[authzdx api] verifying JWTs against ${jwksUrl}`);
});
