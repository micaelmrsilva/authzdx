import { type AuthzdxClaims, type KeySource, verifyClaims } from "@authzdx/auth";
import type { Db } from "@authzdx/db";
import { type Action, type TableRules, compileRules } from "@authzdx/rules";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { type Identity, deleteAs, insertAs, selectAs, updateAs } from "./data";

export interface ApiConfig {
  db: Db;
  /**
   * The issuer's keys: a static JWKS (tests) or a remote key-getter from
   * `createRemoteJWKSet(<auth>/api/auth/.well-known/jwks.json)` (production —
   * lazy fetch, cache, rotation).
   */
  jwks: KeySource;
  apiRole?: string;
  anonRole?: string;
}

const SCHEMA = "public";

/**
 * Better Auth's own tables live in `public` too. They are the auth system's
 * private store (reached only by the auth server as table owner, never via the
 * data API), so the control plane hides them — a non-dev should not see "user"
 * or "jwks" listed as "exposed" and try to lock them.
 */
const SYSTEM_TABLES = new Set([
  "user",
  "session",
  "account",
  "verification",
  "jwks",
  "organization",
  "member",
  "invitation",
  "team",
  "teamMember",
]);

export function createApp(config: ApiConfig) {
  const apiRole = config.apiRole ?? "authenticated";
  const anonRole = config.anonRole ?? "anon";
  const app = new Hono();
  // v0: permissive CORS so the admin (a separate origin) can call the API.
  // Tighten to the admin's origin in production.
  app.use("*", cors());

  // ---- control plane (drives the admin) ----

  /** List tables with their lock status. */
  app.get("/tables", async (c) => {
    const { rows } = await config.db.query<{
      table: string;
      rls_enabled: boolean;
      policies: number;
    }>(
      `select c.relname as table,
              c.relrowsecurity as rls_enabled,
              (select count(*) from pg_policies p
                where p.schemaname = n.nspname and p.tablename = c.relname)::int as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and c.relkind = 'r'
        order by 1`,
      [SCHEMA],
    );
    return c.json({
      tables: rows
        .filter((r) => !SYSTEM_TABLES.has(r.table))
        .map((r) => ({
          name: r.table,
          rlsEnabled: r.rls_enabled,
          policies: r.policies,
          status: !r.rls_enabled ? "exposed" : r.policies === 0 ? "locked" : "configured",
        })),
    });
  });

  /** Publish rules for a table (compile presets -> RLS, locked by default). */
  app.post("/tables/:table/rules", async (c) => {
    const body = (await c.req.json()) as { rules: TableRules["rules"] };
    const rules: TableRules = { table: c.req.param("table"), schema: SCHEMA, rules: body.rules };
    const sql = compileRules(rules, { apiRole, anonRole });
    await config.db.exec(sql);
    return c.json({ applied: true, sql });
  });

  /** Simulate "as user X" against the live table — the heart of the admin. */
  app.post("/tables/:table/simulate", async (c) => {
    const body = (await c.req.json()) as {
      as: AuthzdxClaims | "anon";
      action?: Action;
      values?: Record<string, unknown>;
      match?: Record<string, unknown>;
    };
    const table = c.req.param("table");
    const isAnon = body.as === "anon";
    const id: Identity = {
      claims: isAnon ? {} : (body.as as Record<string, unknown>),
      role: isAnon ? anonRole : apiRole,
    };
    const args = { schema: SCHEMA, table, ...id };

    switch (body.action ?? "read") {
      case "create":
        return c.json(await insertAs(config.db, { ...args, values: body.values }));
      case "update":
        return c.json(
          await updateAs(config.db, { ...args, values: body.values, match: body.match }),
        );
      case "delete":
        return c.json(await deleteAs(config.db, { ...args, match: body.match }));
      default:
        return c.json(await selectAs(config.db, args));
    }
  });

  // ---- data plane (apps consume this) ----

  /**
   * Resolve the caller's identity from the Authorization header: a verified JWT
   * yields the api role + its claims; no token falls back to the anon role
   * (locked by default). Returns a 401 Response if a token is present but invalid.
   */
  async function identityFor(c: Context): Promise<Identity | Response> {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return { claims: {}, role: anonRole };
    try {
      const claims = await verifyClaims(token, config.jwks);
      return { claims: claims as unknown as Record<string, unknown>, role: apiRole };
    } catch {
      return c.json({ error: "invalid token" }, 401);
    }
  }

  /** Read a table through RLS, gated by a verified JWT. */
  app.get("/data/:table", async (c) => {
    const id = await identityFor(c);
    if (id instanceof Response) return id;
    return c.json(
      await selectAs(config.db, { schema: SCHEMA, table: c.req.param("table"), ...id }),
    );
  });

  /** Insert a row through RLS, gated by a verified JWT. */
  app.post("/data/:table", async (c) => {
    const id = await identityFor(c);
    if (id instanceof Response) return id;
    const body = (await c.req.json()) as { values?: Record<string, unknown> };
    const result = await insertAs(config.db, {
      schema: SCHEMA,
      table: c.req.param("table"),
      values: body.values,
      ...id,
    });
    return c.json(result, result.ok ? 200 : 403);
  });

  /** Update rows matching `match` through RLS, gated by a verified JWT. */
  app.patch("/data/:table", async (c) => {
    const id = await identityFor(c);
    if (id instanceof Response) return id;
    const body = (await c.req.json()) as {
      match?: Record<string, unknown>;
      values?: Record<string, unknown>;
    };
    const result = await updateAs(config.db, {
      schema: SCHEMA,
      table: c.req.param("table"),
      match: body.match,
      values: body.values,
      ...id,
    });
    return c.json(result, result.ok ? 200 : 403);
  });

  /** Delete rows matching `match` through RLS, gated by a verified JWT. */
  app.delete("/data/:table", async (c) => {
    const id = await identityFor(c);
    if (id instanceof Response) return id;
    const body = (await c.req.json().catch(() => ({}))) as { match?: Record<string, unknown> };
    const result = await deleteAs(config.db, {
      schema: SCHEMA,
      table: c.req.param("table"),
      match: body.match,
      ...id,
    });
    return c.json(result, result.ok ? 200 : 403);
  });

  return app;
}
