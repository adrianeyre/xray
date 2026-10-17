// `pnpm real-app`: the smoke test against a real application. Downloads
// AwsWatchman's released package from nuget.org and checks it is the one
// released, reconstructs its app as `xray reconstruct` does (looking packages
// up on nuget.org, then building the Recovered Solution with `dotnet build`),
// checks the outcome and how each reference was resolved against what is
// expected, then runs the original and the rebuilt app over the same inputs
// and compares what they do. Prints the results as Markdown; `--json <file>`
// writes them as JSON too. Exits 1 if anything was not as expected. Run
// `pnpm build:engine` first.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { runAssembly } from "@xray/fixtures";

import { reconstruct } from "../reconstruct/reconstruct.js";
import {
  REAL_APP,
  checkReconstruction,
  compareAppRuns,
  downloadPackage,
  extractApp,
  formatRealApp,
  realAppInputs,
  realAppPassed,
  summarizeReconstruction,
  writeConfigurations,
  type RealAppResult,
  type RealAppRun,
} from "./real-app.js";

const { values } = parseArgs({ options: { json: { type: "string" } } });

const scratch = await mkdtemp(join(tmpdir(), "xray-real-app-"));
try {
  const original = await extractApp(
    await downloadPackage(),
    join(scratch, "app"),
  );
  const recovered = join(scratch, "recovered");
  const started = performance.now();
  const reconstruction = await reconstruct(original, recovered);
  const elapsedMs = Math.round(performance.now() - started);
  if (!reconstruction.accepted) {
    throw new Error(reconstruction.classification.explanation);
  }

  const runs: RealAppRun[] = [];
  if (reconstruction.build?.succeeded === true) {
    const { directory, projectPath } = reconstruction.solution;
    const rebuilt = await rebuiltAssembly(join(directory, projectPath));
    const configurations = join(scratch, "configurations");
    await writeConfigurations(configurations);
    for (const { args, exitCode } of realAppInputs(configurations)) {
      const before = await runAssembly(original, args);
      const after = await runAssembly(rebuilt, args).catch(
        (error: unknown): { error: string } => ({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      runs.push({
        args,
        expectedExitCode: exitCode,
        original: before,
        rebuilt: after,
        differences: compareAppRuns(before, after),
      });
    }
  }

  const result: RealAppResult = {
    app: REAL_APP,
    reconstruction: summarizeReconstruction(reconstruction, elapsedMs),
    mismatches: checkReconstruction(reconstruction),
    runs,
  };
  process.stdout.write(formatRealApp(result));
  if (values.json !== undefined) {
    await writeFile(values.json, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (!realAppPassed(result)) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * The app `dotnet build` built from the Recovered Solution: the one file
 * named as the original is under the `bin/` of its project, `projectPath`
 * (absolute).
 */
async function rebuiltAssembly(projectPath: string): Promise<string> {
  const bin = join(dirname(projectPath), "bin");
  const found = (await readdir(bin, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile() && entry.name === REAL_APP.assembly)
    .map((entry) => join(entry.parentPath, entry.name));
  if (found.length !== 1) {
    throw new Error(
      `Building the Recovered Solution should produce one ${REAL_APP.assembly} under ${bin}, but produced ${found.length === 0 ? "none" : found.join(", ")}.`,
    );
  }
  return found[0] as string;
}
