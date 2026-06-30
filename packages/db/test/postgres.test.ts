import { compileRules, presets } from "@authzdx/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Conn, type Db, initProjectDb, openDb } from "../src/index";

/**
 * The real-Postgres adapter, exercised against a live server. Gated on
 * TEST_DATABASE_URL so plain `pnpm test` (no Postgres) stays green; CI / local
 * runs set it to a throwaway database:
 *
 *   TEST_DATABASE_URL=postgres://user@localhost:5432/authzdx_test pnpm --filter @authzdx/db test
 *
 * This proves the part pglite cannot: a POOLED backend where `begin … set local
 * role … rollback` must ride a single reserved connection.
 */
const url = process.env.TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

maybe("postgres adapter (real server)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openDb({ url });
    // Clean slate: drop the table + policies from any prior run.
    await db.exec("drop table if exists public.posts cascade;");
    await initProjectDb(db);
    await db.exec(
      "create table public.posts (id int primary key, title text not null, user_id text not null);",
    );
    await db.exec(
      "insert into public.posts (id, title, user_id) values (1,'Alice','user_alice'),(2,'Bob','user_bob');",
    );
    await db.exec(
      compileRules({
        table: "posts",
        rules: { read: [presets.owner("user_id")], update: [presets.owner("user_id")] },
      }),
    );
  });

  afterAll(async () => {
    await db?.exec("drop table if exists public.posts cascade;").catch(() => {});
    await db?.close();
  });

  /** Read as a synthetic identity through RLS on a single reserved connection. */
  async function readAs(claims: Record<string, unknown>, role = "authenticated") {
    return db.reserve(async (c: Conn) => {
      await c.exec("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await c.exec(`set local role "${role}"`);
      const { rows } = await c.query<{ id: number }>("select * from public.posts order by 1");
      await c.exec("rollback");
      return rows;
    });
  }

  it("a reserved connection keeps set-local role + claims together (RLS filters)", async () => {
    expect((await readAs({ sub: "user_alice" })).map((r) => r.id)).toEqual([1]);
    expect((await readAs({ sub: "user_bob" })).map((r) => r.id)).toEqual([2]);
  });

  it("anon is hard-blocked (locked by default)", async () => {
    // A hard denial may either throw (no grant) or return nothing — never leak rows.
    let rows: { id: number }[] = [];
    try {
      rows = await readAs({}, "anon");
    } catch {
      rows = [];
    }
    expect(rows).toEqual([]);
  });

  it("concurrent reserved transactions do not bleed claims into each other", async () => {
    // If reserve() failed to pin a connection, these would interleave their
    // set-local and cross-contaminate. Run many at once and assert isolation.
    const calls = Array.from({ length: 20 }, (_, i) =>
      readAs({ sub: i % 2 === 0 ? "user_alice" : "user_bob" }),
    );
    const results = await Promise.all(calls);
    results.forEach((rows, i) => {
      expect(rows.map((r) => r.id)).toEqual([i % 2 === 0 ? 1 : 2]);
    });
  });

  it("top-level exec runs multi-statement DDL in one call", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_policies where tablename = 'posts'",
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });
});
