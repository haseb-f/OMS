import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Component-level regression tests (as opposed to `apps/api`'s Jest suite).
 * Added specifically to catch bidi/rendering-pipeline bugs a pure formatter
 * unit test cannot see — see semantic-cell.rendering.spec.tsx.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    // Full EnterpriseDataTable renders under jsdom take several seconds on a
    // loaded machine; the 5s default made them fail on time, not on behaviour.
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Workspace package (tsconfig paths) — the shared password policy (R13 A2).
      "@oms/shared": fileURLToPath(new URL("../../packages/shared/index.ts", import.meta.url)),
    },
  },
});
