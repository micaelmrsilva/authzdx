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
| `createAuth(env)` | Better Auth instance (org + JWT plugins, EdDSA, JWKS at `/.well-known/jwks.json`). |
| `buildClaims(input)` | Session → the `{ sub, org_id, role }` contract. Single source of truth. |
| `verifyClaims(token, jwks, opts?)` | Offline JWKS verify → claims. The api-side gate. |

## Status

🟢 Wired against Better Auth `1.6.18` (API verified). The **bridge is proven** by
`test/bridge.test.ts`: a real EdDSA JWT → JWKS verify → claims → RLS decision, plus
forged-token rejection.

**Follow-up:** a full Better-Auth HTTP sign-in e2e (DB adapter + active org) and
`apps/api` setting `request.jwt.claims` from the verified token. `createAuth`
typechecks but is not yet exercised at runtime by a test.

```bash
# verify
pnpm --filter @authzdx/rules build      # auth tests import the built rules pkg
pnpm --filter @authzdx/auth test
```
