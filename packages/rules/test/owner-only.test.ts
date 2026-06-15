import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Simulator, type TableRules, presets } from "../src/index";

/**
 * The killer loop, proven end-to-end against real Postgres (pglite):
 *   table is locked by default -> apply the "owner" preset -> simulate.
 * Each caller sees only what the compiled RLS policy allows.
 */

const ddl = `
  create table public.posts (
    id int primary key,
    title text not null,
    user_id text not null
  );
`;

const seedSql = `
  insert into public.posts (id, title, user_id) values
    (1, 'Alice draft', 'user_alice'),
    (2, 'Bob draft', 'user_bob');
`;

const rules: TableRules = {
  table: "posts",
  rules: { read: [presets.owner("user_id")] },
};

describe("owner-only read (the killer loop)", () => {
  let sim: Simulator;

  beforeAll(async () => {
    sim = await Simulator.create({ ddl, seedSql, rules });
  });

  afterAll(async () => {
    await sim?.close();
  });

  it("Alice sees only her own row", async () => {
    const r = await sim.read({ sub: "user_alice" });
    expect(r.blocked).toBe(false);
    expect(r.rows.map((row) => row.id)).toEqual([1]);
  });

  it("Bob sees only his own row", async () => {
    const r = await sim.read({ sub: "user_bob" });
    expect(r.rows.map((row) => row.id)).toEqual([2]);
  });

  it("a stranger sees nothing", async () => {
    const r = await sim.read({ sub: "user_carol" });
    expect(r.blocked).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it("an anonymous caller is hard-blocked (safe by default)", async () => {
    const r = await sim.read("anon");
    expect(r.blocked).toBe(true);
    expect(r.rows).toEqual([]);
  });
});
