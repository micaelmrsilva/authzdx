const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export type TableStatus = "exposed" | "locked" | "configured";

export interface TableInfo {
  name: string;
  rlsEnabled: boolean;
  policies: number;
  status: TableStatus;
}

export type PresetDraft =
  | { kind: "owner"; ownerColumn: string }
  | { kind: "org"; orgColumn: string }
  | { kind: "role"; role: string }
  | { kind: "public_read" }
  | { kind: "authenticated" };

export interface SimIdentity {
  sub?: string;
  org_id?: string;
  role?: string;
}

export interface SimResult {
  rows: Record<string, unknown>[];
  blocked: boolean;
}

export async function listTables(): Promise<TableInfo[]> {
  const res = await fetch(`${BASE}/tables`);
  const body = (await res.json()) as { tables: TableInfo[] };
  return body.tables;
}

export async function publishReadRules(table: string, read: PresetDraft[]): Promise<string> {
  const res = await fetch(`${BASE}/tables/${table}/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: { read } }),
  });
  const body = (await res.json()) as { applied: boolean; sql: string };
  return body.sql;
}

export async function simulate(table: string, as: SimIdentity | "anon"): Promise<SimResult> {
  const res = await fetch(`${BASE}/tables/${table}/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ as }),
  });
  return (await res.json()) as SimResult;
}
