import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Simulator, type TableRules, presets } from "../src/index";

/**
 * Write-side of the killer loop: the SAME compiled RLS that governs reads also
 * governs create/update/delete. Each probe runs as a synthetic user and is
 * rolled back, so the simulator answers "could user X do this?" without mutating.
 *
 * Postgres semantics that shapes the realistic rule set: an UPDATE/DELETE whose
 * WHERE matches an existing row requires that row to be *readable* (a SELECT
 * policy must permit it). So real tables grant read alongside write — which is
 * exactly how the cases below are authored. The "write without read" corner is
 * pinned by its own test so the behavior is explicit, not accidental.
 */

const ddl = `
  create table public.posts (
    id int primary key,
    title text not null,
    user_id text not null,
    org_id text
  );
`;

const seedSql = `
  insert into public.posts (id, title, user_id, org_id) values
    (1, 'Alice draft', 'user_alice', 'org_a'),
    (2, 'Bob draft',   'user_bob',   'org_b');
`;

describe("owner read+write rules", () => {
  const rules: TableRules = {
    table: "posts",
    rules: {
      read: [presets.owner("user_id")],
      create: [presets.owner("user_id")],
      update: [presets.owner("user_id")],
      delete: [presets.owner("user_id")],
    },
  };
  let sim: Simulator;
  beforeAll(async () => {
    sim = await Simulator.create({ ddl, seedSql, rules });
  });
  afterAll(async () => {
    await sim?.close();
  });

  it("Alice can insert a row she owns", async () => {
    const r = await sim.create(
      { sub: "user_alice" },
      { id: 10, title: "new", user_id: "user_alice" },
    );
    expect(r.ok).toBe(true);
    expect(r.affected).toBe(1);
  });

  it("Alice cannot insert a row owned by someone else (WITH CHECK)", async () => {
    const r = await sim.create({ sub: "user_alice" }, { id: 11, title: "x", user_id: "user_bob" });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe("policy");
  });

  it("anon cannot insert (locked by default)", async () => {
    const r = await sim.create("anon", { id: 12, title: "x", user_id: "user_alice" });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe("policy");
  });

  it("Alice can update her own row", async () => {
    const r = await sim.update({ sub: "user_alice" }, { id: 1 }, { title: "edited" });
    expect(r.ok).toBe(true);
    expect(r.affected).toBe(1);
  });

  it("Alice cannot update Bob's row (USING filters it out)", async () => {
    const r = await sim.update({ sub: "user_alice" }, { id: 2 }, { title: "hacked" });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe("no-match");
  });

  it("Bob can delete his own row but not Alice's", async () => {
    expect((await sim.delete({ sub: "user_bob" }, { id: 2 })).ok).toBe(true);
    const blocked = await sim.delete({ sub: "user_bob" }, { id: 1 });
    expect(blocked.ok).toBe(false);
    expect(blocked.denied).toBe("no-match");
  });
});

describe("org + role read+write rules", () => {
  it("org preset: a caller may insert only within their own org", async () => {
    const sim = await Simulator.create({
      ddl,
      seedSql,
      rules: {
        table: "posts",
        rules: { read: [presets.org("org_id")], create: [presets.org("org_id")] },
      },
    });
    const ok = await sim.create(
      { sub: "user_alice", org_id: "org_a" },
      { id: 20, title: "t", user_id: "user_alice", org_id: "org_a" },
    );
    expect(ok.ok).toBe(true);
    const cross = await sim.create(
      { sub: "user_alice", org_id: "org_a" },
      { id: 21, title: "t", user_id: "user_alice", org_id: "org_b" },
    );
    expect(cross.denied).toBe("policy");
    await sim.close();
  });

  it("role preset: only a caller with the role may delete", async () => {
    const sim = await Simulator.create({
      ddl,
      seedSql,
      rules: {
        table: "posts",
        // read open to the org so the row is visible; delete gated on the role.
        rules: { read: [presets.authenticated()], delete: [presets.role("admin")] },
      },
    });
    const admin = await sim.delete({ sub: "user_alice", role: "admin" }, { id: 1 });
    expect(admin.ok).toBe(true);
    const member = await sim.delete({ sub: "user_bob", role: "member" }, { id: 2 });
    expect(member.ok).toBe(false);
    expect(member.denied).toBe("no-match");
    await sim.close();
  });
});

describe("Postgres visibility semantics (explicit)", () => {
  it("an update rule WITHOUT a read rule cannot target rows by match", async () => {
    // Faithful to Postgres: UPDATE ... WHERE needs the row to be SELECT-visible.
    // With no read policy, even the owner's own row is invisible to the match.
    const sim = await Simulator.create({
      ddl,
      seedSql,
      rules: { table: "posts", rules: { update: [presets.owner("user_id")] } },
    });
    const r = await sim.update({ sub: "user_alice" }, { id: 1 }, { title: "edited" });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe("no-match");
    await sim.close();
  });
});
