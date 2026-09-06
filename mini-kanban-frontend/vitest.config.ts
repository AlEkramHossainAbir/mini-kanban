import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Frontend unit tests.
 *
 * Scope is deliberately the app's *pure* logic — rank ordering, the
 * TanStack Query cache transforms, and the drop→neighbour-id derivation that
 * feeds PLAN §3's move endpoint. Those are the pieces where a silent
 * regression would corrupt board ordering or send a wrong move payload, and
 * they were already written as plain data-in/data-out functions, so they need
 * no DOM, no React renderer and no dnd-kit harness to exercise.
 *
 * Component/interaction coverage stays with the backend e2e suite and the
 * manual QA matrix (PLAN §10) rather than a jsdom simulation of dragging,
 * which tests the simulation more than the app.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` path alias in tsconfig.json — Vitest resolves
      // imports itself and does not read tsconfig paths.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
