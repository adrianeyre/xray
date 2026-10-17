import { describe, expect, it } from "vitest";

import {
  formatBenchmark,
  longestSilence,
  missedTargets,
  PROGRESS_TARGET_MS,
  RECONSTRUCTION_TARGET_MS,
  type Machine,
  type TimedReconstruction,
} from "./benchmark.js";

const machine: Machine = {
  cpu: "Example CPU @ 3.0GHz",
  logicalProcessors: 8,
  memoryGiB: 16,
  os: "linux 6.8.0 x64",
  node: "v26.10.0",
  dotnetSdk: "8.0.425",
};

function timed(
  overrides: Partial<TimedReconstruction> = {},
): TimedReconstruction {
  return {
    assemblyPath: "/fixtures/Ledgerworks.dll",
    assemblyBytes: 5_775_872,
    pdb: true,
    typeCount: 2042,
    sourceFileCount: 1642,
    elapsedMs: 8_421,
    timings: {
      analyse: 238,
      decompile: 7_960,
      resolveDependencies: 19,
      generate: 143,
      build: null,
      run: null,
      total: 8_400,
    },
    progressEvents: 40,
    longestSilenceMs: 254,
    ...overrides,
  };
}

describe("longestSilence", () => {
  it("is the longest time between the start, each event and the end", () => {
    expect(longestSilence([0, 250, 500, 1_400, 1_650], 1_700)).toBe(900);
  });

  it("counts the time before the first event, and after the last", () => {
    expect(longestSilence([1_200, 1_300], 1_400)).toBe(1_200);
    expect(longestSilence([100, 200], 2_000)).toBe(1_800);
  });

  it("is the whole time when there are no events", () => {
    expect(longestSilence([], 3_000)).toBe(3_000);
  });
});

describe("missedTargets", () => {
  it("misses none for a Reconstruction under 60 s that reported its progress every second", () => {
    expect(missedTargets(timed())).toEqual([]);
    expect(
      missedTargets(
        timed({
          elapsedMs: RECONSTRUCTION_TARGET_MS - 1,
          longestSilenceMs: PROGRESS_TARGET_MS,
        }),
      ),
    ).toEqual([]);
  });

  it("misses the time target at 60 s or more, and the progress target past 1 s without an event", () => {
    expect(
      missedTargets(
        timed({ elapsedMs: RECONSTRUCTION_TARGET_MS, longestSilenceMs: 1_001 }),
      ),
    ).toEqual([
      "It took 60.0 s, not under 60.0 s.",
      "It went 1.0 s without a progress event, more than 1.0 s.",
    ]);
  });
});

describe("formatBenchmark", () => {
  it("says what was timed, on what machine, against which targets, and whether each Round-trip passed", () => {
    const text = formatBenchmark(machine, [
      { ...timed(), roundTrip: "Round-trip passed." },
      {
        ...timed({
          pdb: false,
          sourceFileCount: 2042,
          elapsedMs: 61_000,
          longestSilenceMs: 300,
        }),
        roundTrip: "Round-trip FAILED.",
      },
    ]);

    expect(text.split("\n")).toEqual([
      "## Benchmark: reconstructing the benchmark Fixture without `dotnet build`",
      "",
      "Targets: under 60.0 s, excluding `dotnet build` (PRD §8), with a progress event at least every 1.0 s (FR-19).",
      "",
      "Machine: Example CPU @ 3.0GHz, 8 logical processors, 16 GiB; linux 6.8.0 x64; Node v26.10.0; .NET SDK 8.0.425.",
      "",
      "Assembly: /fixtures/Ledgerworks.dll (5.5 MiB).",
      "",
      "| Assembly | Types | Source files | Total | analyse | decompile | resolve-dependencies | generate | Longest without progress | Targets |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      "| with its PDB | 2042 | 1642 | **8.4 s** | 0.2 s | 8.0 s | 0.0 s | 0.1 s | 0.3 s | met |",
      "| without a PDB | 2042 | 2042 | **61.0 s** | 0.2 s | 8.0 s | 0.0 s | 0.1 s | 0.3 s | MISSED: It took 61.0 s, not under 60.0 s. |",
      "",
      "- With its PDB: Round-trip passed.",
      "- Without a PDB: Round-trip FAILED.",
      "",
    ]);
  });
});
