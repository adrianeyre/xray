// Running the rebuilt program (FR-14): opt-in, as it executes recovered code
// on the user's machine with their permissions (PRD §8).

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { OutputKind } from "../inspect/assembly-summary.js";
import type { SolutionBuild } from "./build-solution.js";

/**
 * How running the rebuilt program went. It ran if it `exited` of its own
 * accord, whatever its exit code, or, as a Windows GUI program, `launched`
 * and was still running when Xray closed it. It was `skipped` if it could not
 * run here; otherwise it did not run: it `crashed`, `timed-out`, or
 * `failed-to-start`.
 */
export const RUN_STATUSES = [
  "exited",
  "launched",
  "skipped",
  "crashed",
  "timed-out",
  "failed-to-start",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** What the rebuilt program did when it was run, or why it was not. */
export interface ProgramRun {
  readonly status: RunStatus;
  /** Why it was skipped or did not run; `null` if it `exited` or `launched`. */
  readonly reason: string | null;
  /**
   * The program run, relative to the Recovered Solution's folder with `/`
   * between segments; `null` if it was skipped.
   */
  readonly program: string | null;
  /** Its exit code, if it exited; otherwise `null`. */
  readonly exitCode: number | null;
  /** What it wrote to stdout; `null` if it was skipped. */
  readonly stdout: string | null;
  /** What it wrote to stderr; `null` if it was skipped. */
  readonly stderr: string | null;
}

/** The statuses of a program that did not run, which makes a Reconstruction Partial (FR-15). */
export function runFailed(run: ProgramRun): boolean {
  return (
    run.status === "crashed" ||
    run.status === "timed-out" ||
    run.status === "failed-to-start"
  );
}

/** The Recovered Solution whose program is to be run. */
export interface RunTarget {
  /** Its `.csproj`, relative to the Recovered Solution's folder with `/` between segments. */
  readonly projectPath: string;
  readonly assemblyName: string;
  readonly targetFramework: string;
  readonly outputKind: OutputKind;
}

/** How to run the rebuilt program, or why it cannot be run here. */
export type RunPlan =
  | {
      readonly runnable: true;
      /** Relative to the Recovered Solution's folder, with `/` between segments. */
      readonly program: string;
      /** Whether it is started by the `dotnet` host, rather than as itself. */
      readonly hosted: boolean;
      /** Whether it is a Windows GUI program, which runs until it is closed. */
      readonly gui: boolean;
    }
  | { readonly runnable: false; readonly reason: string };

/** What each OS is called, for people. */
export const OS_NAMES: Partial<Readonly<Record<NodeJS.Platform, string>>> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

/**
 * Whether a target framework moniker names .NET Framework: `net` and a
 * version without dots (`net48`, `net40-client`), where .NET 5 and later
 * have one (`net8.0`).
 */
export function isNetFramework(targetFramework: string): boolean {
  return /^net\d+(-client)?$/i.test(targetFramework);
}

/**
 * How to run the program `dotnet build` built from a Recovered Solution, if
 * it can run on `platform` (by default, this OS): only if it built and has an
 * entry point; a WinForms or WPF program, a .NET Framework one, or one for a
 * Windows target framework (`net8.0-windows`) only on Windows.
 */
export function planRun(
  target: RunTarget,
  build: SolutionBuild | null,
  platform: NodeJS.Platform = process.platform,
): RunPlan {
  const skip = (reason: string): RunPlan => ({ runnable: false, reason });
  if (build === null) {
    return skip(
      "The Recovered Solution was not built, so there is no rebuilt program to run.",
    );
  }
  if (!build.succeeded) {
    return skip(
      "The Recovered Solution did not build, so there is no rebuilt program to run.",
    );
  }
  const { outputKind, targetFramework } = target;
  if (outputKind === "library") {
    return skip(
      "It is a library, with no entry point, so there is no program to run.",
    );
  }
  const windows = platform === "win32";
  const os = OS_NAMES[platform] ?? platform;
  if (!windows && (outputKind === "winforms" || outputKind === "wpf")) {
    const framework = outputKind === "winforms" ? "WinForms" : "WPF";
    return skip(
      `It is a ${framework} program, and ${framework} runs only on Windows, not on ${os}.`,
    );
  }
  const netFramework = isNetFramework(targetFramework);
  if (!windows && netFramework) {
    return skip(
      `It targets ${targetFramework}, and a .NET Framework program runs only on Windows, not on ${os}.`,
    );
  }
  if (!windows && /-windows/i.test(targetFramework)) {
    return skip(
      `It targets ${targetFramework}, which runs only on Windows, not on ${os}.`,
    );
  }
  const projectFolder = target.projectPath.split("/").slice(0, -1);
  const extension = netFramework ? "exe" : "dll";
  return {
    runnable: true,
    program: [
      ...projectFolder,
      "bin",
      "Debug",
      targetFramework,
      `${target.assemblyName}.${extension}`,
    ].join("/"),
    hosted: !netFramework,
    gui: outputKind !== "console",
  };
}

export interface RunOptions {
  /** The `dotnet` host that starts a program that is not .NET Framework. Defaults to `dotnet` on PATH. */
  readonly dotnetPath?: string;
  /** How long a console program may run before it is stopped and counted as timed out. */
  readonly timeoutMs?: number;
  /**
   * How long a Windows GUI program is given to start: if it is still running
   * then, it launched, and is closed.
   */
  readonly launchMs?: number;
  /** Stops the program when aborted; it then resolves as having failed to start. */
  readonly signal?: AbortSignal;
}

export const DEFAULT_RUN_TIMEOUT_MS = 60_000;
export const DEFAULT_LAUNCH_MS = 5_000;

/** How much of each of stdout and stderr is kept, in characters. */
export const MAX_RUN_OUTPUT = 1024 * 1024;

/** The exit code of a Windows .NET program ended by an unhandled exception, as unsigned and signed. */
const UNHANDLED_EXCEPTION_CODES = new Set([0xe0434352, 0xe0434352 - 2 ** 32]);

/**
 * Runs a rebuilt program as {@link planRun} planned, in its own folder in
 * the Recovered Solution at `directory`, with no stdin, and resolves with
 * what it did. A program that targets a runtime that is not installed runs
 * on a later one. Never rejects: a program that cannot be started, crashes or
 * outlives its time resolves saying so.
 */
export async function runProgram(
  directory: string,
  plan: Extract<RunPlan, { readonly runnable: true }>,
  options: RunOptions = {},
): Promise<ProgramRun> {
  const { program, hosted, gui } = plan;
  const path = join(directory, ...program.split("/"));
  const notRun = (
    status: RunStatus,
    reason: string,
    output: { stdout: string; stderr: string } = { stdout: "", stderr: "" },
  ): ProgramRun => ({ status, reason, program, exitCode: null, ...output });
  try {
    await access(path);
  } catch {
    return notRun(
      "failed-to-start",
      `There is no program at ${program}, where \`dotnet build\` should have put it.`,
    );
  }
  const dotnetPath = options.dotnetPath ?? "dotnet";
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const launchMs = options.launchMs ?? DEFAULT_LAUNCH_MS;
  const [command, args] = hosted ? [dotnetPath, [path]] : [path, []];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: dirname(path),
      stdio: ["ignore", "pipe", "pipe"],
      // Xray needs .NET 8 *or later*: a program for a runtime that is not
      // installed (net8.0 where only 9 is, netcoreapp3.1…) runs on a later one.
      env: { DOTNET_ROLL_FORWARD: "Major", ...process.env },
      windowsHide: true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const output = { stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].setEncoding("utf8").on("data", (chunk: string) => {
        output[stream] = keep(output[stream], chunk);
      });
    }

    let settled = false;
    let stoppedAs: "launched" | "timed-out" | undefined;
    const settle = (run: ProgramRun): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(run);
      }
    };
    const timer = setTimeout(
      () => {
        stoppedAs = gui ? "launched" : "timed-out";
        child.kill("SIGKILL");
      },
      gui ? launchMs : timeoutMs,
    );

    child.once("error", (error) => {
      settle(
        notRun(
          "failed-to-start",
          hosted
            ? `Could not run ${program} with "${dotnetPath}": ${error.message}`
            : `Could not run ${program}: ${error.message}`,
          output,
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (stoppedAs === "launched") {
        settle({
          status: "launched",
          reason: null,
          program,
          exitCode: null,
          ...output,
        });
      } else if (stoppedAs === "timed-out") {
        settle(
          notRun(
            "timed-out",
            `It did not exit within ${timeoutMs} ms, so it was stopped.`,
            output,
          ),
        );
      } else if (code === null) {
        const how =
          signal === "SIGABRT"
            ? ", as .NET ends a program that throws an unhandled exception"
            : "";
        settle(notRun("crashed", `It was ended by ${signal}${how}.`, output));
      } else if (UNHANDLED_EXCEPTION_CODES.has(code)) {
        settle({
          status: "crashed",
          reason: `It exited with 0x${(code >>> 0).toString(16).toUpperCase()}, as .NET ends a program that throws an unhandled exception.`,
          program,
          exitCode: code,
          ...output,
        });
      } else {
        settle({
          status: "exited",
          reason: null,
          program,
          exitCode: code,
          ...output,
        });
      }
    });
  });
}

/** `kept` with as much of `chunk` as fits in {@link MAX_RUN_OUTPUT}, saying when some was cut. */
function keep(kept: string, chunk: string): string {
  // Longer than the MiB only once it says it was cut. Exactly the MiB, it
  // still says so when more follows in a later chunk.
  if (kept.length > MAX_RUN_OUTPUT || chunk.length === 0) {
    return kept;
  }
  const room = MAX_RUN_OUTPUT - kept.length;
  return chunk.length <= room
    ? kept + chunk
    : `${kept}${chunk.slice(0, room)}\n[Xray kept only the first ${MAX_RUN_OUTPUT} characters.]\n`;
}
