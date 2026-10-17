import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The binary's tests run `xray doctor` and `xray inspect` against the real
    // engine, and `xray ui` serving the real web app.
    globalSetup: ["../core/src/engine/build-engine.ts", "../web/build-web.ts"],
  },
});
