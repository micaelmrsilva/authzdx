# @authzdx/db

The database seam. Postgres is the engine everywhere (RLS lives there); only the
runtime changes.

```ts
import { openDb, initProjectDb } from "@authzdx/db";

const db = await openDb();                 // in-memory pglite, no Docker
const db = await openDb({ url: "pglite://./data" }); // persistent local
const db = await openDb({ url: process.env.DATABASE_URL }); // prod Postgres (postgres.js)

await initProjectDb(db); // claim helpers + anon/authenticated roles (idempotent)
```

| `url` | Backend |
|---|---|
| _unset_ / `pglite:memory` | in-memory pglite (dev/CI/simulator) |
| `pglite://./data` | persistent pglite, no Docker |
| `postgres://…` / `postgresql://…` | standard Postgres (postgres.js), pooled — production |

## `reserve` — the transaction seam

RLS enforcement runs `begin → set local role → … → rollback`, which must all ride
**one** connection. On a pooled backend, top-level `query`/`exec` may each land on
a different connection, so transaction-scoped state (`set local`) needs pinning:

```ts
await db.reserve(async (conn) => {
  await conn.exec("begin");
  await conn.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  await conn.exec('set local role "authenticated"');
  const { rows } = await conn.query("select * from posts"); // RLS applies
  await conn.exec("rollback");
  return rows;
});
```

pglite serializes overlapping `reserve` calls (single connection); postgres.js
pins a reserved connection and resets it on release. Proven against a real server
in `test/postgres.test.ts` (gated on `TEST_DATABASE_URL`), incl. 20 concurrent
isolated transactions. pglite is single-connection, so it is **not** a production
store — point `DATABASE_URL` at real Postgres for that.
