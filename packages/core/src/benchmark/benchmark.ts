// The benchmark of PRD §8: a Reconstruction of an Assembly of about 2,000
// types and 5 MB, the benchmark Fixture's, must finish within 60 s, excluding
// `dotnet build`, reporting its progress at least once a second all the while
// (FR-19). How it is run, and on what, is docs/reference/benchmark.md.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import {
  arch,
  availableParallelism,
  cpus,
  platform,
  release,
  totalmem,
} from "node:os";
import { promisify } from "node:util";

import type { ProgressEvent } from "../reconstruct/progress.js";
import {
  reconstruct,
  type ReconstructOptions,
} from "../reconstruct/reconstruct.js";
import type { ReconstructionTimings } from "../reconstruct/xray-report.js";

/** The Fixture whose Assembly the benchmark reconstructs. */
export const BENCHMARK_FIXTURE = "benchmark";

/** How long the Reconstruction may take, excluding `dotnet build` (PRD §8). */
export const RECONSTRUCTION_TARGET_MS = 60_000;

/** The longest a Reconstruction may go without a progress event (FR-19). */
export const PROGRESS_TARGET_MS = 1_000;

/** One Reconstruction of an Assembly, timed, without `dotnet build`. */
export interface TimedReconstruction {
  /** The Assembly, as given. */
  readonly assemblyPath: string;
  /** Its size, in bytes. */
  readonly assemblyBytes: number;
  /** Whether it was decompiled with its PDB, which was beside it and its own. */
  readonly pdb: boolean;
  /** How many top-level types were decompiled. */
  readonly typeCount: number;
  /** How many source files they were decompiled to. */
  readonly sourceFileCount: number;
  /** From calling `reconstruct` until it resolved, in whole milliseconds. */
  readonly elapsedMs: number;
  /** How long each stage took, as `xray-report.json` gives them. */
  readonly timings: ReconstructionTimings;
  /** How many progress events it reported. */
  readonly progressEvents: number;
  /**
   * The longest it went without a progress event, in whole milliseconds:
   * from its start to the first, between any two, or from the last until it
   * resolved.
   */
  readonly longestSilenceMs: number;
}

/**
 * Reconstructs the Assembly at `assemblyPath` into `outputDirectory` without
 * building it, as the benchmark times it, and with no network calls, so that
 * nuget.org's latency is not timed. Rejects as {@link reconstruct} does, and
 * if the Assembly is not accepted.
 */
export async function timeReconstruction(
  assemblyPath: string,
  outputDirectory: string,
  options: Omit<ReconstructOptions, "build" | "run" | "onProgress"> = {},
): Promise<TimedReconstruction> {
  const times: number[] = [];
  const started = performance.now();
  const reconstruction = await reconstruct(assemblyPath, outputDirectory, {
    offline: true,
    ...options,
    build: false,
    onProgress: (event: ProgressEvent) => times.push(event.elapsedMs),
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (!reconstruction.accepted) {
    throw new Error(reconstruction.classification.explanation);
  }
  const { solution, summary } = reconstruction;
  return {
    assemblyPath,
    assemblyBytes: (await stat(assemblyPath)).size,
    pdb: summary.pdb.status === "matching",
    typeCount: solution.typeCount,
    sourceFileCount: solution.sourceFileCount,
    elapsedMs,
    timings: reconstruction.timings,
    progressEvents: times.length,
    longestSilenceMs: longestSilence(times, elapsedMs),
  };
}

/**
 * The longest time between `0`, each of `times` (milliseconds since the
 * start, in the order they happened) and `end`.
 */
export function longestSilence(times: readonly number[], end: number): number {
  let longest = 0;
  let previous = 0;
  for (const time of [...times, end]) {
    longest = Math.max(longest, time - previous);
    previous = time;
  }
  return longest;
}

/** What a Reconstruction missed of the benchmark's targets; none if it met them all. */
export function missedTargets(run: TimedReconstruction): string[] {
  const missed: string[] = [];
  if (run.elapsedMs >= RECONSTRUCTION_TARGET_MS) {
    missed.push(
      `It took ${seconds(run.elapsedMs)}, not under ${seconds(RECONSTRUCTION_TARGET_MS)}.`,
    );
  }
  if (run.longestSilenceMs > PROGRESS_TARGET_MS) {
    missed.push(
      `It went ${seconds(run.longestSilenceMs)} without a progress event, more than ${seconds(PROGRESS_TARGET_MS)}.`,
    );
  }
  return missed;
}

/** The machine a benchmark ran on, as its results are documented. */
export interface Machine {
  /** The CPU's model, as the OS names it. */
  readonly cpu: string;
  /** How many processors the OS lets Xray use, as the engine counts them too. */
  readonly logicalProcessors: number;
  /** Its memory, in whole gibibytes. */
  readonly memoryGiB: number;
  /** The OS, its release and the CPU's architecture, as Node names them. */
  readonly os: string;
  readonly node: string;
  /** What `dotnet --version` printed: the .NET SDK `dotnet build` would use. */
  readonly dotnetSdk: string;
}

/** The machine this is, running `dotnetPath` for its .NET SDK's version. */
export async function describeMachine(dotnetPath = "dotnet"): Promise<Machine> {
  const { stdout } = await promisify(execFile)(dotnetPath, ["--version"], {
    windowsHide: true,
  });
  return {
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    logicalProcessors: availableParallelism(),
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()} ${arch()}`,
    node: process.version,
    dotnetSdk: stdout.trim(),
  };
}

/** A benchmark's results, for people, as Markdown: the machine, then each Reconstruction against the targets. */
export function formatBenchmark(
  machine: Machine,
  runs: readonly (TimedReconstruction & { readonly roundTrip: string })[],
): string {
  const rows = runs.map((run) => {
    const { analyse, decompile, resolveDependencies, generate } = run.timings;
    const missed = missedTargets(run);
    return `| ${run.pdb ? "with its PDB" : "without a PDB"} | ${run.typeCount} | ${run.sourceFileCount} | **${seconds(run.elapsedMs)}** | ${seconds(analyse)} | ${seconds(decompile)} | ${seconds(resolveDependencies ?? 0)} | ${seconds(generate)} | ${seconds(run.longestSilenceMs)} | ${missed.length === 0 ? "met" : `MISSED: ${missed.join(" ")}`} |`;
  });
  const [first] = runs;
  return [
    `## Benchmark: reconstructing the ${BENCHMARK_FIXTURE} Fixture without \`dotnet build\``,
    "",
    `Targets: under ${seconds(RECONSTRUCTION_TARGET_MS)}, excluding \`dotnet build\` (PRD §8), with a progress event at least every ${seconds(PROGRESS_TARGET_MS)} (FR-19).`,
    "",
    `Machine: ${machine.cpu}, ${machine.logicalProcessors} logical processors, ${machine.memoryGiB} GiB; ${machine.os}; Node ${machine.node}; .NET SDK ${machine.dotnetSdk}.`,
    ...(first === undefined
      ? []
      : [
          "",
          `Assembly: ${first.assemblyPath} (${(first.assemblyBytes / 2 ** 20).toFixed(1)} MiB).`,
        ]),
    "",
    "| Assembly | Types | Source files | Total | analyse | decompile | resolve-dependencies | generate | Longest without progress | Targets |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    ...runs.map(
      (run) =>
        `- ${run.pdb ? "With its PDB" : "Without a PDB"}: ${run.roundTrip}`,
    ),
    "",
  ].join("\n");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
