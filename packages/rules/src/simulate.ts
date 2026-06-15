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

  /** Read the table as a given identity (or "anon" for an unauthenticated caller). */
  async read(as: SimUser | "anon"): Promise<ReadResult> {
    const schema = this.opts.rules.schema ?? this.opts.schema ?? "public";
    const t = qualified(schema, this.opts.rules.table);
    const role = as === "anon" ? this.anonRole : this.apiRole;
    const claims = as === "anon" ? {} : toClaims(as);

    try {
      await this.db.exec("begin");
      // Set the claims as superuser, THEN drop into the limited role for the read.
      await this.db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
      await this.db.exec(`set local role ${quoteIdent(role)};`);
      const res = await this.db.query(`select * from ${t} order by 1`);
      await this.db.exec("rollback");
      return { rows: (res.rows as Record<string, unknown>[]) ?? [], blocked: false };
    } catch {
      try {
        await this.db.exec("rollback");
      } catch {
        // ignore — transaction may already be aborted
      }
      return { rows: [], blocked: true };
    }
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

function toClaims(u: SimUser): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (u.sub != null) claims.sub = u.sub;
  if (u.org_id != null) claims.org_id = u.org_id;
  if (u.role != null) claims.role = u.role;
  if (u.roles != null) claims.roles = u.roles;
  return claims;
}
