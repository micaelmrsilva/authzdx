# @authzdx/db

The database seam. Postgres is the engine everywhere (RLS lives there); only the
runtime changes.

```ts
import { openDb, initProjectDb } from "@authzdx/db";

const db = await openDb();                 // in-memory pglite, no Docker
const db = await openDb({ url: "pglite://./data" }); // persistent local
const db = await openDb({ url: process.env.DATABASE_URL }); // prod Postgres*

await initProjectDb(db); // claim helpers + anon/authenticated roles (idempotent)
```

| `url` | Backend |
|---|---|
| _unset_ / `pglite:memory` | in-memory pglite (dev/CI/simulator) |
| `pglite://./data` | persistent pglite, no Docker |
| `postgres://…` | standard Postgres |

> \* The `postgres://` adapter (postgres.js) is a small follow-up — pglite covers
> dev/CI today. pglite is single-connection, so it is **not** a production store.
