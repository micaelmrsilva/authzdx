const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export type TableStatus = "exposed" | "locked" | "configured";

export interface TableInfo {
  name: string;
  rlsEnabled: boolean;
  policies: number;
  status: TableStatus;
}

export type Action = "read" | "create" | "update" | "delete";
export const ACTIONS: Action[] = ["read", "create", "update", "delete"];

export type PresetDraft =
  | { kind: "owner"; ownerColumn: string }
  | { kind: "org"; orgColumn: string }
  | { kind: "role"; role: string }
  | { kind: "public_read" }
  | { kind: "authenticated" };

/** Presets per action — the full shape the admin authors and publishes. */
export type ActionRules = Record<Action, PresetDraft[]>;

export interface SimIdentity {
  sub?: string;
  org_id?: string;
  role?: string;
}

export interface ReadResult {
  rows: Record<string, unknown>[];
  blocked: boolean;
}

export interface WriteResult {
  ok: boolean;
  affected: number;
  denied?: "policy" | "no-match";
}

export async function listTables(): Promise<TableInfo[]> {
  const res = await fetch(`${BASE}/tables`);
  const body = (await res.json()) as { tables: TableInfo[] };
  return body.tables;
}

/** Publish every non-empty action's presets — locked by default for the rest. */
export async function publishRules(table: string, rules: ActionRules): Promise<string> {
  const nonEmpty = Object.fromEntries(
    (Object.entries(rules) as [Action, PresetDraft[]][]).filter(([, ps]) => ps.length > 0),
  );
  const res = await fetch(`${BASE}/tables/${table}/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: nonEmpty }),
  });
  const body = (await res.json()) as { applied: boolean; sql: string };
  return body.sql;
}

/** Simulate a read "as user X" (or anon) against the live table. */
export async function simulateRead(table: string, as: SimIdentity | "anon"): Promise<ReadResult> {
  const res = await fetch(`${BASE}/tables/${table}/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ as, action: "read" }),
  });
  return (await res.json()) as ReadResult;
}

/** Simulate a create/update/delete "as user X" — runs the real RLS, then rolls back. */
export async function simulateWrite(
  table: string,
  as: SimIdentity | "anon",
  action: Exclude<Action, "read">,
  payload: { values?: Record<string, unknown>; match?: Record<string, unknown> },
): Promise<WriteResult> {
  const res = await fetch(`${BASE}/tables/${table}/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ as, action, ...payload }),
  });
  return (await res.json()) as WriteResult;
}
