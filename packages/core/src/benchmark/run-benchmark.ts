// `pnpm benchmark`: reconstructs the benchmark Fixture's Assembly without
// `dotnet build`, with its PDB and without, timing each against PRD §8's
// target, inside a Round-trip that rebuilds and runs what it recovered, so
// what was timed is shown to be a Full Reconstruction. Prints the results as
// Markdown; `--json <file>` writes them as JSON too. Exits 1 if any missed a
// target or failed its Round-trip. Run `pnpm build:engine` first.
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { formatRoundTrip, roundTrip } from "@xray/fixtures";

import {
  BENCHMARK_FIXTURE,
  describeMachine,
  formatBenchmark,
  missedTargets,
  timeReconstruction,
  type TimedReconstruction,
} from "./benchmark.js";

const { values } = parseArgs({ options: { json: { type: "string" } } });

const scratch = await mkdtemp(join(tmpdir(), "xray-benchmark-"));
try {
  const machine = await describeMachine();
  const runs: (TimedReconstruction & {
    roundTrip: string;
    roundTripPassed: boolean;
  })[] = [];
  for (const pdb of [true, false]) {
    let timed: TimedReconstruction | undefined;
    const result = await roundTrip(
      BENCHMARK_FIXTURE,
      async (assemblyPath, outputDirectory) => {
        timed = await timeReconstruction(
          pdb ? assemblyPath : await withoutPdb(assemblyPath),
          outputDirectory,
        );
      },
    );
    if (timed === undefined) {
      throw new Error(formatRoundTrip(result));
    }
    runs.push({
      ...timed,
      roundTrip: formatRoundTrip(result),
      roundTripPassed: result.passed,
    });
  }

  process.stdout.write(formatBenchmark(machine, runs));
  if (values.json !== undefined) {
    await writeFile(
      values.json,
      `${JSON.stringify({ machine, runs }, null, 2)}\n`,
    );
  }
  if (
    runs.some((run) => !run.roundTripPassed || missedTargets(run).length > 0)
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * A copy of the build output holding the Assembly at `assemblyPath`, but not
 * its PDB, as an Assembly is often given.
 */
async function withoutPdb(assemblyPath: string): Promise<string> {
  const copy = await mkdtemp(join(scratch, "without-pdb-"));
  const built = dirname(assemblyPath);
  for (const entry of await readdir(built, { withFileTypes: true })) {
    if (entry.isFile() && !/\.pdb$/i.test(entry.name)) {
      await copyFile(join(built, entry.name), join(copy, entry.name));
    }
  }
  return join(copy, basename(assemblyPath));
}
