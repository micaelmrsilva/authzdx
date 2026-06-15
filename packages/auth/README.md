# @authzdx/auth

The **foundation**, not the differentiator. Better Auth logs people in and — the
one thing that matters for authzdx — **issues the JWT** whose claims the rules
engine reads.

```
Better Auth  --(JWT: sub, org_id, role)-->  request.jwt.claims  -->  Postgres RLS
```

- **Don't build the auth core.** It's a CVE liability and forever-maintenance.
  Better Auth, self-hosted next to the app, is also faster than a hosted Clerk by
  construction (local verify, no third-party round-trip).
- **The integration work is one step:** inject the active `org_id` + `role` into
  the JWT payload (Better Auth's JWT plugin), exactly like Supabase's custom
  access token hook. Then `@authzdx/rules` reads them via `authzdx.uid()/.org()/
  .has_role()`.

## Status

🚧 **Scaffold only.** `src/auth.ts` is illustrative. To wire it:

```bash
pnpm --filter @authzdx/auth add better-auth
```

Then confirm the plugin API (org + JWT claim injection) against the installed
version before relying on it. Not yet part of the build/test pipeline.
