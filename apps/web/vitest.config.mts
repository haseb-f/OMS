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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
