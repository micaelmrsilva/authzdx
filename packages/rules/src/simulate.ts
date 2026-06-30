/**
 * The simulator — "as user X, can I read row Y?".
 *
 * Crucial design rule (learned from SpiceDB's playground): the simulator runs the
 * REAL compiled policy against a REAL Postgres, never a re-implementation. We use
 * pglite (Postgres compiled to WASM) so it runs in-process with no Docker. The
 * same `compileRules` output that ships to production is what we evaluate here —
 * if the simulator says "safe", it is safe for the same reason production is.
 */

import { type CompileOptions, compileRules } from "./compile";
import type { TableRules } from "./presets";
import { BOOTSTRAP_SQL, qualified, quoteIdent } from "./sql";

/** A synthetic identity to evaluate against (accepts verified-claim shapes with nulls). */
export interface SimUser {
  sub?: string | null;
  org_id?: string | null;
  role?: string | null;
  roles?: string[];
}

export interface SimulateOptions extends CompileOptions {
  /** DDL that creates the table(s) under test. */
  ddl: string;
  /** Optional INSERTs, run as the table owner so they bypass RLS (seed data). */
  seedSql?: string;
  /** The rules to compile and enforce. */
  rules: TableRules;
}

export interface ReadResult {
  rows: Record<string, unknown>[];
  /** True when the role has no access at all (hard permission denial). */
  blocked: boolean;
}

export interface WriteResult {
  /** True when RLS permitted the write and it took effect (>=1 row). */
  ok: boolean;
  /** Rows inserted / updated / deleted (0 when RLS filtered them out). */
  affected: number;
  /**
   * Why a write was not allowed:
   *  - "policy": a WITH CHECK / missing-policy / missing-GRANT hard denial (raised)
   *  - "no-match": the op ran but USING filtered every candidate row (0 affected)
   * Undefined when `ok` is true.
   */
  denied?: "policy" | "no-match";
}

/** The subset of a pglite query result the simulator needs. */
interface RawResult {
  rows: unknown[];
  affectedRows?: number;
}

/**
 * A self-contained, in-memory database with the rules applied. Construct with
 * `Simulator.create(...)`, then ask questions with `.read(...)`.
 */
export class Simulator {
  // biome-ignore lint/suspicious/noExplicitAny: pglite has no exported instance type at this layer.
  private readonly db: any;
  private readonly opts: SimulateOptions;
  private readonly apiRole: string;
  private readonly anonRole: string;

  // biome-ignore lint/suspicious/noExplicitAny: see above.
  private constructor(db: any, opts: SimulateOptions) {
    this.db = db;
    this.opts = opts;
    this.apiRole = opts.apiRole ?? "authenticated";
    this.anonRole = opts.anonRole ?? "anon";
  }

  static async create(opts: SimulateOptions): Promise<Simulator> {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    const apiRole = opts.apiRole ?? "authenticated";
    const anonRole = opts.anonRole ?? "anon";

    await db.exec(BOOTSTRAP_SQL);
    await db.exec(`create role ${quoteIdent(anonRole)} nologin;`);
    await db.exec(`create role ${quoteIdent(apiRole)} nologin;`);
    await db.exec(
      `grant usage on schema public to ${quoteIdent(anonRole)}, ${quoteIdent(apiRole)};`,
    );
    await db.exec(opts.ddl);
    if (opts.seedSql) await db.exec(opts.seedSql);
    await db.exec(compileRules(opts.rules, { apiRole, anonRole, schema: opts.schema }));

    return new Simulator(db, opts);
  }

  private get table(): string {
    const schema = this.opts.rules.schema ?? this.opts.schema ?? "public";
    return qualified(schema, this.opts.rules.table);
  }

