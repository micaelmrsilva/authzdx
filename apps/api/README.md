# @authzdx/api

The data API (Hono, all-TS). Two planes:

**Control plane** (drives the admin)
| Method | Path | What |
|---|---|---|
| `GET` | `/tables` | List tables + lock status (`exposed` / `locked` / `configured`). Auth system tables are hidden. |
| `POST` | `/tables/:table/rules` | Publish presets per action → compile to RLS (locked by default). |
| `POST` | `/tables/:table/simulate` | "As user X", any action (`read`/`create`/`update`/`delete`) — runs real RLS, rolls back. |

**Data plane** (apps consume this) — every call verifies the `Bearer` JWT (JWKS,
offline) → `request.jwt.claims` → RLS. No/invalid token → anon (locked by
default) / `401`.
| Method | Path | What |
|---|---|---|
| `GET` | `/data/:table` | RLS-filtered read. |
| `POST` | `/data/:table` | Insert `{ values }` (governed by the create policy's `WITH CHECK`). |
| `PATCH` | `/data/:table` | Update rows matching `{ match }` with `{ values }`. |
| `DELETE` | `/data/:table` | Delete rows matching `{ match }`. |

Writes return `{ ok, affected, denied? }` and `403` when not permitted. No
PostgREST: a thin TS layer keeps the "all-TS, one command" promise and the
edge-native story (Hono runs on Node/Bun/Workers).

## Run

```bash
pnpm --filter @authzdx/api dev        # :8787 — DATABASE_URL unset -> in-memory pglite
# env: DATABASE_URL (postgres://… or unset for pglite), AUTH_URL (default :3100), PORT
```

JWTs are verified against `AUTH_URL/api/auth/.well-known/jwks.json` via a remote
key set (lazy fetch, cached, follows rotation).

## Status

🟢 Proven end-to-end (`test/api.test.ts`): publish rules via HTTP → RLS on a live
database → a verified JWT reads/writes only what its rules allow; anon blocked;
forged token → 401; write simulation rolls back. The full HTTP sign-in → JWT →
data-plane path is verified against real Postgres with `apps/auth` running.
