import { spawn, type SpawnOptions } from "node:child_process";

export interface RunOptions {
  /** The `dotnet` host that runs the Assembly. Defaults to `dotnet` on PATH. */
  readonly dotnetPath?: string;
  /** How long the program may run before it is killed and the run rejects. */
  readonly timeoutMs?: number;
  /**
   * The Assembly's target framework moniker. A .NET Framework program
   * (`net48`…) is a Windows program of its own, started as itself; any other
   * is started by the `dotnet` host, the default.
   */
  readonly targetFramework?: string;
}

/** What a program wrote and how it exited. */
export interface ProgramRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Whether a target framework moniker names .NET Framework: `net` and a
 * version without dots (`net48`, `net481`), where .NET 5 and later have one
 * (`net8.0`).
 */
export function isNetFramework(targetFramework: string): boolean {
  return /^net\d+(-client)?$/i.test(targetFramework);
}

/**
 * Whether a console Assembly for `targetFramework` can run on `platform`
 * (by default, this OS): a .NET Framework one only on Windows; any other
 * wherever the `dotnet` host runs, on a later runtime if need be.
 */
export function runsOn(
  targetFramework: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return !isNetFramework(targetFramework) || platform === "win32";
}

/**
 * Runs a console Assembly with no stdin, and resolves with its output and
 * exit code: a framework-dependent one as `dotnet <assembly> <args…>`, a
 * .NET Framework one (by its `targetFramework`) as `<assembly> <args…>`.
 * Rejects if it cannot be started (a .NET Framework one anywhere but
 * Windows), is killed, or outlives the timeout.
 */
export function runAssembly(
  assemblyPath: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<ProgramRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let start: Start;
  try {
    start = startOf(assemblyPath, args, options);
  } catch (error) {
    return Promise.reject(error as Error);
  }
  const { command, commandArgs, cannotStart } = start;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, spawnOptions());
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(cannotStart, { cause: error }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === null) {
        const why = timedOut
          ? `did not exit within ${timeoutMs} ms`
          : `was killed by ${signal}`;
        reject(new Error(`${assemblyPath} ${why}.\n${stdout}${stderr}`));
      } else {
        resolve({ stdout, stderr, exitCode: code });
      }
    });
  });
}

/** How a GUI program fared in the time it was given to stay alive. */
export type Launch =
  | {
      /** It was still running when its time was up, and was closed. */
      readonly outcome: "stayed-alive";
      readonly aliveForMs: number;
    }
  | {
      /** It exited, or was ended, before its time was up. */
      readonly outcome: "exited";
      /** How long it was to stay alive. */
      readonly aliveForMs: number;
      /** How long after it was started it exited. */
      readonly afterMs: number;
      /** Its exit code; `null` if it was ended by a signal. */
      readonly exitCode: number | null;
      /** The signal that ended it; `null` if it exited. */
      readonly signal: NodeJS.Signals | null;
      readonly stdout: string;
      readonly stderr: string;
    };

export interface LaunchOptions extends Omit<RunOptions, "timeoutMs"> {
  /** How long the program must stay alive. */
  readonly aliveForMs?: number;
}

export const DEFAULT_ALIVE_FOR_MS = 5_000;

/**
 * Launches a GUI Assembly (WinForms, WPF), started as {@link runAssembly}
 * starts a program, and resolves once it has stayed alive for `aliveForMs`,
 * then closes it; or, if it exits or is ended before then, with how and what
 * it wrote. It is closed as it is killed: driving its window is out of scope.
 * Rejects only if it cannot be started.
 */
export function launchAssembly(
  assemblyPath: string,
  args: readonly string[] = [],
  options: LaunchOptions = {},
): Promise<Launch> {
  const aliveForMs = options.aliveForMs ?? DEFAULT_ALIVE_FOR_MS;
  let start: Start;
  try {
    start = startOf(assemblyPath, args, options);
  } catch (error) {
    return Promise.reject(error as Error);
  }
  const { command, commandArgs, cannotStart } = start;

  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, commandArgs, spawnOptions());
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    let stayedAlive = false;
    const timer = setTimeout(() => {
      stayedAlive = true;
      child.kill("SIGKILL");
    }, aliveForMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(cannotStart, { cause: error }));
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve(
        stayedAlive
          ? { outcome: "stayed-alive", aliveForMs }
          : {
              outcome: "exited",
              aliveForMs,
              afterMs: Math.round(performance.now() - started),
              exitCode,
              signal,
              stdout,
              stderr,
            },
      );
    });
  });
}

/** A program gets no stdin; its stdout and stderr are read. */
function spawnOptions() {
  return {
    stdio: ["ignore", "pipe", "pipe"],
    // Xray needs .NET 8 *or later*: an Assembly for a runtime that is not
    // installed (net8.0 where only 9 is, netcoreapp3.1…) runs on a later one.
    env: { ...process.env, DOTNET_ROLL_FORWARD: "Major" },
    windowsHide: true,
  } as const satisfies SpawnOptions;
}

/** How to start an Assembly, and what to say if it cannot be. */
interface Start {
  readonly command: string;
  readonly commandArgs: readonly string[];
  readonly cannotStart: string;
}

/**
 * How to start an Assembly: a framework-dependent one as
 * `dotnet <assembly> <args…>`, a .NET Framework one (by its
 * `targetFramework`) as `<assembly> <args…>`. Throws for a .NET Framework one
 * anywhere but Windows.
 */
function startOf(
  assemblyPath: string,
  args: readonly string[],
  options: Pick<RunOptions, "dotnetPath" | "targetFramework">,
): Start {
  const dotnetPath = options.dotnetPath ?? "dotnet";
  const { targetFramework } = options;
  if (targetFramework !== undefined && isNetFramework(targetFramework)) {
    if (!runsOn(targetFramework)) {
      throw new Error(
        `Could not run ${assemblyPath}: it targets ${targetFramework}, and a .NET Framework program runs only on Windows.`,
      );
    }
    return {
      command: assemblyPath,
      commandArgs: args,
      cannotStart: `Could not run ${assemblyPath}.`,
    };
  }
  return {
    command: dotnetPath,
    commandArgs: [assemblyPath, ...args],
    cannotStart: `Could not run ${assemblyPath} with "${dotnetPath}".`,
  };
}
