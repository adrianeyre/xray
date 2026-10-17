import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { USAGE } from "@xray/cli";

import { INSTALL_STEPS } from "./install.js";
import { PACKAGE_NAME } from "./project.js";

// Runs the site's install instructions as they are written, on a machine that
// has never installed Xray: into a PNPM_HOME of their own, so neither this
// machine's global packages nor the repository's builds can stand in for what
// the package ships. Then checks what they installed is the xray the site
// describes: its help is the site's CLI reference.

export interface VerifyInstallOptions {
  /**
   * What to install in place of the package's name: a version of it on npm
   * (`@adrianeyre/xray@1.0.0`) or a tarball's path. The name, as the
   * instructions give it, if absent: the version npm tags `latest`.
   */
  readonly packageSpec?: string;
}

export interface StepRun {
  /** The command as it was run: the instructions', with the package's name replaced. */
  readonly command: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface VerifiedInstall {
  readonly packageSpec: string;
  /** The version `pnpm add -g` said it installed, if it said. */
  readonly installedVersion: string | undefined;
  /** Each install step, then `xray --help`. */
  readonly runs: readonly StepRun[];
  /** Why the instructions do not work as written; none if they do. */
  readonly failures: readonly string[];
  readonly passed: boolean;
}

const windows = process.platform === "win32";
/** Run once the instructions have, to check the xray they installed is the one the site describes. */
const HELP = ["xray", "--help"];

export async function verifyInstall(
  options: VerifyInstallOptions = {},
): Promise<VerifiedInstall> {
  const packageSpec = options.packageSpec ?? PACKAGE_NAME;
  const pnpmHome = await mkdtemp(join(tmpdir(), "xray-site-install-"));
  try {
    const runs: StepRun[] = [];
    const failures: string[] = [];
    for (const step of INSTALL_STEPS) {
      const args = step.command
        .split(" ")
        .map((word) => (word === PACKAGE_NAME ? packageSpec : word));
      const run = await runCommand(args, pnpmHome);
      runs.push(run);
      if (run.code !== 0) {
        failures.push(`\`${step.command}\` exited ${String(run.code)}.`);
        break;
      }
    }
    const installedVersion = new RegExp(
      `^\\+ ${escapeRegExp(PACKAGE_NAME)} (\\S+)\\s*$`,
      "m",
    ).exec(runs[0]?.stdout ?? "")?.[1];

    if (failures.length === 0) {
      const help = await runCommand(HELP, pnpmHome);
      runs.push(help);
      if (help.code !== 0) {
        failures.push(`\`xray --help\` exited ${String(help.code)}.`);
      } else if (help.stdout.replaceAll("\r\n", "\n") !== USAGE) {
        failures.push(
          "`xray --help` does not print the CLI reference the site gives.",
        );
      }
    }
    return {
      packageSpec,
      installedVersion,
      runs,
      failures,
      passed: failures.length === 0,
    };
  } finally {
    await rm(pnpmHome, { recursive: true, force: true });
  }
}

/** A summary of `verified`, in Markdown, with each command's output. */
export function formatVerifiedInstall(verified: VerifiedInstall): string {
  const lines = [
    `## Install instructions, with ${verified.packageSpec}: ${verified.passed ? "PASS" : "FAIL"}`,
    "",
    `Installed: ${verified.installedVersion === undefined ? "unknown" : `${PACKAGE_NAME} ${verified.installedVersion}`}`,
    "",
    ...verified.failures.map((failure) => `- ${failure}`),
  ];
  for (const run of verified.runs) {
    lines.push("", `### \`${run.command}\`: exit ${String(run.code)}`, "");
    // The help is long, and the site has it word for word, unless it failed.
    if (run.command === HELP.join(" ") && verified.passed) {
      lines.push("Prints the CLI reference the site gives, word for word.");
      continue;
    }
    lines.push("```text", `${run.stdout}${run.stderr}`.trimEnd(), "```");
  }
  return `${lines.join("\n")}\n`;
}

/** Runs `args` as a shell would, the global bin folder first on PATH; through one, for pnpm's and xray's `.cmd` shims, on Windows. */
function runCommand(
  args: readonly string[],
  pnpmHome: string,
): Promise<StepRun> {
  const path =
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "PATH";
  const [file = "", ...rest] = args;
  const child = spawn(file, windows ? rest.map((arg) => `"${arg}"`) : rest, {
    cwd: pnpmHome,
    shell: windows,
    env: {
      ...process.env,
      PNPM_HOME: pnpmHome,
      [path]: `${join(pnpmHome, "bin")}${delimiter}${process.env[path] ?? ""}`,
      BROWSER: "none",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout
    .setEncoding("utf8")
    .on("data", (text: string) => (stdout += text));
  child.stderr
    .setEncoding("utf8")
    .on("data", (text: string) => (stderr += text));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ command: args.join(" "), code, stdout, stderr }),
    );
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
