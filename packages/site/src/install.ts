import { MINIMUM_DOTNET_SDK_MAJOR, MINIMUM_NODE_MAJOR } from "@xray/core";

import { PACKAGE_NAME } from "./project.js";

// How to install Xray, as the site, the README and the package's own README
// give it. verifyInstall runs these very commands.

export interface InstallStep {
  /** The command, as a user types it. */
  readonly command: string;
  /** What it does, shown beside it as a shell comment. */
  readonly comment: string;
}

export const INSTALL_STEPS: readonly InstallStep[] = [
  {
    command: `pnpm add -g ${PACKAGE_NAME}`,
    comment: "installs the xray binary onto your PATH",
  },
  {
    command: "xray doctor",
    comment: "checks Node.js, the .NET SDK and Xray's engine",
  },
];

/** What Xray needs on the machine it is installed on, as `xray doctor` checks it. */
export const REQUIREMENTS: readonly string[] = [
  "Windows, macOS or Linux",
  `Node.js ${MINIMUM_NODE_MAJOR} or later, and pnpm`,
  `.NET SDK ${MINIMUM_DOTNET_SDK_MAJOR} or later`,
];
