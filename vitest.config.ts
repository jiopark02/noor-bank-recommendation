import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Test-only configuration. It does two things:
 *
 * 1. Teaches vitest the `@/*` path alias that tsconfig.json already declares,
 *    so a test can import a module that uses `@/...` internally (e.g.
 *    plaidApiUtils -> apiAuth -> @/lib/supabase). Without it those imports
 *    fail to resolve and the suite cannot load the module at all.
 *
 * 2. Sets how the test transform compiles JSX. tsconfig.json sets
 *    `"jsx": "preserve"` because the Next build compiles JSX itself; the
 *    Oxc transform vite uses here follows that setting and leaves JSX in the
 *    output, which vite's import analysis cannot parse, so a test that imports
 *    a `.tsx` component fails to load. The automatic runtime is set here for
 *    tests only; tsconfig.json is left as the Next build needs it.
 *
 * Otherwise minimal: no environment, setup files, or include patterns, so
 * vitest's defaults stay in effect.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
