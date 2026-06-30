# @authzdx/auth-server

The auth server: [`@authzdx/auth`](../../packages/auth)'s Better Auth instance,
mounted over HTTP (Hono). It logs people in and — the one thing that matters for
authzdx — **issues the JWT** whose claims the data API reads to drive RLS.

| Path | What |
|---|---|
| `/api/auth/*` | Better Auth: sign-up/in, session, organization, the JWT token endpoint. |
| `/api/auth/.well-known/jwks.json` | The public JWKS the API verifies tokens against (offline). |
| `/health` | Liveness probe. |

On boot it **auto-migrates** the Better Auth tables (`runAuthMigrations`), so dev
needs no manual migration step. Those tables share the project database; the API's
control plane hides them from the table list.

## Run

```bash
pnpm dev                            # from the repo root: boots auth + api + admin
# or just this app:
pnpm --filter @authzdx/auth-server dev   # auth on :3100
```

Required env (loaded from the repo-root `.env` by `pnpm dev`):
- `DATABASE_URL` — the Postgres the auth tables live in (same as the API's).
- `BETTER_AUTH_SECRET` — session/JWT signing secret (`openssl rand -base64 32`).
- `BETTER_AUTH_URL`, `PORT`, `ADMIN_ORIGIN` — fixed for dev in the `dev` script.
- `GOOGLE_*` / `GITHUB_*` — optional OAuth providers, enabled when both id+secret are set.

## Status

🟢 Proven end-to-end against real Postgres: HTTP sign-up → JWT (`sub`/`org_id`/
`role`) → JWKS → the API verifies it → RLS filters the read to the caller's rows.
