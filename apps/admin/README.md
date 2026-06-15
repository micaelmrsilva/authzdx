# @authzdx/admin

The product surface (Vite + React). Where someone who isn't a database expert
authors access rules — visually, with a simulator, locked by default.

What it does today:
- **Table list** with lock status (⚠️ exposed / 🔒 locked / ✅ configured).
- **Read-rule builder**: add presets (only the owner / anyone in the org / has a
  role / public read / any signed-in user), then **Publish** → the API compiles
  them to Postgres RLS.
- **Simulator**: "as user X" (or anonymous) → see exactly which rows they get.

It's a thin client over [`@authzdx/api`](../api).

## Run

```bash
pnpm --filter @authzdx/api dev     # API on :8787 (in-memory pglite)
pnpm --filter @authzdx/admin dev   # admin on :5173
# VITE_API_URL overrides the API base (default http://localhost:8787)
```

## Status

🟢 Builds + type-checks; drives the API's control plane (list / publish /
simulate) for the `read` action.

**Follow-ups:** authoring for create/update/delete; show a table's *current*
rules (not just status); component tests; auth in front of the admin itself.
