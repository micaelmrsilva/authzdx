import { type AuthEnv, createAuth, runAuthMigrations } from "@authzdx/auth";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import pg from "pg";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
const baseUrl = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;
// The admin is a separate origin and sends credentials (the session cookie), so
// CORS must name it explicitly — a wildcard origin is illegal with credentials.
const adminOrigin = process.env.ADMIN_ORIGIN ?? "http://localhost:5173";

if (!databaseUrl) {
  throw new Error("[authzdx auth] DATABASE_URL is required (the Better Auth tables live there).");
}
if (!secret) {
  throw new Error(
    "[authzdx auth] BETTER_AUTH_SECRET is required — generate one with `openssl rand -base64 32`.",
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const env: AuthEnv = {
  secret,
  baseUrl,
  database: pool as unknown as AuthEnv["database"],
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
};

// Idempotent: create/upgrade the Better Auth tables so `dev` needs no manual step.
await runAuthMigrations(env);
const auth = createAuth(env);

const app = new Hono();
app.use(
  "*",
  cors({
    origin: adminOrigin,
    credentials: true,
    allowHeaders: ["content-type", "authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

// Better Auth owns everything under /api/auth/* (sign-in/up, session, JWKS, org…).
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[authzdx auth] listening on http://localhost:${info.port}`);
  console.log(`[authzdx auth] JWKS at ${baseUrl}/api/auth/.well-known/jwks.json`);
});
