// `pnpm --filter @xray/site verify-install [--package <spec>]`: runs the
// site's install instructions as written, on this machine, against the package
// on npm (or, with --package, the version or tarball given in its place), and
// prints what each command printed. Exits 1 if they do not work as written.

import { parseArgs } from "node:util";

import { formatVerifiedInstall, verifyInstall } from "./verify-install.js";

const { values } = parseArgs({
  options: { package: { type: "string" } },
});

const verified = await verifyInstall(
  values.package === undefined ? {} : { packageSpec: values.package },
);
process.stdout.write(formatVerifiedInstall(verified));
process.exitCode = verified.passed ? 0 : 1;
