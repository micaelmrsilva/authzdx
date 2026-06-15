/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SCAFFOLD — illustrative wiring, NOT yet verified or part of the build.     │
 * │ Run `pnpm --filter @authzdx/auth add better-auth`, then verify this        │
 * │ against the installed Better Auth version (its plugin API moves fast).     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Where auth fits: Better Auth is the FOUNDATION, not the differentiator. Its one
 * job for authzdx is to issue a JWT carrying the claims the rules engine reads —
 * `sub` (user id), `org_id` (active org), `role`/`roles`. That JWT is the bridge:
 *
 *   Better Auth  --(JWT: sub, org_id, role)-->  request.jwt.claims  -->  RLS
 *
 * The pattern below mirrors Supabase's "custom access token hook": inject the
 * active org + role into the token payload so `authzdx.uid()/.org()/.has_role()`
 * (see @authzdx/rules BOOTSTRAP_SQL) can read them inside Postgres.
 */

// import { betterAuth } from "better-auth";
// import { organization, jwt } from "better-auth/plugins";

export interface AuthEnv {
  databaseUrl: string;
  secret: string;
  baseUrl: string;
}

/**
 * Intended shape of the Better Auth instance. Uncomment the imports once the
 * dependency is installed and confirm each plugin option against current docs.
 */
export function createAuth(_env: AuthEnv) {
  // return betterAuth({
  //   secret: env.secret,
  //   baseURL: env.baseUrl,
  //   database: /* postgres adapter for env.databaseUrl */,
  //   emailAndPassword: { enabled: true },
  //   socialProviders: {
  //     google: { clientId: ..., clientSecret: ... },
  //     github: { clientId: ..., clientSecret: ... },
  //   },
  //   plugins: [
  //     organization(),       // orgs, members, roles, invitations
  //     jwt({                 // asymmetric JWT + JWKS endpoint (verify offline)
  //       jwt: {
  //         // Inject the claims the rules engine reads. Verify the exact
  //         // option name/signature against the installed version.
  //         definePayload: async ({ user, session }) => ({
  //           sub: user.id,
  //           org_id: session.activeOrganizationId ?? null,
  //           role: session.activeOrganizationRole ?? null,
  //         }),
  //       },
  //     }),
  //   ],
  // });
  throw new Error("createAuth is a scaffold — install better-auth and wire it (see header).");
}