  /**
   * Run `fn` as the given identity inside a rolled-back transaction: set the
   * claims (as superuser), drop into the limited role so RLS applies, execute,
   * then ALWAYS roll back so probes never mutate the simulated database. Returns
   * `null` if any statement raised (a hard RLS / permission denial).
   */
  private async runAs(
    as: SimUser | "anon",
    // biome-ignore lint/suspicious/noExplicitAny: pglite query handle, see class note.
    fn: (db: any) => Promise<RawResult>,
  ): Promise<RawResult | null> {
    const role = as === "anon" ? this.anonRole : this.apiRole;
    const claims = as === "anon" ? {} : toClaims(as);
    try {
      await this.db.exec("begin");
      await this.db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      await this.db.exec(`set local role ${quoteIdent(role)};`);
      const value = await fn(this.db);
      await this.db.exec("rollback");
      return value;
    } catch {
      try {
        await this.db.exec("rollback");
      } catch {
        // ignore — transaction may already be aborted
      }
      return null;
    }
  }

  /** Read the table as a given identity (or "anon" for an unauthenticated caller). */
  async read(as: SimUser | "anon"): Promise<ReadResult> {
    const t = this.table;
    const res = await this.runAs(as, (db) => db.query(`select * from ${t} order by 1`));
    if (res === null) return { rows: [], blocked: true };
    return { rows: (res.rows as Record<string, unknown>[]) ?? [], blocked: false };
  }

  /** Try to INSERT `values` as a given identity. RLS WITH CHECK governs it. */
  async create(as: SimUser | "anon", values: Record<string, unknown>): Promise<WriteResult> {
    const cols = Object.keys(values);
    const idents = cols.map((c) => quoteIdent(c)).join(", ");
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const params = cols.map((c) => values[c]);
    const sql = `insert into ${this.table} (${idents}) values (${placeholders})`;
    const res = await this.runAs(as, (db) => db.query(sql, params));
    return toWriteResult(res);
  }

  /** Try to UPDATE rows matching `match`, applying `changes`, as a given identity. */
  async update(
    as: SimUser | "anon",
    match: Record<string, unknown>,
    changes: Record<string, unknown>,
  ): Promise<WriteResult> {
    const setCols = Object.keys(changes);
    const whereCols = Object.keys(match);
    const setClause = setCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(", ");
    const whereClause = whereCols
      .map((c, i) => `${quoteIdent(c)} = $${setCols.length + i + 1}`)
      .join(" and ");
    const params = [...setCols.map((c) => changes[c]), ...whereCols.map((c) => match[c])];
    const sql = `update ${this.table} set ${setClause} where ${whereClause}`;
    const res = await this.runAs(as, (db) => db.query(sql, params));
    return toWriteResult(res);
  }

  /** Try to DELETE rows matching `match` as a given identity. */
  async delete(as: SimUser | "anon", match: Record<string, unknown>): Promise<WriteResult> {
    const whereCols = Object.keys(match);
    const whereClause = whereCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(" and ");
    const params = whereCols.map((c) => match[c]);
    const sql = `delete from ${this.table} where ${whereClause}`;
    const res = await this.runAs(as, (db) => db.query(sql, params));
    return toWriteResult(res);
  }

  /** The exact SQL applied to enforce these rules (what would ship to production). */
  compiledSql(): string {
    return compileRules(this.opts.rules, {
      apiRole: this.apiRole,
      anonRole: this.anonRole,
      schema: this.opts.schema,
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Interpret a write probe by rows actually affected — NOT by RETURNING, which is
 * itself gated by the SELECT policy (a successful write with no read rule would
 * otherwise look like it changed nothing).
 *   - `null`        -> the statement raised: WITH CHECK violation / missing GRANT
 *   - affected === 0 -> the op ran but USING filtered every candidate row
 */
function toWriteResult(res: RawResult | null): WriteResult {
  if (res === null) return { ok: false, affected: 0, denied: "policy" };
  const affected = res.affectedRows ?? 0;
  if (affected === 0) return { ok: false, affected: 0, denied: "no-match" };
  return { ok: true, affected };
}

function toClaims(u: SimUser): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (u.sub != null) claims.sub = u.sub;
  if (u.org_id != null) claims.org_id = u.org_id;
  if (u.role != null) claims.role = u.role;
  if (u.roles != null) claims.roles = u.roles;
  return claims;
}
