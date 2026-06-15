/**
 * The heart of authzdx: turn friendly presets into Postgres RLS — locked by
 * default. This module is pure (string in, SQL out) so it is trivially testable
 * and the admin can show the exact SQL it will apply.
 */

import { ACTIONS, type Action, type Preset, type TableRules } from "./presets";
import { qualified, quoteIdent, quoteLiteral } from "./sql";

export interface CompileOptions {
  /** Role granted to authenticated callers. Default "authenticated". */
  apiRole?: string;
  /** Role used for unauthenticated callers. Default "anon". */
  anonRole?: string;
  /** Overrides `TableRules.schema`. Default "public". */
  schema?: string;
}

/** Maps a product action to its RLS command and which clauses it needs. */
const ACTION_SQL: Record<Action, { command: string; using: boolean; withCheck: boolean }> = {
  read: { command: "select", using: true, withCheck: false },
  create: { command: "insert", using: false, withCheck: true },
  update: { command: "update", using: true, withCheck: true },
  delete: { command: "delete", using: true, withCheck: false },
};

/** Compile a single preset to a boolean SQL predicate over the row + JWT claims. */
export function presetPredicate(preset: Preset): string {
  switch (preset.kind) {
    case "owner":
      return `authzdx.uid() is not null and authzdx.uid() = ${quoteIdent(preset.ownerColumn)}::text`;
    case "org":
      return `authzdx.org() is not null and authzdx.org() = ${quoteIdent(preset.orgColumn)}::text`;
    case "role": {
      const hasRole = `authzdx.has_role(${quoteLiteral(preset.role)})`;
      if (preset.orgColumn) {
        return `${hasRole} and authzdx.org() is not null and authzdx.org() = ${quoteIdent(preset.orgColumn)}::text`;
      }
      return hasRole;
    }
    case "public_read":
      return "true";
    case "authenticated":
      return "authzdx.uid() is not null";
  }
}

/** OR a set of presets together (the row is allowed if any preset matches). */
export function combinePredicates(presets: Preset[]): string {
  if (presets.length === 0) return "false";
  return presets.map((p) => `(${presetPredicate(p)})`).join(" or ");
}

/**
 * Lock a table down: enable RLS (so absence of a policy means *deny*), strip any
 * blanket grants from the anon/public roles, and grant DML to the api role so
 * that RLS — not a missing GRANT — is what governs access.
 */
export function lockdownSql(table: string, opts: CompileOptions = {}): string {
  const schema = opts.schema ?? "public";
  const apiRole = opts.apiRole ?? "authenticated";
  const anonRole = opts.anonRole ?? "anon";
  const t = qualified(schema, table);
  return [
    `alter table ${t} enable row level security;`,
    `revoke all on table ${t} from public;`,
    `revoke all on table ${t} from ${quoteIdent(anonRole)};`,
    `grant select, insert, update, delete on table ${t} to ${quoteIdent(apiRole)};`,
  ].join("\n");
}

/**
 * Compile a table's rules to idempotent SQL: lockdown + one RLS policy per
 * granted action. Any action without presets gets no policy and is therefore
 * denied. Returns SQL safe to re-run (drops existing authzdx policies first).
 */
export function compileRules(rules: TableRules, opts: CompileOptions = {}): string {
  const schema = rules.schema ?? opts.schema ?? "public";
  const apiRole = opts.apiRole ?? "authenticated";
  const t = qualified(schema, rules.table);

  const parts: string[] = [
    `-- authzdx: rules for ${schema}.${rules.table} (locked by default)`,
    lockdownSql(rules.table, { ...opts, schema }),
  ];

  for (const action of ACTIONS) {
    const actionPresets = rules.rules[action];
    const policy = quoteIdent(`authzdx_${rules.table}_${action}`);
    // Idempotent: always drop, only (re)create when the action is granted.
    parts.push(`drop policy if exists ${policy} on ${t};`);
    if (!actionPresets || actionPresets.length === 0) continue;

    for (const p of actionPresets) {
      if (p.kind === "public_read" && action !== "read") {
        throw new Error(
          `preset "public_read" is only valid for the "read" action (got "${action}")`,
        );
      }
    }

    const meta = ACTION_SQL[action];
    const predicate = combinePredicates(actionPresets);
    let stmt = `create policy ${policy} on ${t} for ${meta.command} to ${quoteIdent(apiRole)}`;
    if (meta.using) stmt += ` using (${predicate})`;
    if (meta.withCheck) stmt += ` with check (${predicate})`;
    parts.push(`${stmt};`);
  }

  return parts.join("\n");
}
