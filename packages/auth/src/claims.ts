/**
 * The single source of truth for the auth -> authz claim contract.
 *
 * These are the exact claim names the rules engine reads inside Postgres
 * (`authzdx.uid()` -> sub, `authzdx.org()` -> org_id, `authzdx.has_role()` ->
 * role/roles). Better Auth's `definePayload` and the API-side verifier both go
 * through here so the names can never drift apart.
 */

export interface AuthzdxClaims {
  /** The user id. Read by `authzdx.uid()`. */
  sub: string;
  /** The active organization id, or null. Read by `authzdx.org()`. */
  org_id: string | null;
  /** The caller's role in the active org, or null. Read by `authzdx.has_role()`. */
  role: string | null;
  [key: string]: unknown;
}

export interface ClaimsInput {
  userId: string;
  activeOrganizationId?: string | null;
  activeRole?: string | null;
}

/** Map an authenticated session to the claims the rules engine understands. */
export function buildClaims(input: ClaimsInput): AuthzdxClaims {
  return {
    sub: input.userId,
    org_id: input.activeOrganizationId ?? null,
    role: input.activeRole ?? null,
  };
}
