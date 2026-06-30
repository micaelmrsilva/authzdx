import type { Conn, Db } from "@authzdx/db";
import { qualified, quoteIdent } from "@authzdx/rules";

export interface SelectResult {
  rows: Record<string, unknown>[];
  /** True when the role has no access at all (hard permission denial). */
  blocked: boolean;
}

export interface Identity {
  /** The verified JWT claims (or {} for an anonymous caller). */
  claims: Record<string, unknown>;
  /** The Postgres role to run as (subject to RLS). */
  role: string;
}

export interface SelectArgs extends Identity {
  schema: string;
  table: string;
}

/**
 * Run `fn` AS a given identity, inside a rolled-back transaction on a single
 * pinned connection: set `request.jwt.claims`, drop into the non-privileged role
 * (so RLS applies), execute, then ALWAYS roll back. Pinning the connection via
 * `db.reserve` is what makes `set local role` correct on a pooled backend.
 *
 * Returns `blocked: true` if anything throws — which is exactly how a hard RLS
 * denial (or a missing policy) surfaces.
 */
async function runAs<T>(
  db: Db,
  id: Identity,
  fn: (c: Conn) => Promise<T>,
): Promise<{ value: T; blocked: false } | { value: null; blocked: true }> {
  return db.reserve(async (c) => {
    try {
      await c.exec("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(id.claims),
      ]);
      await c.exec(`set local role ${quoteIdent(id.role)}`);
      const value = await fn(c);
      await c.exec("rollback");
      return { value, blocked: false as const };
    } catch {
      try {
        await c.exec("rollback");
      } catch {
        // transaction may already be aborted
      }
      return { value: null, blocked: true as const };
    }
  });
}

/**
 * Read a table AS a given identity. The same path the simulator uses, here
 * against the live project database. Never mutates (rolled-back transaction).
 */
export async function selectAs(db: Db, args: SelectArgs): Promise<SelectResult> {
  const target = qualified(args.schema, args.table);
  const out = await runAs(db, args, (c) =>
    c.query<Record<string, unknown>>(`select * from ${target}`),
  );
  if (out.blocked) return { rows: [], blocked: true };
  return { rows: out.value.rows, blocked: false };
}

export interface WriteResult {
  /** True when RLS permitted the write and it took effect (>=1 row). */
  ok: boolean;
  /** Rows inserted / updated / deleted. */
  affected: number;
  /**
   * Why a write was refused (undefined when `ok`):
   *  - "policy": a hard denial — WITH CHECK violation / missing policy / no GRANT
   *  - "no-match": ran, but USING (or read-visibility) filtered every row
   */
  denied?: "policy" | "no-match";
}

export interface WriteArgs extends SelectArgs {
  /** Column -> value for the row being written (INSERT values / UPDATE SET). */
  values?: Record<string, unknown>;
  /** Column -> value the target row(s) must match (UPDATE / DELETE WHERE). */
  match?: Record<string, unknown>;
}

/** Count affected by `affected`, NOT by RETURNING (which the SELECT policy gates). */
function toWrite(
  out: { value: { affected?: number }; blocked: false } | { value: null; blocked: true },
): WriteResult {
  if (out.blocked) return { ok: false, affected: 0, denied: "policy" };
  const affected = out.value.affected ?? 0;
  if (affected === 0) return { ok: false, affected: 0, denied: "no-match" };
  return { ok: true, affected };
}

/** INSERT a row AS a given identity (governed by the WITH CHECK of the create policy). */
export async function insertAs(db: Db, args: WriteArgs): Promise<WriteResult> {
  const target = qualified(args.schema, args.table);
  const cols = Object.keys(args.values ?? {});
  if (cols.length === 0) return { ok: false, affected: 0, denied: "policy" };
  const idents = cols.map((c) => quoteIdent(c)).join(", ");
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const params = cols.map((c) => (args.values as Record<string, unknown>)[c]);
  const sql = `insert into ${target} (${idents}) values (${placeholders})`;
  return toWrite(await runAs(db, args, (c) => c.query(sql, params)));
}

/** UPDATE rows matching `match` with `values` AS a given identity. */
export async function updateAs(db: Db, args: WriteArgs): Promise<WriteResult> {
  const target = qualified(args.schema, args.table);
  const setCols = Object.keys(args.values ?? {});
  const whereCols = Object.keys(args.match ?? {});
  if (setCols.length === 0 || whereCols.length === 0) {
    return { ok: false, affected: 0, denied: "policy" };
  }
  const setClause = setCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(", ");
  const whereClause = whereCols
    .map((c, i) => `${quoteIdent(c)} = $${setCols.length + i + 1}`)
    .join(" and ");
  const params = [
    ...setCols.map((c) => (args.values as Record<string, unknown>)[c]),
    ...whereCols.map((c) => (args.match as Record<string, unknown>)[c]),
  ];
  const sql = `update ${target} set ${setClause} where ${whereClause}`;
  return toWrite(await runAs(db, args, (c) => c.query(sql, params)));
}

/** DELETE rows matching `match` AS a given identity. */
export async function deleteAs(db: Db, args: WriteArgs): Promise<WriteResult> {
  const target = qualified(args.schema, args.table);
  const whereCols = Object.keys(args.match ?? {});
  if (whereCols.length === 0) return { ok: false, affected: 0, denied: "policy" };
  const whereClause = whereCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(" and ");
  const params = whereCols.map((c) => (args.match as Record<string, unknown>)[c]);
  const sql = `delete from ${target} where ${whereClause}`;
  return toWrite(await runAs(db, args, (c) => c.query(sql, params)));
}
