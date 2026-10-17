import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { dotnetBuild } from "./dotnet-build.js";
import {
  buildFixture,
  isGuiFixture,
  readFixtureInputs,
  type FixtureOptions,
} from "./fixtures.js";
import {
  launchAssembly,
  runAssembly,
  runsOn,
  type Launch,
  type ProgramRun,
} from "./run-assembly.js";

/**
 * The Reconstruction under test: turns the Assembly at `assemblyPath` into a
 * Recovered Solution in `outputDirectory`, a folder that does not exist yet.
 * Core's Reconstruction plugs in here; until it exists, tests stand in their own.
 */
export type Reconstruct = (
  assemblyPath: string,
  outputDirectory: string,
) => Promise<void>;

export interface RoundTripOptions extends FixtureOptions {
  /**
   * Where the Recovered Solution and its rebuild are written, and left for
   * inspection; it must be empty or not exist yet. Defaults to a temporary
   * folder, deleted once the Round-trip is done.
   */
  readonly workDirectory?: string;
  /** How long each run of the original or rebuilt program may take. */
  readonly timeoutMs?: number;
  /**
   * How long a GUI Fixture's rebuilt app must stay alive, on Windows, for the
   * Round-trip to pass. Defaults to 5 s.
   */
  readonly aliveForMs?: number;
}

/** What a Round-trip of a Fixture found. */
export interface RoundTripResult {
  readonly fixture: string;
  /** Whether the Recovered Solution rebuilt and behaved like the original on every input. */
  readonly passed: boolean;
  /** Why the Round-trip stopped before any behaviour could be compared, if it did. */
  readonly failure?: RoundTripFailure;
  /** Each input, in the order of the Fixture's `inputs.json`; none for a GUI Fixture. */
  readonly runs: readonly RoundTripRun[];
  /**
   * A GUI Fixture's smoke test of its rebuilt app, once the Recovered
   * Solution rebuilt; absent for a console Fixture.
   */
  readonly smokeTest?: SmokeTest;
}

/**
 * Whether a GUI Fixture's rebuilt app launched: on Windows, it `stayed-alive`
 * (passed), or it `exited` or `did-not-start` (failed); anywhere else it is
 * not launched, and the Round-trip is `build-only`, saying why.
 */
export type SmokeTest =
  | Launch
  | { readonly outcome: "did-not-start"; readonly message: string }
  | { readonly outcome: "build-only"; readonly reason: string };

export interface RoundTripFailure {
  readonly stage: "reconstruct" | "rebuild";
  readonly message: string;
}

/** One input, run through the original and the rebuilt program. */
export interface RoundTripRun {
  readonly args: readonly string[];
  readonly original: ProgramRun;
  /** What the rebuilt program did, or why it did not run to an exit. */
  readonly rebuilt: ProgramRun | { readonly error: string };
  /** How the rebuilt program behaved differently; empty if it did not. */
  readonly differences: readonly Difference[];
}

export type Difference =
  | {
      readonly kind: "stdout" | "stderr";
      readonly lines: readonly LineDifference[];
    }
  | {
      readonly kind: "exit-code";
      readonly original: number;
      readonly rebuilt: number;
    }
  | {
      /** The rebuilt program could not be started, was killed, or hung. */
      readonly kind: "did-not-exit";
      readonly message: string;
    };

/** A line of output that differs; `undefined` where a program wrote no such line. */
export interface LineDifference {
  /** 1-based. */
  readonly line: number;
  readonly original: string | undefined;
  readonly rebuilt: string | undefined;
}

// Windows can hold freshly built files open for a moment (antivirus, MSBuild).
const REMOVE_FOLDER = { recursive: true, force: true, maxRetries: 5 } as const;
// Per stream, in the report; the result holds them all.
const REPORTED_LINES = 10;
/** The exit code of a Windows .NET program ended by an unhandled exception, as unsigned and signed. */
const UNHANDLED_EXCEPTION_CODES = new Set([0xe0434352, 0xe0434352 - 2 ** 32]);

