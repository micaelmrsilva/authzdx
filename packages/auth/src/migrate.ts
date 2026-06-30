import { getMigrations } from "better-auth/db/migration";
import { type AuthEnv, authOptions } from "./auth";

/**
 * Create / update the Better Auth tables (user, session, account, jwks,
 * organization, …) in the configured database. Idempotent — safe to run on every
 * boot, which is what makes `pnpm dev` a single command with no manual migration
 * step. Backed by Better Auth's built-in Kysely migrator, so it only works when
 * `database` is a Pool/dialect (not a custom adapter) — which is our setup.
 */
export async function runAuthMigrations(env: AuthEnv): Promise<void> {
  const { runMigrations } = await getMigrations(authOptions(env));
  await runMigrations();
}
