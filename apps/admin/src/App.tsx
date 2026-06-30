import { useCallback, useEffect, useState } from "react";
import {
  ACTIONS,
  type Action,
  type ActionRules,
  type PresetDraft,
  type ReadResult,
  type SimIdentity,
  type TableInfo,
  type TableStatus,
  type WriteResult,
  listTables,
  publishRules,
  simulateRead,
  simulateWrite,
} from "./api";

const STATUS_LABEL: Record<TableStatus, { icon: string; text: string; cls: string }> = {
  exposed: { icon: "⚠️", text: "exposed (RLS off)", cls: "s-exposed" },
  locked: { icon: "🔒", text: "locked (no rule yet)", cls: "s-locked" },
  configured: { icon: "✅", text: "configured", cls: "s-configured" },
};

const PRESET_OPTIONS: { kind: PresetDraft["kind"]; label: string; readOnly?: boolean }[] = [
  { kind: "owner", label: "Only the owner" },
  { kind: "org", label: "Anyone in the org" },
  { kind: "role", label: "Has a role" },
  { kind: "public_read", label: "Public read", readOnly: true },
  { kind: "authenticated", label: "Any signed-in user" },
];

const ACTION_LABEL: Record<Action, string> = {
  read: "Read",
  create: "Create",
  update: "Update",
  delete: "Delete",
};

function makePreset(kind: PresetDraft["kind"]): PresetDraft {
  switch (kind) {
    case "owner":
      return { kind, ownerColumn: "user_id" };
    case "org":
      return { kind, orgColumn: "org_id" };
    case "role":
      return { kind, role: "admin" };
    default:
      return { kind };
  }
}

function emptyRules(): ActionRules {
  return { read: [], create: [], update: [], delete: [] };
}