/**
 * Runs the Round-trip of a Fixture (PRD §10): builds it, reconstructs its
 * Assembly with `reconstruct`, rebuilds the Recovered Solution with
 * `dotnet build`, then runs the original and the rebuilt program over every
 * input in the Fixture's `inputs.json` and compares their stdout, stderr and
 * exit code. Both are run as programs of the Fixture's target framework: a
 * .NET Framework one only on Windows. A GUI Fixture (WinForms, WPF) has no
 * inputs: on every OS its Recovered Solution must rebuild, and on Windows its
 * rebuilt app must then stay alive for `aliveForMs` once launched, before it
 * is closed; anywhere else the Round-trip is build-only, and says so. A
 * Reconstruction that fails or does not rebuild is a failed Round-trip, not
 * an error. Rejects only if the Fixture itself cannot be built or run (on
 * this OS), or `workDirectory` is not empty. {@link formatRoundTrip}
 * explains the result.
 */
export async function roundTrip(
  name: string,
  reconstruct: Reconstruct,
  options: RoundTripOptions = {},
): Promise<RoundTripResult> {
  const original = await buildFixture(name, options);
  const gui = isGuiFixture(original);
  if (!gui && !runsOn(original.targetFramework)) {
    throw new Error(
      `The ${name} Fixture targets ${original.targetFramework}, a .NET Framework program that runs only on Windows, so its Round-trip cannot run on ${process.platform}.`,
    );
  }
  const inputs = gui ? [] : await readFixtureInputs(name, options);
  const runOptions = {
    targetFramework: original.targetFramework,
    ...(options.dotnetPath === undefined
      ? {}
      : { dotnetPath: options.dotnetPath }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  };

  const work = options.workDirectory ?? (await temporaryFolder());
  if (
    options.workDirectory !== undefined &&
    (await readdir(work).catch(() => [])).length > 0
  ) {
    throw new Error(
      `The Round-trip's work directory ${work} must be empty or not exist yet.`,
    );
  }
  try {
    const recovered = join(work, "recovered");
    const rebuilt = join(work, "rebuilt");
    const failed = (stage: RoundTripFailure["stage"], message: string) => ({
      fixture: name,
      passed: false,
      failure: { stage, message },
      runs: [],
    });

    try {
      await reconstruct(original.assemblyPath, recovered);
    } catch (error) {
      return failed("reconstruct", errorMessage(error));
    }
    const solutions = await solutionsIn(recovered);
    if (solutions.length !== 1) {
      return failed(
        "reconstruct",
        `The Recovered Solution in ${recovered} should hold exactly one .sln at its top, but holds ${solutions.length === 0 ? "none" : solutions.join(", ")}.`,
      );
    }

    let rebuiltAssembly: string;
    try {
      rebuiltAssembly = await rebuild(
        options.dotnetPath ?? "dotnet",
        join(recovered, solutions[0] as string),
        rebuilt,
        basename(original.assemblyPath),
      );
    } catch (error) {
      return failed("rebuild", errorMessage(error));
    }

    if (gui) {
      const smokeTest = await smoke(
        rebuiltAssembly,
        original.targetFramework,
        options,
      );
      return {
        fixture: name,
        passed:
          smokeTest.outcome === "stayed-alive" ||
          smokeTest.outcome === "build-only",
        runs: [],
        smokeTest,
      };
    }

    const runs: RoundTripRun[] = [];
    for (const { args } of inputs) {
      const [originalRun, rebuiltRun] = await Promise.all([
        // The original must run: if it cannot, the Fixture is at fault.
        runAssembly(original.assemblyPath, args, runOptions),
        runAssembly(rebuiltAssembly, args, runOptions).catch(
          (error: unknown) => ({ error: errorMessage(error) }),
        ),
      ]);
      runs.push({
        args,
        original: originalRun,
        rebuilt: rebuiltRun,
        differences: compareRuns(originalRun, rebuiltRun),
      });
    }
    return {
      fixture: name,
      passed: runs.every(({ differences }) => differences.length === 0),
      runs,
    };
  } finally {
    if (options.workDirectory === undefined) {
      // Best effort: a file another process still holds open is left behind.
      await rm(work, REMOVE_FOLDER).catch(() => undefined);
    }
  }
}

/**
 * Launches a GUI Fixture's rebuilt app on Windows, the only OS WinForms and
 * WPF run on; anywhere else, says why it is not launched.
 */
async function smoke(
  assemblyPath: string,
  targetFramework: string,
  options: RoundTripOptions,
): Promise<SmokeTest> {
  if (process.platform !== "win32") {
    return {
      outcome: "build-only",
      reason: `a GUI Fixture is launched only on Windows, and this is ${process.platform}`,
    };
  }
  try {
    return await launchAssembly(assemblyPath, [], {
      targetFramework,
      ...(options.dotnetPath === undefined
        ? {}
        : { dotnetPath: options.dotnetPath }),
      ...(options.aliveForMs === undefined
        ? {}
        : { aliveForMs: options.aliveForMs }),
    });
  } catch (error) {
    return { outcome: "did-not-start", message: errorMessage(error) };
  }
}

/** How the rebuilt program's run differs from the original's. */
export function compareRuns(
  original: ProgramRun,
  rebuilt: ProgramRun | { readonly error: string },
): Difference[] {
  if ("error" in rebuilt) {
    return [{ kind: "did-not-exit", message: rebuilt.error }];
  }
  const differences: Difference[] = [];
  for (const kind of ["stdout", "stderr"] as const) {
    const lines = compareLines(original[kind], rebuilt[kind]);
    if (lines.length > 0) {
      differences.push({ kind, lines });
    }
  }
  if (original.exitCode !== rebuilt.exitCode) {
    differences.push({
      kind: "exit-code",
      original: original.exitCode,
      rebuilt: rebuilt.exitCode,
    });
  }
  return differences;
}

/**
 * The result of a Round-trip, for people: whether it passed and, if not, the
 * stage it stopped at, each input that behaved differently, line by line, or
 * how a GUI Fixture's rebuilt app did not stay alive.
 */
export function formatRoundTrip(result: RoundTripResult): string {
  const title = `Round-trip of the ${result.fixture} Fixture`;
  if (result.failure !== undefined) {
    const stopped =
      result.failure.stage === "reconstruct"
        ? "the Reconstruction failed"
        : "the Recovered Solution did not rebuild";
    return `${title} FAILED: ${stopped}.\n${result.failure.message}`;
  }
  if (result.smokeTest !== undefined) {
    return `${title} ${formatSmokeTest(result.smokeTest)}`;
  }

  const total = result.runs.length;
  const differing = result.runs.filter(
    ({ differences }) => differences.length > 0,
  );
  if (differing.length === 0) {
    return total === 0
      ? `${title} passed: the Recovered Solution rebuilt; the Fixture has no inputs to run.`
      : `${title} passed: all ${total} inputs behaved identically.`;
  }

  const report = [
    `${title} FAILED: ${differing.length} of ${total} inputs behaved differently.`,
  ];
  for (const run of differing) {
    report.push("", `Given ${formatArgs(run.args)}:`);
    for (const difference of run.differences) {
      report.push(...formatDifference(difference));
    }
  }
  return report.join("\n");
}

async function temporaryFolder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "xray-round-trip-"));
}

