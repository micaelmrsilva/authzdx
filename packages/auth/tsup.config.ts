import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // dts disabled for now: generating .d.ts over Better Auth's deep inferred
  // return type is heavy/fragile. Types are still enforced via `tsc --noEmit`.
  // Revisit once apps/* consume @authzdx/auth and need published types.
  dts: false,
  clean: true,
  sourcemap: true,
});
