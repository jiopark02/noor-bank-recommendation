import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Test-only configuration. Its single job is to teach vitest the `@/*` path
 * alias that tsconfig.json already declares, so a test can import a module that
 * uses `@/...` internally (e.g. plaidApiUtils -> apiAuth -> @/lib/supabase).
 * Without it those imports fail to resolve and the suite cannot load the module
 * at all.
 *
 * Deliberately minimal: no environment, setup files, or include patterns, so
 * vitest's defaults — and the behaviour of the existing suites, which use
 * relative imports — stay exactly as they were.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
