import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The server's tests serve the real web app, built fresh, and reconstruct
    // the Fixtures with the real engine.
    globalSetup: ["../core/src/engine/build-engine.ts", "../web/build-web.ts"],
    // The web app's client is tested with Node.js's EventSource, which
    // connects again as a browser's does.
    execArgv: ["--experimental-eventsource"],
  },
});
