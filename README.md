# authzdx

The open-source BaaS where **the person who isn't a database expert writes the
access rule** — visually, testable in a simulator, **locked by default** — on top
of a proven engine (Postgres RLS).

> 🚧 **Early development.** Milestone 1 (`@authzdx/rules`) in progress.
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

## Packages

| Package | What |
|---|---|
| [`@authzdx/rules`](packages/rules) | Presets → RLS compiler + lockdown + pglite simulator. **The differentiator.** |
| [`@authzdx/auth`](packages/auth) | Auth foundation (Better Auth) — issues the JWT the rules read. *(scaffold)* |
| `apps/api` | Data API (PostgREST or thin layer) so the rules gate something. *(planned)* |
| `apps/admin` | Where non-devs author + simulate rules. **The product surface.** *(planned)* |

## Stack

pnpm + turbo monorepo · TypeScript · Biome · Postgres + RLS (engine) · pglite
(zero-Docker local/simulator) · Better Auth (auth) · S3-compatible storage via
r2dx *(post-v0)*.

## Develop

```bash
pnpm install
pnpm test        # @authzdx/rules: compiler + the killer-loop simulation
pnpm typecheck
pnpm lint
```
