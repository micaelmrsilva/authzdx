# @authzdx/rules

The core of authzdx: compile friendly **presets** into Postgres **RLS** (locked by
default), and **simulate** them against real Postgres before they ship.

```ts
import { Simulator, presets } from "@authzdx/rules";

const sim = await Simulator.create({
  ddl: `create table public.posts (id int primary key, title text, user_id text)`,
  seedSql: `insert into public.posts values (1,'a','alice'),(2,'b','bob')`,
  rules: { table: "posts", rules: { read: [presets.owner("user_id")] } },
});

await sim.read({ sub: "alice" }); // -> { rows: [{ id: 1, ... }], blocked: false }
await sim.read("anon");           // -> { rows: [], blocked: true }  (safe by default)

sim.compiledSql(); // the exact SQL that would ship to production
```

## Why this shape

- **Presets, not a DSL.** A policy language — however readable — is still
  developer-facing. Presets (`owner`, `org`, `role`, `public_read`,
  `authenticated`) cover ~90% of apps and map 1:1 to RLS. Power users drop to raw
  RLS as an escape hatch.
- **Postgres RLS is the engine.** A BaaS's core operation is "give me the rows
  this user can see" (list filtering) — exactly what RLS does natively and what
  point-check authz engines (Zanzibar-style) do not.
- **The simulator runs the real policy.** It applies the same `compileRules`
  output to pglite (in-process Postgres, no Docker) and queries as the synthetic
  user. No re-implementation can drift from production.

## API

| Export | What |
|---|---|
| `presets` | Builders for the access presets. |
| `compileRules(rules, opts?)` | Rules → idempotent SQL (lockdown + policies). |
| `lockdownSql(table, opts?)` | Just the "lock it" SQL (RLS on, grants stripped). |
| `presetPredicate(preset)` | One preset → its SQL boolean predicate. |
| `Simulator` | In-process evaluator: `.create()`, `.read()`, `.compiledSql()`, `.close()`. |
| `BOOTSTRAP_SQL` | One-time helpers (`authzdx.uid()` / `.org()` / `.has_role()`). |

## Status

🚧 Milestone 1. `read` (SELECT) is covered end-to-end. `create`/`update`/`delete`
compile but need their own simulator assertions; see the m1 plan.
