# authzdx — Milestone 1 implementation plan

_2026-06-14 · goal: a demoable **killer loop**_

M1 proves the thesis end-to-end: a table is locked by default, a non-dev-style
preset is applied, and a real simulator shows correct per-user access. No storage,
no functions, no realtime — just the differentiator.

## Build order

1. **Auth → claims** _(wired; bridge proven)_
   Better Auth (1.6.18) with `organization` + `jwt` plugins; `definePayload`
   injects `sub`/`org_id`/`role`; EdDSA + JWKS. `verifyClaims` gates the api side.
   Bridge proven by `bridge.test.ts`; full HTTP sign-in e2e still pending.
   → `@authzdx/auth`

2. **Locked by default** _(done)_
   `lockdownSql`: enable RLS + strip blanket grants + grant DML to the api role.
   Absence of a policy = deny. → `@authzdx/rules`

3. **Preset → RLS compiler** _(done for all presets; read path proven)_
   `compileRules`: idempotent lockdown + one policy per granted action, presets
   OR-ed, claims read via `authzdx.*` helpers. → `@authzdx/rules`

4. **Real simulator** _(done for read; create/update/delete pending)_
   `Simulator` over pglite runs the compiled SQL and queries as a synthetic user.
   → `@authzdx/rules`

5. **Admin** _(planned)_
   Web app tying 2–4 together: table list with 🔒/⚠️ status, visual preset builder,
   "simulate" + "publish". The product surface. → `apps/admin`

6. **Data API** _(planned)_
   PostgREST (or a thin layer) so the rules actually gate reads/writes over HTTP.
   → `apps/api`

When 1–6 run, the loop is demoable.

## Status snapshot (this commit)

| Step | State |
|---|---|
| 2 Locked by default | ✅ implemented + tested |
| 3 Preset → RLS compiler | ✅ implemented (`compile.test.ts`) |
| 4 Simulator (read) | ✅ implemented + tested (`owner-only.test.ts`) |
| 1 Auth → claims | 🟢 wired + bridge proven (`bridge.test.ts`); HTTP sign-in e2e pending |
| 5 Admin · 6 Data API | ⬜ not started |

## Next concrete tasks

- [ ] Simulator: add `create`/`update`/`delete` evaluation (try-op-in-tx, rollback,
      report allow/deny) + tests for `org` and `role` presets.
- [x] Wire `@authzdx/auth` (Better Auth 1.6.18, claim injection via `definePayload`)
      + bridge test: real EdDSA JWT → JWKS verify → `request.jwt.claims` → RLS.
- [ ] Full Better-Auth HTTP sign-in e2e (DB adapter + active org) exercising
      `createAuth` end to end.
- [ ] `apps/api`: stand up PostgREST against pglite/Postgres; confirm it sets
      `request.jwt.claims` from the verified JWT.
- [ ] `apps/admin`: table list + status, preset builder, simulate/publish.
- [ ] One-command local dev (`pnpm dev`) booting api + admin + pglite.
- [ ] Harden compiler: identifier validation, column existence checks, fuzz the
      quoting; expand the compiler test suite (this is existential — see design D-risks).