async function solutionsIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sln"))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Builds the Recovered Solution and resolves with the rebuilt Assembly: the
 * one file in the build output named as the original Assembly was.
 */
async function rebuild(
  dotnetPath: string,
  solution: string,
  artifacts: string,
  assemblyName: string,
): Promise<string> {
  // A solution cannot report its projects' TargetPath, so look for the Assembly.
  await dotnetBuild(
    dotnetPath,
    [solution, "--configuration", "Release", "--artifacts-path", artifacts],
    "the Recovered Solution",
  );
  const bin = join(artifacts, "bin");
  const output = await readdir(bin, {
    withFileTypes: true,
    recursive: true,
  }).catch(() => []);
  const found = output
    .filter((entry) => entry.isFile() && entry.name === assemblyName)
    .map((entry) => join(entry.parentPath, entry.name));
  if (found.length !== 1) {
    throw new Error(
      `Rebuilding the Recovered Solution should produce one ${assemblyName}, but produced ${found.length === 0 ? "none" : found.join(", ")}.`,
    );
  }
  return found[0] as string;
}

/**
 * The lines that differ, by position. Split on "\n" alone, so a line keeps any
 * "\r" and a final line ending shows as an empty last line: two outputs have
 * no differing lines only if they are identical.
 */
function compareLines(original: string, rebuilt: string): LineDifference[] {
  if (original === rebuilt) {
    return [];
  }
  const before = original.split("\n");
  const after = rebuilt.split("\n");
  const differences: LineDifference[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) {
      differences.push({
        line: i + 1,
        original: before[i],
        rebuilt: after[i],
      });
    }
  }
  return differences;
}

