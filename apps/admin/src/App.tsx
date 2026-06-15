import { useCallback, useEffect, useState } from "react";
import {
  type PresetDraft,
  type SimResult,
  type TableInfo,
  type TableStatus,
  listTables,
  publishReadRules,
  simulate,
} from "./api";

const STATUS_LABEL: Record<TableStatus, { icon: string; text: string; cls: string }> = {
  exposed: { icon: "⚠️", text: "exposed (RLS off)", cls: "s-exposed" },
  locked: { icon: "🔒", text: "locked (no rule yet)", cls: "s-locked" },
  configured: { icon: "✅", text: "configured", cls: "s-configured" },
};

const PRESET_OPTIONS: { kind: PresetDraft["kind"]; label: string }[] = [
  { kind: "owner", label: "Only the owner" },
  { kind: "org", label: "Anyone in the org" },
  { kind: "role", label: "Has a role" },
  { kind: "public_read", label: "Public read" },
  { kind: "authenticated", label: "Any signed-in user" },
];

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

export function App() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetDraft[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [simSub, setSimSub] = useState("user_alice");
  const [simAnon, setSimAnon] = useState(false);
  const [simResult, setSimResult] = useState<SimResult | null>(null);

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
    setPresets([makePreset("owner")]);
    setSimResult(null);
    setMessage(null);
  }

  async function publish() {
    if (!selected) return;
    await publishReadRules(selected, presets);
    setMessage(`Published read rules for "${selected}".`);
    await refresh();
  }

  async function runSimulation() {
    if (!selected) return;
    setSimResult(await simulate(selected, simAnon ? "anon" : { sub: simSub }));
  }

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
          {!selected && <p className="muted">Pick a table to author its read rule.</p>}
          {selected && (
            <>
              <h2>
                Who can <em>read</em> <code>{selected}</code>?
              </h2>

              <div className="presets">
                {presets.map((p, i) => (
                  <div className="preset" key={`${p.kind}-${i}`}>
                    <span className="pk">
                      {PRESET_OPTIONS.find((o) => o.kind === p.kind)?.label}
                    </span>
                    {p.kind === "owner" && (
                      <input
                        value={p.ownerColumn}
                        onChange={(e) =>
                          setPresets((ps) =>
                            ps.map((x, j) =>
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
                          setPresets((ps) =>
                            ps.map((x, j) =>
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
                          setPresets((ps) =>
                            ps.map((x, j) =>
                              j === i ? { kind: "role", role: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="x"
                      onClick={() => setPresets((ps) => ps.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="add">
                {PRESET_OPTIONS.map((o) => (
                  <button
                    type="button"
                    key={o.kind}
                    onClick={() => setPresets((ps) => [...ps, makePreset(o.kind)])}
                  >
                    + {o.label}
                  </button>
                ))}
              </div>

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
                    placeholder="sub"
                  />
                )}
                <button type="button" onClick={() => void runSimulation()}>
                  Run
                </button>
              </div>

              {simResult && (
                <div className="result">
                  {simResult.blocked ? (
                    <p className="blocked">🚫 blocked — no access</p>
                  ) : (
                    <p className="ok">✓ sees {simResult.rows.length} row(s)</p>
                  )}
                  {simResult.rows.length > 0 && (
                    <pre>{JSON.stringify(simResult.rows, null, 2)}</pre>
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
