import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFixture } from "@xray/fixtures";
import { afterEach, describe, expect, it } from "vitest";

import {
  describeMachine,
  missedTargets,
  timeReconstruction,
} from "./benchmark.js";

// These run the real engine, built by the global setup (../engine/build-engine.ts),
// on a real Fixture: the benchmark's own, timed by `pnpm benchmark`, is too
// large for every test run.

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

describe("timeReconstruction (against the real engine)", () => {
  it("times a Reconstruction of the arithmetic Fixture, with its PDB and without building it, within the targets", async () => {
    const { assemblyPath } = await buildFixture("arithmetic");
    const scratch = await mkdtemp(join(tmpdir(), "xray-benchmark-"));
    temporary.push(scratch);
    const output = join(scratch, "out");

    const timed = await timeReconstruction(assemblyPath, output);

    expect(timed).toMatchObject({
      assemblyPath,
      pdb: true,
      typeCount: 1,
      sourceFileCount: 1,
      timings: { build: null, run: null },
    });
    expect(timed.assemblyBytes).toBeGreaterThan(0);
    expect(timed.elapsedMs).toBeGreaterThanOrEqual(timed.timings.total);
    // Every stage starts and finishes or is skipped, at the least.
    expect(timed.progressEvents).toBeGreaterThanOrEqual(10);
    expect(timed.longestSilenceMs).toBeGreaterThan(0);
    expect(missedTargets(timed)).toEqual([]);
    expect(existsSync(join(output, "Arithmetic.sln"))).toBe(true);
    expect(existsSync(join(output, "Arithmetic", "bin"))).toBe(false);
  }, 60_000);
});

describe("describeMachine", () => {
  it("names the CPU, the processors and memory there are, the OS, Node and the .NET SDK", async () => {
    const machine = await describeMachine();

    expect(machine.cpu).not.toBe("");
    expect(machine.logicalProcessors).toBeGreaterThan(0);
    expect(machine.memoryGiB).toBeGreaterThan(0);
    expect(machine.os).toContain(process.platform);
    expect(machine.node).toBe(process.version);
    expect(machine.dotnetSdk).toMatch(/^\d+\.\d+\.\d+/);
  });
});
