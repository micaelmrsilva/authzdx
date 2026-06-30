# @authzdx/admin

The product surface (Vite + React). Where someone who isn't a database expert
authors access rules — visually, with a simulator, locked by default.

What it does today:
- **Table list** with lock status (⚠️ exposed / 🔒 locked / ✅ configured).
- **Rule builder, per action** (read / create / update / delete): add presets
  (only the owner / anyone in the org / has a role / public read / any signed-in
  user), then **Publish** → the API compiles them to Postgres RLS. Warns when you
  grant a write but no read (Postgres requires read-visibility to match rows).
- **Simulator**: "as user X" (or anonymous), for any action → see which rows they
  read, or whether a create/update/delete would be allowed.

It's a thin client over [`@authzdx/api`](../api).

## Run

```bash
pnpm dev                           # from the repo root: boots api + admin (+ auth)
# or just this app:
pnpm --filter @authzdx/admin dev   # admin on :5174
# VITE_API_URL overrides the API base (default http://localhost:8787)
```

## Status

🟢 Builds + type-checks; drives the API's control plane (list / publish /
simulate) for every action (read + create/update/delete).

**Follow-ups:** show a table's *current* published rules (not just status);
component tests; auth in front of the admin itself.
