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
 * The portable public surface of the auth instance. Better Auth's full inferred
 * type references zod internals that aren't nameable in a .d.ts (TS2742), so we
 * narrow to what consumers actually use (the request handler + the api object).
 */
export interface AuthInstance {
  readonly handler: (request: Request) => Promise<Response>;
  readonly api: Record<string, unknown>;
  readonly options: unknown;
}

/** The relative path (under Better Auth's `/api/auth` base) that serves the JWKS. */
export const JWKS_PATH = "/.well-known/jwks.json";

/**
 * The Better Auth configuration — the single source of truth shared by the live
 * instance (`createAuth`) and the migration runner (`runAuthMigrations`), so both
 * see the exact same database, plugins, and claim contract.
 *
 * `definePayload` IS the auth -> authz bridge: it injects the active org + role
 * exactly like Supabase's custom access token hook, so `authzdx.uid()/.org()/
 * .has_role()` can read them inside Postgres. The JWT is asymmetric (EdDSA) and
 * verified downstream offline via the JWKS endpoint — never trusted from the client.
 */
export function authOptions(env: AuthEnv): BetterAuthOptions {
  return {
    secret: env.secret,
    baseURL: env.baseUrl,
    database: env.database,
    emailAndPassword: { enabled: true },
    socialProviders: env.socialProviders,
    plugins: [
      organization(),
      jwt({
        jwks: { jwksPath: JWKS_PATH },
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
  };
}

/** The live Better Auth instance, issuing the EdDSA JWT the rules engine reads. */
export function createAuth(env: AuthEnv): AuthInstance {
  return betterAuth(authOptions(env)) as unknown as AuthInstance;
}
