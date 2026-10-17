import { fileURLToPath } from "node:url";

import { coreCommands, main, processIo } from "@xray/cli";

// The published `xray` binary, bundled into dist/ by build.ts. It runs the
// engine and serves the web app the package ships beside dist/, rather than
// the repository's builds of them.

/** The engine sidecar, published into the package's engine/. */
export const ENGINE_PATH = fileURLToPath(
  new URL("../engine/Xray.Engine.dll", import.meta.url),
);

/** The web app, built into the package's web/. */
export const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

process.exitCode = await main(
  process.argv.slice(2),
  processIo,
  coreCommands({ engine: { enginePath: ENGINE_PATH }, webRoot: WEB_ROOT }),
);
