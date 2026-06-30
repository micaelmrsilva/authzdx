# authzdx

The open-source BaaS where **the person who isn't a database expert writes the
access rule** — visually, testable in a simulator, **locked by default** — on top
of a proven engine (Postgres RLS).

> 🟢 **Milestone 1 runs end-to-end.** Sign up → JWT → the data API filters every
> row through Postgres RLS, locked by default — read **and** write — on real
> Postgres, authored + simulated from the admin. `pnpm dev` boots the whole stack.
>
> - Design: [`docs/specs/2026-06-14-authzdx-design.md`](docs/specs/2026-06-14-authzdx-design.md)
> - Plan: [`docs/plans/2026-06-14-authzdx-m1-plan.md`](docs/plans/2026-06-14-authzdx-m1-plan.md)
>
> Working name in the `*dx` family. Sibling project [`r2dx`](https://github.com/) is
> the natural storage layer once buckets land (post-v0).

## Why this exists

Backends leak data because authorization is hard and opt-in. Supabase's own docs
call a public table without RLS *"critically unsafe"*; misconfigured Firebase
rules have exposed 125M+ records. The fix everyone reaches for — RLS, security
rules, policy DSLs — is still **written by developers**.

The gap (validated against Permit.io, Cerbos, SpiceDB, OpenFGA, Convex, Nile,
Appwrite, Supabase): **nobody** offers, all at once — open-source **+** integrated
into a BaaS **+** non-dev authoring **+** a simulator **+** safe-by-default. That
combination is the wedge.

## The killer loop

```
1. A table enters the system  ->  it is BORN LOCKED (RLS on, grants stripped)
2. Pick a preset, visually     ->  "only the owner"            (zero SQL)
3. It compiles to a Postgres RLS policy that reads the JWT claims
4. Simulate: "as user A" sees the row; "as user B" does not    (real engine)
5. Publish. Safe by construction.
```

## Packages & apps

| Package | What |
|---|---|
| [`@authzdx/rules`](packages/rules) | Presets → RLS compiler + lockdown + pglite simulator (read **and** write). **The differentiator.** |
| [`@authzdx/auth`](packages/auth) | Auth foundation (Better Auth) — issues + verifies the JWT the rules read. |
| [`@authzdx/db`](packages/db) | The database seam: pglite for dev/CI, real Postgres (postgres.js) for production. |
| [`apps/auth`](apps/auth) | The auth server: Better Auth over HTTP (sign-in/up) + JWKS, auto-migrated. |
| [`apps/api`](apps/api) | Data API (Hono): control plane (author/simulate) + data plane (RLS-gated CRUD). |
| [`apps/admin`](apps/admin) | Where non-devs author + simulate rules. **The product surface.** |

## Stack

pnpm + turbo monorepo · TypeScript · Biome · Postgres + RLS (engine) · pglite
(zero-Docker dev/CI/simulator) · postgres.js (production) · Better Auth (auth) ·
Hono (api/auth) · Vite + React (admin) · S3-compatible storage via r2dx *(post-v0)*.

## Develop

```bash
pnpm install
cp .env.example .env       # set DATABASE_URL + BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm dev                   # auth :3100 · api :8787 · admin :5174
```

`pnpm dev` needs a Postgres at `DATABASE_URL` (local, Neon, Supabase, RDS… any
standard Postgres with `CREATEROLE`). The auth tables are auto-migrated on boot.

```bash
pnpm test                  # rules (compiler + killer-loop), api, auth
pnpm typecheck
pnpm lint
# the real-Postgres adapter test is gated:
TEST_DATABASE_URL=postgres://you@localhost:5432/authzdx_test pnpm --filter @authzdx/db test
```
