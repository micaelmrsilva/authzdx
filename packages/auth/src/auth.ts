import { type BetterAuthOptions, betterAuth } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { buildClaims } from "./claims";

export interface AuthEnv {
  secret: string;
  baseUrl: string;
  /** Better Auth database config (adapter / pool / dialect). */
  database: BetterAuthOptions["database"];
  socialProviders?: BetterAuthOptions["socialProviders"];
}

/**
 * Better Auth, wired to issue an asymmetric (EdDSA) JWT whose payload carries the
 * claims the rules engine reads. `definePayload` IS the auth -> authz bridge:
 * it injects the active org + role exactly like Supabase's custom access token
 * hook, so `authzdx.uid()/.org()/.has_role()` can read them inside Postgres.
 *
 * The api role downstream must verify this JWT (offline, via the JWKS endpoint)
 * and set `request.jwt.claims` from the verified payload — never from the client.
 */
export function createAuth(env: AuthEnv) {
  return betterAuth({
    secret: env.secret,
    baseURL: env.baseUrl,
    database: env.database,
    emailAndPassword: { enabled: true },
    socialProviders: env.socialProviders,
    plugins: [
      organization(),
      jwt({
        jwks: { jwksPath: "/.well-known/jwks.json" },
        jwt: {
          // session is typed `Session & Record<string, any>`, so the
          // organization plugin's fields are accessible here.
          definePayload: ({ user, session }) =>
            buildClaims({
              userId: user.id,
              activeOrganizationId: session.activeOrganizationId ?? null,
              activeRole: session.activeOrganizationRole ?? null,
            }),
        },
      }),
    ],
  });
}
