# authzdx — design (v0)

_2026-06-14 · status: draft_

## One line

An open-source, self-hosted BaaS where non-database-experts author access rules
(visual presets + simulator, **locked by default**) on top of Postgres RLS.

## Why (validated over two research rounds)

- **The problem is real and costly.** Supabase's lint `0013_rls_disabled_in_public`
  calls a public table without RLS *"critically unsafe"* (severity ERROR);
  CVE-2025-48757 (Lovable) and ~916 misconfigured Firebase sites (125M+ records,
  19.8M plaintext passwords) are documented leaks rooted in opt-in/auth-rule
  misconfiguration.
- **"Safe-by-default" alone is not the wedge.** PocketBase is already
  locked-by-default; the footgun is specific to Supabase/Firebase. (Verified.)
- **The wedge is the non-dev authoring layer + integration.** No product combines,
  all at once: open-source **+** integrated-into-a-BaaS **+** non-dev authoring **+**
  simulator **+** safe-by-default. Permit.io is closest but is proprietary,
  standalone, and low-code (falls back to Rego). Cerbos/SpiceDB/OpenFGA/Topaz are
  excellent but DSL-by-hand for developers. Convex/Nile/Appwrite/Supabase have no
  friendly authoring layer.

## Key decisions

### D1 — Enforcement engine: compile to Postgres RLS (not embed a policy engine)

A BaaS's core operation is **list filtering** ("give me the rows this user can
see"), which RLS does natively and Zanzibar-style point-check engines do not.
RLS also means zero extra moving parts → keeps "self-host in one command" true.
Deep ReBAC/graph permissions are deferred; revisit embedding Cedar/Cerbos only if
that need is proven.

### D2 — Authoring: opinionated presets, not a DSL

A policy language — however readable — is still developer-facing (this is exactly
where Permit.io stops, falling back to Rego). authzdx exposes presets
(`owner`, `org`, `role`, `public_read`, `authenticated`) that map 1:1 to RLS and
cover ~90% of apps. Escape hatch: raw RLS for power users. v0 ships presets;
a richer readable representation is a maybe-later, not a v0 requirement.

### D3 — Auth: use Better Auth, don't build a core

Better Auth is the foundation. It issues an **asymmetric JWT (JWKS, verify
offline)** whose claims (`sub`, `org_id`, `role`) the rules read. Validated:
Supabase already trusts third-party issuers exactly this way. "Faster than Clerk"
comes from self-hosting/co-location, not from building auth. Note: Better Auth's
JWT plugin is a *complement* to its DB sessions, not a replacement — favor the
hybrid (short JWT hot-path + session-backed refresh).

### D4 — Simulator runs the real policy

Per the SpiceDB lesson: apply the same `compileRules` output to a real Postgres
(pglite, in-process, no Docker) and query as the synthetic user. No
re-implementation that can drift from production.

## Architecture

```
Admin (non-dev authoring + simulator)   <- product surface
        |
@authzdx/rules: presets -> RLS, lockdown, simulate   <- DIFFERENTIATOR
        ^  JWT { sub, org_id, role }  = the bridge
@authzdx/auth: Better Auth (login, orgs, issues JWT) <- foundation
        |
Postgres + RLS  ·  storage (r2dx, post-v0)  ·  functions (post-v0)
```

## The rule model

```
Action  = read | create | update | delete
Preset  = owner(col) | org(col) | role(name, orgCol?) | public_read | authenticated
Rules   = { table, schema?, rules: { [action]: Preset[] } }   // action absent => DENIED
```

Compilation: `lockdown` (RLS on, grants stripped, DML granted to the api role) +
one RLS policy per granted action; multiple presets on an action are OR-ed. Claims
read via `authzdx.uid()/.org()/.has_role()` over the `request.jwt.claims` GUC.

## In / out of v0.1

**In:** auth→claims wiring; locked-by-default; presets→RLS compiler; real
simulator; data API (PostgREST/thin); local dev (one command, pglite).

**Out (deferred, in order):** storage/S3 (→ r2dx), serverless functions, realtime,
typed client SDK, ReBAC/graph, multi-tenant hosting, Postgres clustering.

## Risks

- **Compiler correctness is existential.** A buggy presets→RLS compiler gives
  false confidence — worse than hand-written RLS. Test suite from day 1.
- **Simulator trust.** Must run the real compiled policy (D4), never a model of it.
- **Bun for a 24/7 control plane is unproven** — keep the control plane thin; data
  layer stays runtime-agnostic so Bun is opt-in, not load-bearing.
- **Competitive drift to watch:** Appwrite's server-defined-attributes RFC (would
  add "owner==self" by UI) and Nile's RBAC/ABAC (in design).

## Security posture

Security *is* the product. Non-negotiables:

- **Dependencies pinned to exact versions** + committed lockfile; `.npmrc` enforces
  `save-exact`. No `^`/`~` → no silent pull of a compromised patch release.
- **Identifier allowlist, not just escaping.** Every table/column/schema/role name
  is validated against `^[A-Za-z_][A-Za-z0-9_]*$` (≤63 chars) before it touches
  SQL (`assertIdent`). Quoting is defense-in-depth on top, not the only line.
- **The api role must not bypass RLS.** `authenticated`/`anon` are plain,
  non-owner, non-superuser, non-`BYPASSRLS` roles; the migration/admin role is
  separate (mirrors Supabase's service_role split).
- **Claims only from a verified JWT.** The API layer sets `request.jwt.claims`
  solely from a JWT it verified via Better Auth's JWKS — never from client input.
- **Deny by default, everywhere.** RLS on + blanket grants stripped; an action with
  no preset has no policy and is denied.
- **The simulator runs the real compiled policy** (not a model), so "safe" in
  preview means safe in production.