/** Parse a small JSON object input; returns {} on empty and null on invalid. */
function parseObj(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function App() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rules, setRules] = useState<ActionRules>(emptyRules);
  const [message, setMessage] = useState<string | null>(null);

  const [simSub, setSimSub] = useState("user_alice");
  const [simAnon, setSimAnon] = useState(false);
  const [simAction, setSimAction] = useState<Action>("read");
  const [simValues, setSimValues] = useState('{\n  "user_id": "user_alice"\n}');
  const [simMatch, setSimMatch] = useState('{\n  "id": 1\n}');
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTables(await listTables());
    } catch {
      setMessage("Could not reach the API. Is `pnpm --filter @authzdx/api dev` running?");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function selectTable(name: string) {
    setSelected(name);
    setRules({ read: [makePreset("owner")], create: [], update: [], delete: [] });
    setReadResult(null);
    setWriteResult(null);
    setMessage(null);
  }

  function setActionPresets(action: Action, next: PresetDraft[]) {
    setRules((r) => ({ ...r, [action]: next }));
  }

  async function publish() {
    if (!selected) return;
    const sql = await publishRules(selected, rules);
    setMessage(`Published rules for "${selected}".\n${sql}`);
    await refresh();
  }

  async function runSimulation() {
    if (!selected) return;
    const as: SimIdentity | "anon" = simAnon ? "anon" : { sub: simSub };
    setReadResult(null);
    setWriteResult(null);
    if (simAction === "read") {
      setReadResult(await simulateRead(selected, as));
      return;
    }
    const values = parseObj(simValues);
    const match = parseObj(simMatch);
    if ((simAction === "create" || simAction === "update") && values === null) {
      setMessage("Values must be a JSON object.");
      return;
    }
    if ((simAction === "update" || simAction === "delete") && match === null) {
      setMessage("Match must be a JSON object.");
      return;
    }
    const payload =
      simAction === "create"
        ? { values: values ?? {} }
        : simAction === "delete"
          ? { match: match ?? {} }
          : { values: values ?? {}, match: match ?? {} };
    setWriteResult(await simulateWrite(selected, as, simAction, payload));
  }

  const hasWrite = rules.create.length + rules.update.length + rules.delete.length > 0;
  const writeWithoutRead = hasWrite && rules.read.length === 0;

  return (
    <main className="app">
      <header>
        <h1>authzdx</h1>
        <p className="sub">Access rules anyone can author — locked by default.</p>
      </header>

      <div className="cols">
        <section className="panel">
          <h2>Tables</h2>
          {tables.length === 0 && <p className="muted">No tables yet.</p>}
          <ul className="tables">
            {tables.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  className={selected === t.name ? "row selected" : "row"}
                  onClick={() => selectTable(t.name)}
                >
                  <span className="name">{t.name}</span>
                  <span className={`badge ${STATUS_LABEL[t.status].cls}`}>
                    {STATUS_LABEL[t.status].icon} {STATUS_LABEL[t.status].text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          {!selected && <p className="muted">Pick a table to author its access rules.</p>}
          {selected && (
            <>
              <h2>
                Access rules for <code>{selected}</code>
              </h2>

              {ACTIONS.map((action) => (
                <div className="action-block" key={action}>
                  <div className="action-head">
                    Who can <em>{ACTION_LABEL[action].toLowerCase()}</em>?
                  </div>
                  <PresetEditor
                    presets={rules[action]}
                    allowPublicRead={action === "read"}
                    onChange={(next) => setActionPresets(action, next)}
                  />
                </div>
              ))}

              {writeWithoutRead && (
                <p className="warn">
                  ⚠️ You granted a write action but no <strong>read</strong> rule. In Postgres, an
                  update/delete can only touch rows the caller can also read — so these writes will
                  match nothing until you add a read rule.
                </p>
              )}

              <button type="button" className="primary" onClick={() => void publish()}>
                Publish (compile → RLS)
              </button>

              <h2 className="mt">Simulate</h2>
              <div className="sim">
                <label>
                  <input
                    type="checkbox"
                    checked={simAnon}
                    onChange={(e) => setSimAnon(e.target.checked)}
                  />
                  as anonymous
                </label>
                {!simAnon && (
                  <input
                    value={simSub}
                    onChange={(e) => setSimSub(e.target.value)}
                    placeholder="sub (user id)"
                  />
                )}
                <select value={simAction} onChange={(e) => setSimAction(e.target.value as Action)}>
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABEL[a]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void runSimulation()}>
                  Run
                </button>
              </div>

              {(simAction === "create" || simAction === "update") && (
                <label className="json-field">
                  <span>values (the row to write)</span>
                  <textarea value={simValues} onChange={(e) => setSimValues(e.target.value)} />
                </label>
              )}
              {(simAction === "update" || simAction === "delete") && (
                <label className="json-field">
                  <span>match (which rows)</span>
                  <textarea value={simMatch} onChange={(e) => setSimMatch(e.target.value)} />
                </label>
              )}

              {readResult && (
                <div className="result">
                  {readResult.blocked ? (
                    <p className="blocked">🚫 blocked — no access</p>
                  ) : (
                    <p className="ok">✓ sees {readResult.rows.length} row(s)</p>
                  )}
                  {readResult.rows.length > 0 && (
                    <pre>{JSON.stringify(readResult.rows, null, 2)}</pre>
                  )}
                </div>
              )}
              {writeResult && (
                <div className="result">
                  {writeResult.ok ? (
                    <p className="ok">✓ allowed — {writeResult.affected} row(s) affected</p>
                  ) : writeResult.denied === "policy" ? (
                    <p className="blocked">🚫 denied by policy (WITH CHECK / not permitted)</p>
                  ) : (
                    <p className="blocked">🚫 no matching row the caller may write</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {message && <footer className="msg">{message}</footer>}
    </main>
  );
}

function PresetEditor(props: {
  presets: PresetDraft[];
  allowPublicRead: boolean;
  onChange: (next: PresetDraft[]) => void;
}) {
  const { presets, allowPublicRead, onChange } = props;
  const options = PRESET_OPTIONS.filter((o) => allowPublicRead || !o.readOnly);

  return (
    <>
      <div className="presets">
        {presets.length === 0 && <p className="muted small">No rule — denied by default.</p>}
        {presets.map((p, i) => (
          <div className="preset" key={`${p.kind}-${i}`}>
            <span className="pk">{PRESET_OPTIONS.find((o) => o.kind === p.kind)?.label}</span>
            {p.kind === "owner" && (
              <input
                value={p.ownerColumn}
                onChange={(e) =>
                  onChange(
                    presets.map((x, j) =>
                      j === i ? { kind: "owner", ownerColumn: e.target.value } : x,
                    ),
                  )
                }
              />
            )}
            {p.kind === "org" && (
              <input
                value={p.orgColumn}
                onChange={(e) =>
                  onChange(
                    presets.map((x, j) =>
                      j === i ? { kind: "org", orgColumn: e.target.value } : x,
                    ),
                  )
                }
              />
            )}
            {p.kind === "role" && (
              <input
                value={p.role}
                onChange={(e) =>
                  onChange(
                    presets.map((x, j) => (j === i ? { kind: "role", role: e.target.value } : x)),
                  )
                }
              />
            )}
            <button
              type="button"
              className="x"
              onClick={() => onChange(presets.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="add">
        {options.map((o) => (
          <button
            type="button"
            key={o.kind}
            onClick={() => onChange([...presets, makePreset(o.kind)])}
          >
            + {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
