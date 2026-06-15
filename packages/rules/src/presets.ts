/**
 * The vocabulary a non-developer actually needs.
 *
 * Instead of a policy DSL (which is still developer-facing — see the design doc),
 * authzdx exposes a small set of opinionated *presets*. Each preset maps cleanly
 * onto a Postgres RLS predicate that reads the request's JWT claims. The common
 * patterns (~90% of real apps) become one-click and safe; power users can still
 * drop to raw RLS as an escape hatch.
 */

/** A CRUD action, expressed in product terms (not SQL). */
export type Action = "read" | "create" | "update" | "delete";

export const ACTIONS: readonly Action[] = ["read", "create", "update", "delete"];

/**
 * An access preset. Each variant compiles to a boolean SQL predicate over the
 * row + the caller's JWT claims (`sub`, `org_id`, `role`/`roles`).
 */
export type Preset =
  /** The row belongs to the caller: `row[ownerColumn] == jwt.sub`. */
  | { kind: "owner"; ownerColumn: string }
  /** The row belongs to the caller's org: `row[orgColumn] == jwt.org_id`. */
  | { kind: "org"; orgColumn: string }
  /** The caller has `role` (optionally scoped to their org via `orgColumn`). */
  | { kind: "role"; role: string; orgColumn?: string }
  /** Anyone, signed-in or not, may read. Only valid for the `read` action. */
  | { kind: "public_read" }
  /** Any authenticated caller (`jwt.sub` present). */
  | { kind: "authenticated" };

/** Per-action grant. An action absent from this map is DENIED (safe by default). */
export interface TableRules {
  table: string;
  /** Defaults to "public". */
  schema?: string;
  rules: Partial<Record<Action, Preset[]>>;
}

/** Ergonomic builders — this is the surface the admin UI drives. */
export const presets = {
  owner: (ownerColumn = "user_id"): Preset => ({ kind: "owner", ownerColumn }),
  org: (orgColumn = "org_id"): Preset => ({ kind: "org", orgColumn }),
  role: (role: string, orgColumn?: string): Preset => ({ kind: "role", role, orgColumn }),
  publicRead: (): Preset => ({ kind: "public_read" }),
  authenticated: (): Preset => ({ kind: "authenticated" }),
} as const;