function formatSmokeTest(smokeTest: SmokeTest): string {
  switch (smokeTest.outcome) {
    case "build-only":
      return `passed, build only: the Recovered Solution rebuilt, and its app was not launched, as ${smokeTest.reason}.`;
    case "stayed-alive":
      return `passed: the Recovered Solution rebuilt, and its app stayed alive for ${seconds(smokeTest.aliveForMs)} once launched, then was closed.`;
    case "did-not-start":
      return `FAILED: the rebuilt app could not be launched.\n${smokeTest.message}`;
    case "exited": {
      const { exitCode, signal, afterMs, aliveForMs } = smokeTest;
      const how =
        exitCode === null
          ? `it was ended by ${signal}`
          : UNHANDLED_EXCEPTION_CODES.has(exitCode)
            ? `it crashed with 0x${(exitCode >>> 0).toString(16).toUpperCase()}, as .NET ends a program that throws an unhandled exception`
            : exitCode === 0
              ? "it exited by itself, with exit code 0"
              : `it crashed with exit code ${exitCode}`;
      const report = [
        `FAILED: the rebuilt app did not stay alive for ${seconds(aliveForMs)}: ${seconds(afterMs)} after it was launched, ${how}.`,
      ];
      for (const stream of ["stdout", "stderr"] as const) {
        if (smokeTest[stream] !== "") {
          const lines = smokeTest[stream].replace(/\r?\n$/, "").split(/\r?\n/);
          report.push(
            "",
            `It wrote to ${stream}:`,
            ...lines
              .slice(0, REPORTED_LINES)
              .map((line) => (line === "" ? "" : `  ${line}`)),
            ...(lines.length > REPORTED_LINES
              ? [`  ...and ${lines.length - REPORTED_LINES} more lines.`]
              : []),
          );
        }
      }
      return report.join("\n");
    }
  }
}

/** A time to a tenth of a second, `5 s`, `1.5 s`, or under a second as `40 ms`. */
function seconds(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${Math.round(ms / 100) / 10} s`;
}

function formatDifference(difference: Difference): string[] {
  switch (difference.kind) {
    case "stdout":
    case "stderr": {
      const { kind, lines } = difference;
      const shown = lines
        .slice(0, REPORTED_LINES)
        .flatMap((line) => [
          `  ${kind} line ${line.line}:`,
          `    original: ${formatLine(line.original)}`,
          `    rebuilt:  ${formatLine(line.rebuilt)}`,
        ]);
      const more = lines.length - REPORTED_LINES;
      return more > 0
        ? [...shown, `  ...and ${more} more differing ${kind} lines.`]
        : shown;
    }
    case "exit-code":
      return [
        `  exit code: original ${difference.original}, rebuilt ${difference.rebuilt}`,
      ];
    case "did-not-exit":
      return [
        `  the rebuilt program did not exit normally: ${difference.message}`,
      ];
  }
}

/** Quoted, so whitespace and "\r" show. */
function formatLine(line: string | undefined): string {
  return line === undefined ? "(no such line)" : JSON.stringify(line);
}

function formatArgs(args: readonly string[]): string {
  if (args.length === 0) {
    return "no arguments";
  }
  return args
    .map((arg) => (/^[\w.+-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
