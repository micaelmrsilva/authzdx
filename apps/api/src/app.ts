import { type AuthzdxClaims, verifyClaims } from "@authzdx/auth";
import type { Db } from "@authzdx/db";
import { type TableRules, compileRules } from "@authzdx/rules";
import { Hono } from "hono";
import type { JSONWebKeySet } from "jose";
import { selectAs } from "./data";

export interface ApiConfig {
  db: Db;
  /** The issuer's JWKS (from Better Auth's /.well-known/jwks.json). */
  jwks: JSONWebKeySet;
  apiRole?: string;
  anonRole?: string;
}

const SCHEMA = "public";

export function createApp(config: ApiConfig) {
  const apiRole = config.apiRole ?? "authenticated";
  const anonRole = config.anonRole ?? "anon";
  const app = new Hono();

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
      tables: rows.map((r) => ({
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
    const body = (await c.req.json()) as { as: AuthzdxClaims | "anon" };
    const isAnon = body.as === "anon";
    const result = await selectAs(config.db, {
      schema: SCHEMA,
      table: c.req.param("table"),
      claims: isAnon ? {} : (body.as as Record<string, unknown>),
      role: isAnon ? anonRole : apiRole,
    });
    return c.json(result);
  });

  // ---- data plane (apps consume this) ----

  /** Read a table through RLS, gated by a verified JWT. */
  app.get("/data/:table", async (c) => {
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      // No token -> anon role. Locked-by-default unless a public_read rule exists.
      const result = await selectAs(config.db, {
        schema: SCHEMA,
        table: c.req.param("table"),
        claims: {},
        role: anonRole,
      });
      return c.json(result);
    }

    let claims: AuthzdxClaims;
    try {
      claims = await verifyClaims(token, config.jwks);
    } catch {
      return c.json({ error: "invalid token" }, 401);
    }

    const result = await selectAs(config.db, {
      schema: SCHEMA,
      table: c.req.param("table"),
      claims: claims as unknown as Record<string, unknown>,
      role: apiRole,
    });
    return c.json(result);
  });

  return app;
}
