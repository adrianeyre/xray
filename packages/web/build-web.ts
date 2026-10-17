import { fileURLToPath } from "node:url";

import { build } from "vite";

/**
 * Vitest global setup: builds the web app the server's tests serve, so they
 * never serve a stale build. Same build as `pnpm build:web`.
 */
export default async function buildWeb(): Promise<void> {
  await build({
    root: fileURLToPath(new URL(".", import.meta.url)),
    logLevel: "warn",
  });
}
