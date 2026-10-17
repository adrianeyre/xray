import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";

import {
  parseBuildDiagnostics,
  type BuildDiagnostic,
} from "./build-diagnostics.js";

/** What `dotnet build` made of a Recovered Solution (FR-13). */
export interface SolutionBuild {
  readonly succeeded: boolean;
  /** Everything `dotnet build` printed, stdout then stderr. */
  readonly output: string;
  /**
   * Its errors and warnings, each once, mapped to files and lines in the
   * Recovered Solution, in the order they were printed.
   */
  readonly diagnostics: readonly BuildDiagnostic[];
}

export interface BuildOptions {
  /** The `dotnet` host that builds it. Defaults to `dotnet` on PATH. */
  readonly dotnetPath?: string;
  /** How long the build may take before it is killed and counted as failed. */
  readonly timeoutMs?: number;
  /** Stops the build when aborted, rejecting with an `AbortError`. */
  readonly signal?: AbortSignal;
  /** The global-packages folder NuGet restores into, as `NUGET_PACKAGES`. Defaults to NuGet's own. */
  readonly globalPackagesFolder?: string;
  /**
   * Restore packages only from `offlineSource`, the global-packages folder,
   * so the build makes no network calls (`--offline`): a package not there
   * already fails to restore. NuGet's audit, which asks the package sources
   * for known vulnerabilities, is off.
   */
  readonly offlineSource?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/**
 * Builds a solution with `dotnet build`, its output landing beside its
 * projects as it would for anyone who opened it. Resolves with whether the
 * build succeeded, what it printed, and the diagnostics in that, mapped to
 * files relative to the solution's folder; rejects only if `dotnet` cannot be
 * run, or the build is stopped by its `signal`.
 */
export async function buildSolution(
  solutionPath: string,
  options: BuildOptions = {},
): Promise<SolutionBuild> {
  const { succeeded, output } = await runBuild(solutionPath, options);
  const directory = dirname(solutionPath);
  // `dotnet build` may print the real path of a folder reached through a link.
  const real = await realpath(directory).catch(() => directory);
  return {
    succeeded,
    output,
    diagnostics: parseBuildDiagnostics(output, directory, [real]),
  };
}

async function runBuild(
  solutionPath: string,
  options: BuildOptions,
): Promise<Omit<SolutionBuild, "diagnostics">> {
  const dotnetPath = options.dotnetPath ?? "dotnet";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { offlineSource, globalPackagesFolder } = options;
  if (offlineSource !== undefined) {
    // NuGet refuses a local package source that does not exist.
    await mkdir(offlineSource, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    execFile(
      dotnetPath,
      [
        "build",
        solutionPath,
        // The classic console logger, whose diagnostics are in MSBuild's
        // canonical format, even where the terminal logger is the default.
        "-tl:off",
        ...(offlineSource === undefined
          ? []
          : [`-p:RestoreSources=${offlineSource}`, "-p:NuGetAudit=false"]),
      ],
      {
        env: {
          ...process.env,
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
          ...(globalPackagesFolder === undefined
            ? {}
            : { NUGET_PACKAGES: globalPackagesFolder }),
          ...(offlineSource === undefined
            ? {}
            : { DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: "1" }),
        },
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      (error, stdout, stderr) => {
        if (error?.name === "AbortError") {
          reject(error);
          return;
        }
        if (error?.code === "ENOENT") {
          reject(
            new Error(
              `Could not run "${dotnetPath}" to build the Recovered Solution: install the .NET SDK 8 or later from https://dot.net and make sure \`dotnet\` is on PATH.`,
              { cause: error },
            ),
          );
          return;
        }
        const timedOut =
          error !== null && error.killed && error.code === null
            ? `\nThe build did not finish within ${timeoutMs} ms, so it was stopped.`
            : "";
        resolve({
          succeeded: error === null,
          output: `${stdout}${stderr}${timedOut}`,
        });
      },
    );
  });
}
