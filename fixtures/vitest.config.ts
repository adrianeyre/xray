import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Building a Fixture from cold restores and compiles it: allow minutes.
    hookTimeout: 5 * 60_000,
  },
});
