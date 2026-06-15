/**
 * SQL building blocks: identifier/literal quoting and the one-time bootstrap that
 * teaches Postgres how to read authzdx's JWT claims.
 */

/**
 * The strict shape authzdx allows for any identifier (table/column/schema/role).
 * Conservative on purpose: an injection-proof allowlist beats clever escaping.
 * (63 = Postgres NAMEDATALEN - 1.)
 */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate an identifier, throwing on anything outside the allowlist. */
export function assertIdent(name: string, kind = "identifier"): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 63 || !SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe ${kind}: ${JSON.stringify(name)} (must match ${String(SAFE_IDENT)}, 1-63 chars)`,
    );
  }
  return name;
}

/** Validate (allowlist) then quote a SQL identifier. Quoting alone is not trusted. */
export function quoteIdent(ident: string): string {
  return `"${assertIdent(ident)}"`;
}

/** Quote a SQL string literal. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `"schema"."table"`. */
export function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

export const AUTHZDX_SCHEMA = "authzdx";

/**
 * Run once per database. Creates the helper functions that RLS policies call to
 * read the caller's identity from the request's JWT claims.
 *
 * The claims are expected in the `request.jwt.claims` GUC (the same convention
 * PostgREST/Supabase use) — set per request to the verified JWT payload that
 * Better Auth issues (`sub`, `org_id`, `role`/`roles`). See the design doc for
 * the auth -> authz wiring.
 */
export const BOOTSTRAP_SQL = `
create schema if not exists authzdx;
grant usage on schema authzdx to public;

create or replace function authzdx.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function authzdx.uid() returns text
  language sql stable
  as $$ select authzdx.jwt() ->> 'sub' $$;

create or replace function authzdx.org() returns text
  language sql stable
  as $$ select authzdx.jwt() ->> 'org_id' $$;

create or replace function authzdx.has_role(target text) returns boolean
  language sql stable
  as $$
    select coalesce(
      (authzdx.jwt() ->> 'role') = target
      or (authzdx.jwt() -> 'roles' ? target),
      false
    )
  $$;
`.trim();
