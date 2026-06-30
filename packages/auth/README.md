# @authzdx/auth

The **foundation**, not the differentiator. Better Auth logs people in and — the
one thing that matters for authzdx — **issues the JWT** whose claims the rules
engine reads.

```
Better Auth  --(JWT: sub, org_id, role)-->  request.jwt.claims  -->  Postgres RLS
```

- **Don't build the auth core.** It's a CVE liability and forever-maintenance.
  Better Auth, self-hosted next to the app, is also faster than a hosted Clerk by
  construction (offline JWKS verify, no third-party round-trip).
- **The bridge is `definePayload`.** `createAuth` wires Better Auth's JWT plugin
  (asymmetric EdDSA + JWKS) to inject the active `org_id` + `role` via
  `buildClaims` — exactly like Supabase's custom access token hook. Then
  `@authzdx/rules` reads them via `authzdx.uid()/.org()/.has_role()`.
- **Claims are verified, never trusted.** `verifyClaims` checks the JWT against the
  issuer's JWKS before anything sets `request.jwt.claims`.

## API

| Export | What |
|---|---|
| `authOptions(env)` | The Better Auth config — shared by the live instance and the migrator. |
| `createAuth(env)` | Better Auth instance (org + JWT plugins, EdDSA, JWKS at `JWKS_PATH`). |
| `runAuthMigrations(env)` | Create/upgrade the Better Auth tables (idempotent; used on boot). |
| `buildClaims(input)` | Session → the `{ sub, org_id, role }` contract. Single source of truth. |
| `verifyClaims(token, keys, opts?)` | Verify → claims. `keys` is a static JWKS or a `createRemoteJWKSet` getter. |

The runnable HTTP server that mounts `createAuth` lives in [`apps/auth`](../../apps/auth).

## Status

🟢 Wired against Better Auth `1.6.18` and **proven end-to-end** against real
Postgres: HTTP sign-up → EdDSA JWT (`sub`/`org_id`/`role`) → offline JWKS verify →
`request.jwt.claims` → RLS decision. `test/bridge.test.ts` locks the cryptographic
contract (incl. forged-token rejection); `apps/auth` + `apps/api` exercise the
full sign-in path.

```bash
# verify
pnpm --filter @authzdx/rules build      # auth tests import the built rules pkg
pnpm --filter @authzdx/auth test
```
