import { describe, expect, it } from "vitest";
import { type TableRules, compileRules, presets } from "../src/index";

describe("compileRules", () => {
  it("locks the table and emits an owner SELECT policy", () => {
    const sql = compileRules({ table: "posts", rules: { read: [presets.owner("user_id")] } });
    expect(sql).toContain("enable row level security");
    expect(sql).toContain('revoke all on table "public"."posts" from public');
    expect(sql).toContain('revoke all on table "public"."posts" from "anon"');
    expect(sql).toContain('create policy "authzdx_posts_read" on "public"."posts" for select');
    expect(sql).toContain('authzdx.uid() = "user_id"::text');
  });

  it("omits a policy for any action without presets (denied by absence)", () => {
    const sql = compileRules({ table: "posts", rules: { read: [presets.publicRead()] } });
    expect(sql).toContain("for select");
    expect(sql).not.toContain("for insert");
    expect(sql).not.toContain("for update");
    expect(sql).not.toContain("for delete");
  });

  it("ORs multiple presets for one action", () => {
    const sql = compileRules({
      table: "docs",
      rules: { read: [presets.owner("user_id"), presets.org("org_id")] },
    });
    expect(sql).toMatch(/for select to "authenticated" using \(\(.*\) or \(.*\)\)/);
  });

  it("rejects public_read on a write action", () => {
    expect(() =>
      compileRules({
        table: "posts",
        rules: { create: [presets.publicRead()] },
      } satisfies TableRules),
    ).toThrow(/public_read/);
  });

  it("rejects identifier injection in a column name", () => {
    expect(() =>
      compileRules({
        table: "posts",
        rules: { read: [presets.owner('user_id"); drop table users; --')] },
      }),
    ).toThrow(/unsafe/);
  });

  it("rejects an injection attempt in the table name", () => {
    expect(() =>
      compileRules({
        table: 'posts"; drop table users; --',
        rules: { read: [presets.authenticated()] },
      }),
    ).toThrow(/unsafe/);
  });
});
