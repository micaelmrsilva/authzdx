/**
 * The database seam. Same code, two backends:
 *   - no URL / "pglite..."  -> pglite (Postgres in WASM, no Docker) for dev + CI
 *   - "postgres://..."      -> standard Postgres for production (adapter: follow-up)
 *
 * RLS — the whole enforcement model — is a Postgres feature, so the engine is
 * always Postgres; only where it runs changes.
 */

import { BOOTSTRAP_SQL, quoteIdent, quoteLiteral } from "@authzdx/rules";

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  /**
   * - `undefined` / `"pglite:memory"` -> in-memory pglite
   * - `"pglite://./data"`             -> persistent pglite at ./data (no Docker)
   * - `"postgres://..."`              -> standard Postgres (adapter not wired yet)
   */
  url?: string;
}

export async function openDb(opts: OpenDbOptions = {}): Promise<Db> {
  const url = opts.url;
  if (!url || url.startsWith("pglite")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir = url && url !== "pglite:memory" ? url.replace(/^pglite:\/\//, "") : undefined;
    const pg = dataDir ? new PGlite(dataDir) : new PGlite();
    return {
      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
        const res = await pg.query<T>(sql, params as unknown[]);
        return { rows: res.rows };
      },
      async exec(sql: string) {
        await pg.exec(sql);
      },
      async close() {
        await pg.close();
      },
    };
  }
  throw new Error(
    `@authzdx/db: only pglite is wired for now (got "${url}"). The postgres.js adapter for real Postgres is a small follow-up — see README.`,
  );
}

export interface InitOptions {
  apiRole?: string;
  anonRole?: string;
}

/**
 * One-time per-database setup: the claim helper functions (authzdx.uid() etc.)
 * and the anon/authenticated roles the rules engine targets. Idempotent.
 */
export async function initProjectDb(db: Db, opts: InitOptions = {}): Promise<void> {
  const apiRole = opts.apiRole ?? "authenticated";
  const anonRole = opts.anonRole ?? "anon";
  await db.exec(BOOTSTRAP_SQL);
  await db.exec(
    `do $$ begin
       if not exists (select from pg_roles where rolname = ${quoteLiteral(anonRole)}) then create role ${quoteIdent(anonRole)} nologin; end if;
       if not exists (select from pg_roles where rolname = ${quoteLiteral(apiRole)}) then create role ${quoteIdent(apiRole)} nologin; end if;
     end $$;`,
  );
  await db.exec(`grant usage on schema public to ${quoteIdent(anonRole)}, ${quoteIdent(apiRole)};`);
}
