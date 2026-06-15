import type { Db } from "@authzdx/db";
import { qualified, quoteIdent } from "@authzdx/rules";

export interface SelectResult {
  rows: Record<string, unknown>[];
  /** True when the role has no access at all (hard permission denial). */
  blocked: boolean;
}

export interface SelectArgs {
  schema: string;
  table: string;
  /** The verified JWT claims (or {} for an anonymous caller). */
  claims: Record<string, unknown>;
  /** The Postgres role to run as (subject to RLS). */
  role: string;
}

/**
 * Read a table AS a given identity: set `request.jwt.claims`, drop into the
 * non-privileged role, and let RLS filter. The same path the simulator uses,
 * here against the live project database. Wrapped in a rolled-back transaction
 * so a read never mutates state.
 */
export async function selectAs(db: Db, args: SelectArgs): Promise<SelectResult> {
  const target = qualified(args.schema, args.table);
  try {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(args.claims),
    ]);
    await db.exec(`set local role ${quoteIdent(args.role)}`);
    const res = await db.query(`select * from ${target}`);
    await db.exec("rollback");
    return { rows: res.rows, blocked: false };
  } catch {
    try {
      await db.exec("rollback");
    } catch {
      // transaction may already be aborted
    }
    return { rows: [], blocked: true };
  }
}
