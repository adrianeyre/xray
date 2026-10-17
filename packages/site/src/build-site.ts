// `pnpm build:site`: writes the project site to packages/site/dist/, which the
// CI workflow publishes to GitHub Pages.

import { SITE_DIRECTORY, buildSite } from "./site.js";

await buildSite();
process.stdout.write(`Wrote the project site to ${SITE_DIRECTORY}\n`);
