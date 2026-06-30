/**
 * The database seam. Same code, two backends:
 *   - no URL / "pglite..."  -> pglite (Postgres in WASM, no Docker) for dev + CI
 *   - "postgres://..."      -> standard Postgres for production (postgres.js)
 *
 * RLS — the whole enforcement model — is a Postgres feature, so the engine is
 * always Postgres; only where it runs changes.
 */

import { BOOTSTRAP_SQL, quoteIdent, quoteLiteral } from "@authzdx/rules";

export interface QueryResult<T> {
  rows: T[];
  /** Rows affected by a write (INSERT/UPDATE/DELETE). Undefined for plain reads. */
  affected?: number;
}

/**
 * A handle that issues statements on a *single* backing connection. Outside a
 * `reserve(...)` block there is no such guarantee — on a pooled backend each
 * top-level `query`/`exec` may run on a different connection.
 */
export interface Conn {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Conn {
  /**
   * Run `fn` with one connection pinned for its whole duration. This is the only
   * safe way to use transaction-scoped session state — `begin … set local role …
   * rollback` — because on a pooled backend those statements must all land on the
   * SAME connection. The caller drives begin/commit/rollback explicitly; `reserve`
   * only guarantees connection identity (and serializes overlapping calls so two
   * transactions never interleave).
   */
  reserve<T>(fn: (conn: Conn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  /**
   * - `undefined` / `"pglite:memory"` -> in-memory pglite
   * - `"pglite://./data"`             -> persistent pglite at ./data (no Docker)
   * - `"postgres://..."` / `"postgresql://..."` -> standard Postgres (postgres.js)
   */
  url?: string;
  /** Max pooled connections for the Postgres backend. Default 10. */
  max?: number;
}

export async function openDb(opts: OpenDbOptions = {}): Promise<Db> {
  const url = opts.url;
  if (!url || url.startsWith("pglite")) {
    return openPglite(url);
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return openPostgres(url, opts.max ?? 10);
  }
  throw new Error(
    `@authzdx/db: unrecognized DATABASE_URL "${url}" — expected a pglite:* or postgres(ql)://… URL.`,
  );
}

/** In-process Postgres (WASM). One connection, so `reserve` just serializes. */
async function openPglite(url?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = url && url !== "pglite:memory" ? url.replace(/^pglite:\/\//, "") : undefined;
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();

  const conn: Conn = {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const res = await pg.query<T>(sql, params as unknown[]);
      return { rows: res.rows, affected: res.affectedRows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
  };

  // pglite has a single backing connection, so concurrent transactions would
  // interleave their begin/rollback. A promise-chain mutex makes `reserve`
  // blocks run one at a time — matching what a pooled backend gives each
  // reserved connection.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...conn,
    reserve<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
      const run = tail.then(() => fn(conn));
      tail = run.catch(() => {});
      return run;
    },
    async close() {
      await pg.close();
    },
  };
}

/** Standard Postgres via postgres.js. Pooled; `reserve` pins one connection. */
async function openPostgres(url: string, max: number): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // `prepare: false` keeps `sql.unsafe(multiStatement)` in the simple protocol so
  // our compiled DDL (many statements in one string) runs as one round-trip.
  const sql = postgres(url, { max, prepare: false, onnotice: () => {} });

  const wrap = (h: typeof sql): Conn => ({
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      // postgres.js returns the rows array with a `.count` of rows returned/affected.
      const res = await h.unsafe(text, params as never[]);
      return { rows: res as unknown as T[], affected: res.count };
    },
    async exec(text: string) {
      await h.unsafe(text);
    },
  });

  return {
    ...wrap(sql),
    async reserve<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
      const reserved = await sql.reserve();
      try {
        return await fn(wrap(reserved as unknown as typeof sql));
      } finally {
        // Never hand a dirty connection back to the pool: if `fn` threw mid-
        // transaction (e.g. an RLS permission denial), the connection is left in
        // an aborted transaction. A best-effort rollback guarantees the next
        // borrower starts clean. (Harmless no-op when not in a transaction.)
        await reserved.unsafe("rollback").catch(() => {});
        reserved.release();
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
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
