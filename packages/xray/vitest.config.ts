import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tests install the package from the tarball `pnpm publish` would
    // upload, packed, and so built, fresh.
    globalSetup: ["src/pack.ts"],
  },
});
