# @authzdx/api

The data API (Hono, all-TS). Two planes:

**Control plane** (drives the admin)
| Method | Path | What |
|---|---|---|
| `GET` | `/tables` | List tables + lock status (`exposed` / `locked` / `configured`). |
| `POST` | `/tables/:table/rules` | Publish presets → compile to RLS (locked by default). |
| `POST` | `/tables/:table/simulate` | "As user X" against the live table. |

**Data plane** (apps consume this)
| Method | Path | What |
|---|---|---|
| `GET` | `/data/:table` | Verify the `Bearer` JWT (JWKS, offline) → `request.jwt.claims` → RLS-filtered read. No/invalid token → anon (locked by default) / `401`. |

No PostgREST: a thin TS layer keeps the "all-TS, one command" promise and the
edge-native story (Hono runs on Node/Bun/Workers).

## Run

```bash
pnpm --filter @authzdx/api dev        # boots on :8787, in-memory pglite
# env: DATABASE_URL (unset -> pglite), AUTH_JWKS_URL, PORT
```

## Status

🟢 Proven end-to-end (`test/api.test.ts`): publish rule via HTTP → RLS on live
pglite → verified JWT sees only its rows; anon blocked; forged token → 401.

**Follow-ups:** writes (insert/update/delete) through `WITH CHECK`; rotating
remote JWKS (`createRemoteJWKSet`); the postgres.js adapter in `@authzdx/db`.
