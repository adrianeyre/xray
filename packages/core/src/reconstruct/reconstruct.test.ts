import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { EngineError } from "../engine/engine-error.js";
import { InputError } from "../input/input-error.js";
import type { AssemblySummary } from "../inspect/assembly-summary.js";
import type { ProgressEvent } from "./progress.js";
import {
  reconstruct,
  type Reconstruction,
  type ReconstructOptions,
} from "./reconstruct.js";
import { ReconstructionError } from "./reconstruction-error.js";
import {
  toXrayReport,
  type AcceptedReconstruction,
  type XrayReport,
} from "./xray-report.js";

// The engine is a Node script run in place of `dotnet Xray.Engine.dll` that
// answers by file name alone (../engine/fakes/decompiles.mjs), so the input
// paths need not exist. The C# it answers with is real: `dotnet build` builds it.
// nuget.org is a stand-in that has no packages, so nothing goes over the network.

const BUILD_TIMEOUT_MS = 5 * 60_000;

/** nuget.org, as a stand-in holding no packages, recording each URL it is asked for. */
const nugetOrgAsked: string[] = [];
const noPackages: typeof globalThis.fetch = (input) => {
  const url = String(input);
  nugetOrgAsked.push(url);
  return Promise.resolve(
    url === "https://api.nuget.test/v3/index.json"
      ? Response.json({
          resources: [
            {
              "@id": "https://api.nuget.test/flat/",
              "@type": "PackageBaseAddress/3.0.0",
            },
          ],
        })
      : new Response(null, { status: 404 }),
  );
};

const fakeEngine: ReconstructOptions = {
  dotnetPath: process.execPath,
  enginePath: fileURLToPath(
    new URL("../engine/fakes/decompiles.mjs", import.meta.url),
  ),
  buildDotnetPath: "dotnet",
  nugetOrg: {
    serviceIndex: "https://api.nuget.test/v3/index.json",
    fetch: noPackages,
  },
};

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
  temporary.push(folder);
  return folder;
}

/** The `xray-report.json` written into `folder`. */
async function reportIn(folder: string): Promise<XrayReport> {
  return JSON.parse(
    await readFile(join(folder, "xray-report.json"), "utf8"),
  ) as XrayReport;
}

/** Holds the report written to the one a Reconstruction gives, and its timings to sense. */
async function expectReportOf(reconstruction: Reconstruction): Promise<void> {
  expect(reconstruction.accepted).toBe(true);
  const accepted = reconstruction as AcceptedReconstruction;
  expect(await reportIn(accepted.solution.directory)).toEqual(
    toXrayReport(accepted),
  );
  const {
    analyse,
    decompile,
    resolveDependencies,
    generate,
    build,
    run,
    total,
  } = accepted.timings;
  for (const stage of [
    analyse,
    decompile,
    resolveDependencies ?? 0,
    generate,
    build ?? 0,
    run ?? 0,
  ]) {
    expect(Number.isInteger(stage)).toBe(true);
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(stage).toBeLessThanOrEqual(total);
  }
  expect(build === null).toBe(accepted.build === null);
  expect(run === null).toBe(
    accepted.run === null || accepted.run.status === "skipped",
  );
}

interface Heard {
  readonly event: ProgressEvent;
  /** When it arrived, by `performance.now()`. */
  readonly at: number;
}

/** Options that record each progress event, and when it arrived, in `heard`. */
function listening(options: ReconstructOptions = fakeEngine): {
  readonly options: ReconstructOptions;
  readonly heard: Heard[];
} {
  const heard: Heard[] = [];
  return {
    options: {
      ...options,
      onProgress: (event) => heard.push({ event, at: performance.now() }),
    },
    heard,
  };
}

/** Each event but `stage-progress`, as `kind stage`. */
function outline(heard: readonly Heard[]): string[] {
  return heard
    .filter(({ event }) => event.kind !== "stage-progress")
    .map(({ event }) => `${event.kind} ${event.stage}`);
}

/** The most milliseconds that passed between one event and the next. */
function longestSilence(heard: readonly Heard[]): number {
  return Math.max(
    ...heard.slice(1).map(({ at }, i) => at - (heard[i]?.at ?? at)),
  );
}

/** Holds each stage's `stage-finished` to the time the report records for it. */
function expectDurationsOf(
  heard: readonly Heard[],
  reconstruction: Reconstruction,
): void {
  const { timings } = reconstruction as AcceptedReconstruction;
  const finished = Object.fromEntries(
    heard.flatMap(({ event }) =>
      event.kind === "stage-finished" ? [[event.stage, event.durationMs]] : [],
    ),
  );
  expect(finished).toEqual({
    analyse: timings.analyse,
    decompile: timings.decompile,
    ...(timings.resolveDependencies === null
      ? {}
      : { "resolve-dependencies": timings.resolveDependencies }),
    generate: timings.generate,
    ...(timings.build === null ? {} : { build: timings.build }),
    ...(timings.run === null ? {} : { run: timings.run }),
  });
  const last = heard.at(-1)?.event.elapsedMs ?? Infinity;
  expect(last).toBeLessThanOrEqual(timings.total);
}

/** Every file under `folder`, relative, with `/` between segments, leaving out build output. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .filter((path) => !/(^|\/)(bin|obj)\//.test(path))
    .sort();
}

describe("reconstruct", () => {
  it(
    "writes a solution, an SDK-style project and a file per type in a folder per namespace, then builds it",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct("app.dll", output, fakeEngine);

      expect(reconstruction).toMatchObject({
        accepted: true,
        classification: { kind: "managed-assembly" },
        summary: { assembly: { name: "App" } },
        solution: {
          directory: output,
          solutionPath: "App.sln",
          projectPath: "App/App.csproj",
          targetFramework: "net8.0",
          outputType: "Exe",
          reportPath: "xray-report.json",
          typeCount: 5,
        },
        build: { succeeded: true },
        outcome: "full",
        reasons: [],
      });
      const expected = [
        "App.sln",
        "App/App.csproj",
        "App/GlobalHelper.cs",
        "App/Models/Point-2.cs",
        "App/Models/Point.cs",
        "App/Program.cs",
        "App/Properties/AssemblyInfo.cs",
        "App/Tools/Text/Shouter.cs",
        "xray-report.json",
      ];
      expect(await filesUnder(output)).toEqual(expected);
      expect(
        reconstruction.accepted && [...reconstruction.solution.files].sort(),
      ).toEqual(expected);
      expect(
        await readFile(join(output, "App", "Models", "Point-2.cs"), "utf8"),
      ).toContain("internal sealed class Point<T>");
      expect(
        await readFile(join(output, "App", "App.csproj"), "utf8"),
      ).toContain("<TargetFramework>net8.0</TargetFramework>");

      // Built beside its projects, as it would be for anyone who opened it.
      const built = join(output, "App", "bin", "Debug", "net8.0", "App.dll");
      expect(existsSync(built)).toBe(true);
      const { stdout } = await promisify(execFile)("dotnet", [built], {
        env: { ...process.env, DOTNET_ROLL_FORWARD: "Major" },
      });
      expect(stdout.trim()).toBe("POINT { X = 1, Y = 2 }342!");

      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        schemaVersion: 1,
        outcome: "full",
        inputs: { path: resolve("app.dll"), options: { build: true } },
        inspect: { assembly: { name: "App" } },
        build: { succeeded: true },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "decompiles with the Assembly's own PDB beside it, laying each file out at its original path, and builds it",
    async () => {
      const input = await folderOf("pdb.dll", "pdb.pdb");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        join(input, "pdb.dll"),
        output,
        fakeEngine,
      );

      const pdb = {
        status: "matching",
        path: join(input, "pdb.pdb"),
        format: "portable",
      };
      expect(reconstruction).toMatchObject({
        summary: { pdb },
        solution: {
          typeCount: 5,
          sourceFileCount: 4,
          projects: [{ typeCount: 5, sourceFileCount: 4, pdb }],
        },
        build: { succeeded: true },
        outcome: "full",
        warnings: [],
      });
      expect(await filesUnder(output)).toEqual([
        "App.sln",
        "App/App.csproj",
        "App/Geometry/Points.cs",
        "App/GlobalHelper.cs",
        "App/Program.cs",
        "App/Properties/AssemblyInfo.cs",
        "App/Text/Shouter.cs",
        "xray-report.json",
      ]);
      await expectReportOf(reconstruction);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "ignores another build's PDB beside the Assembly, with a warning, and lays files out by namespace",
    async () => {
      const input = await folderOf("stale-pdb.dll", "stale-pdb.pdb");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        join(input, "stale-pdb.dll"),
        output,
        { ...fakeEngine, build: false },
      );

      const pdb = {
        status: "mismatched",
        path: join(input, "stale-pdb.pdb"),
        format: "portable",
        reason:
          "stale-pdb.pdb, a portable PDB, is not stale-pdb.dll's own: its ID is not the one stale-pdb.dll records, so it is another build's.",
      };
      expect(reconstruction).toMatchObject({
        summary: { pdb },
        solution: {
          typeCount: 5,
          sourceFileCount: 5,
          projects: [{ pdb }],
        },
        warnings: [
          {
            kind: "pdb-ignored",
            assemblyPath: join(input, "stale-pdb.dll"),
            pdbPath: join(input, "stale-pdb.pdb"),
            message: `Ignored the PDB beside stale-pdb.dll, ${join(input, "stale-pdb.pdb")}. ${pdb.reason} So App's local variables are named, and its source files laid out, as without a PDB.`,
          },
        ],
      });
      expect(await filesUnder(output)).toContain("App/Tools/Text/Shouter.cs");
      await expectReportOf(reconstruction);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "names the file of a type that declares file-scoped types after the file they were declared in, so it builds",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        "file-scoped.dll",
        output,
        fakeEngine,
      );

      expect(reconstruction).toMatchObject({
        solution: { typeCount: 5 },
        build: { succeeded: true },
        outcome: "full",
      });
      const files = await filesUnder(output);
      expect(files).toContain("App/Tools/Text/Shouting.cs");
      expect(files).not.toContain("App/Tools/Text/Shouter.cs");
      expect(
        await readFile(
          join(output, "App", "Tools", "Text", "Shouting.cs"),
          "utf8",
        ),
      ).toContain("file static class Bang");
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "reports each stage as it starts and finishes, and its progress at least once a second while it runs",
    async () => {
      const output = join(await scratch(), "out");
      const { options, heard } = listening();

      const reconstruction = await reconstruct("app.dll", output, options);

      expect(reconstruction).toMatchObject({ outcome: "full" });
      expect(outline(heard)).toEqual([
        "stage-started analyse",
        "stage-finished analyse",
        "stage-started decompile",
        "stage-finished decompile",
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
        "stage-started generate",
        "stage-finished generate",
        "stage-started build",
        "stage-finished build",
        "stage-skipped run",
      ]);
      // Running it executes recovered code, so it is not run unless asked.
      expect(heard.at(-1)?.event).toEqual({
        kind: "stage-skipped",
        stage: "run",
        elapsedMs: expect.any(Number) as unknown,
        reason:
          "Running the rebuilt program executes recovered code, so it is run only when asked.",
      });
      expect(reconstruction).toMatchObject({ run: null });
      // `dotnet build` takes seconds, and says nothing until it is done.
      const build = heard.filter(
        ({ event }) =>
          event.kind === "stage-progress" && event.stage === "build",
      );
      expect(build.length).toBeGreaterThan(1);
      expect(build[0]?.event).toMatchObject({
        done: null,
        total: null,
        current: null,
      });
      expect(longestSilence(heard)).toBeLessThan(1_000);
      expectDurationsOf(heard, reconstruction);
      for (const { event } of heard) {
        expect(JSON.parse(JSON.stringify(event))).toEqual(event);
      }
    },
    BUILD_TIMEOUT_MS,
  );

  it("reports which type it is decompiling, of how many, as the engine streams it", async () => {
    const output = join(await scratch(), "out");
    const { options, heard } = listening({ ...fakeEngine, build: false });

    const reconstruction = await reconstruct("slow.dll", output, options);

    const decompile = heard.filter(
      ({ event }) =>
        event.kind === "stage-progress" && event.stage === "decompile",
    );
    // 600 ms over each of five types, reported every 250 ms.
    expect(decompile.length).toBeGreaterThanOrEqual(10);
    const reported = decompile.map(({ event }) =>
      event.kind === "stage-progress"
        ? `${event.done}/${event.total} ${event.current}`
        : "",
    );
    // Each type in turn, in order; perhaps nothing yet before the engine's
    // first progress line, and perhaps all done while the engine stops.
    expect([...new Set(reported)]).toEqual(
      expect.arrayContaining([
        "0/5 App.Program",
        "1/5 App.Models.Point",
        "2/5 App.Models.Point`1",
        "3/5 Tools.Text.Shouter",
        "4/5 GlobalHelper",
      ]) as unknown,
    );
    expect(
      reported.filter((each) => !["null/null null", "5/5 null"].includes(each)),
    ).toEqual(reported.filter((each) => /^[0-4]\/5 /.test(each)).sort());
    expect(longestSilence(heard)).toBeLessThan(1_000);
    expect(outline(heard).slice(-6)).toEqual([
      "stage-started resolve-dependencies",
      "stage-finished resolve-dependencies",
      "stage-started generate",
      "stage-finished generate",
      "stage-skipped build",
      "stage-skipped run",
    ]);
    expect(heard.at(-2)?.event).toMatchObject({
      reason:
        "Building was skipped, so the Recovered Solution is not verified.",
    });
    expectDurationsOf(heard, reconstruction);
  });

  it("reports the stage that failed, with the error the Reconstruction rejects with", async () => {
    const { options, heard } = listening();

    const error: unknown = await reconstruct(
      "undecompilable.dll",
      join(await scratch(), "out"),
      options,
    ).catch((caught: unknown) => caught);

    expect(outline(heard)).toEqual([
      "stage-started analyse",
      "stage-finished analyse",
      "stage-started decompile",
      "stage-failed decompile",
    ]);
    expect(heard.at(-1)?.event).toMatchObject({
      message: (error as Error).message,
    });
  });

  it("reports only analysing input that is not a Managed Assembly", async () => {
    const { options, heard } = listening();
    const inspected: AssemblySummary[] = [];

    await reconstruct("native.exe", join(await scratch(), "out"), {
      ...options,
      onInspected: (summary) => inspected.push(summary),
    });

    expect(outline(heard)).toEqual([
      "stage-started analyse",
      "stage-finished analyse",
    ]);
    expect(inspected).toEqual([]);
  });

  it("tells of the Assembly's metadata summary once analyse has read it, before it finishes", async () => {
    const { options, heard } = listening({ ...fakeEngine, build: false });
    const inspected: { summary: AssemblySummary; after: string[] }[] = [];

    const reconstruction = await reconstruct(
      "app.dll",
      join(await scratch(), "out"),
      {
        ...options,
        onInspected: (summary) =>
          inspected.push({ summary, after: outline(heard) }),
      },
    );

    expect(reconstruction.accepted).toBe(true);
    expect(inspected).toEqual([
      {
        summary: (reconstruction as AcceptedReconstruction).summary,
        after: ["stage-started analyse"],
      },
    ]);
    expect(inspected[0]?.summary).toMatchObject({
      path: resolve("app.dll"),
      assembly: { name: "App" },
    });
  });

  it(
    "is a Partial Reconstruction when the Recovered Solution does not build, giving each error at its file and line",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        "broken.dll",
        output,
        fakeEngine,
      );

      // The missing semicolon ends the line holding `+ "!"` in Shouter.cs.
      const shouter = (
        await readFile(
          join(output, "App", "Tools", "Text", "Shouter.cs"),
          "utf8",
        )
      ).split("\n");
      const line = shouter.findIndex((text) => text.endsWith('+ "!"')) + 1;
      const error = {
        severity: "error",
        code: "CS1002",
        message: "; expected",
        file: "App/Tools/Text/Shouter.cs",
        line,
        column: (shouter[line - 1] ?? "").length + 1,
        project: "App/App.csproj",
      };
      expect(line).toBeGreaterThan(0);
      expect(reconstruction).toMatchObject({
        accepted: true,
        build: { succeeded: false, diagnostics: [error] },
        outcome: "partial",
        reasons: [{ kind: "build-failed", errors: [error] }],
      });
      expect(reconstruction.accepted && reconstruction.build?.output).toMatch(
        /Shouter\.cs\(\d+,\d+\): error CS1002: ; expected/,
      );

      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        outcome: "partial",
        reasons: [{ kind: "build-failed", errors: [error] }],
        build: { succeeded: false, diagnostics: [error] },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it("writes the Recovered Solution but does not build it when building is skipped", async () => {
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct("broken.dll", output, {
      ...fakeEngine,
      build: false,
      // Would fail the test if it were run.
      buildDotnetPath: join(output, "no-such-dotnet"),
    });

    expect(reconstruction).toMatchObject({
      accepted: true,
      build: null,
      outcome: "unverified",
      reasons: [],
    });
    expect(await filesUnder(output)).toContain("App/Tools/Text/Shouter.cs");
    expect(existsSync(join(output, "App", "obj"))).toBe(false);
    expect(existsSync(join(output, "App", "bin"))).toBe(false);

    await expectReportOf(reconstruction);
    expect(await reportIn(output)).toMatchObject({
      outcome: "unverified",
      inputs: { options: { build: false, run: false } },
      build: null,
      run: null,
      timings: { build: null, run: null },
    });
  });

  it("does not accept input that is not a Managed Assembly, and writes nothing", async () => {
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct("native.exe", output, fakeEngine);

    expect(reconstruction).toMatchObject({
      accepted: false,
      classification: { kind: "native-executable", accepted: false },
    });
    expect(existsSync(output)).toBe(false);
  });

  it("refuses an output directory that is not empty, leaving it as it was", async () => {
    const output = await scratch();
    await writeFile(join(output, "keep.txt"), "mine");

    await expect(reconstruct("app.dll", output, fakeEngine)).rejects.toThrow(
      new ReconstructionError(
        "output-not-empty",
        `${output} is not empty. Choose an empty or new folder, or pass --force to replace what is in it.`,
      ),
    );
    expect(await readdir(output)).toEqual(["keep.txt"]);
  });

  it(
    "replaces what an output directory holds when forced",
    async () => {
      const output = await scratch();
      await mkdir(join(output, "Old", "App"), { recursive: true });
      await writeFile(join(output, "Old", "App", "Stale.cs"), "class Stale {");
      await writeFile(join(output, "keep.txt"), "mine");

      const reconstruction = await reconstruct("app.dll", output, {
        ...fakeEngine,
        force: true,
      });

      expect(reconstruction).toMatchObject({ outcome: "full" });
      expect(await readdir(output)).toEqual([
        "App",
        "App.sln",
        "xray-report.json",
      ]);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "reconstructs an Assembly from before TargetFrameworkAttribute for the framework its CLR and references tell, net35, warning that it is supported on a best-effort basis",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        "legacy.dll",
        output,
        fakeEngine,
      );

      expect(reconstruction).toMatchObject({
        summary: {
          targetFramework: {
            moniker: "net35",
            frameworkName: null,
            runtimeVersion: "v2.0.50727",
            inferredFrom:
              "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
            support: "best-effort",
          },
        },
        solution: {
          targetFramework: "net35",
          outputType: "Library",
          projects: [{ projectPath: "Legacy/Legacy.csproj" }],
        },
        build: { succeeded: true },
        outcome: "full",
        warnings: [
          {
            kind: "best-effort-target-framework",
            assemblyPath: resolve("legacy.dll"),
            message:
              "legacy.dll targets net35, which Xray supports only on a best-effort basis, not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later: Legacy's project targets it as it is, but it is less certain to build and behave like the original. It records no TargetFrameworkAttribute, as nothing built before .NET Framework 4.0 does, so net35 was told from CLR v2.0.50727 and its reference to System.Core 3.5.0.0.",
          },
        ],
      });
      const project = await readFile(
        join(output, "Legacy", "Legacy.csproj"),
        "utf8",
      );
      expect(project).toContain("<TargetFramework>net35</TargetFramework>");
      expect(project).toContain(
        '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies"',
      );
      await expectReportOf(reconstruction);
    },
    BUILD_TIMEOUT_MS,
  );

  it("reports an Assembly whose target framework cannot be told", async () => {
    const output = join(await scratch(), "out");

    const error: unknown = await reconstruct(
      "no-framework.dll",
      output,
      fakeEngine,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReconstructionError);
    expect(error).toMatchObject({
      code: "unknown-target-framework",
      message: expect.stringMatching(
        /^Cannot tell which framework .*no-framework\.dll targets: it has no TargetFrameworkAttribute\.$/,
      ) as unknown,
    });
    expect(existsSync(output)).toBe(false);
  });

  it("reports a file that is not there as an InputError", async () => {
    await expect(
      reconstruct("missing.dll", join(await scratch(), "out"), fakeEngine),
    ).rejects.toBeInstanceOf(InputError);
  });

  it("reports a type the engine could not decompile", async () => {
    const output = join(await scratch(), "out");

    await expect(
      reconstruct("undecompilable.dll", output, fakeEngine),
    ).rejects.toMatchObject({
      code: "request-failed",
      engineCode: "decompilation-failed",
      message:
        'The Xray engine could not run "decompile": Could not decompile App.Program: boom',
    });
    expect(existsSync(output)).toBe(false);
  });

  it.each(["odd.dll", "odd-source-file.dll", "unsaid.dll"])(
    "reports a malformed answer to decompile, for %s, as a protocol violation",
    async (file) => {
      const error: unknown = await reconstruct(
        file,
        join(await scratch(), "out"),
        fakeEngine,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(EngineError);
      expect(error).toMatchObject({ code: "protocol-violation" });
    },
  );
});

/** The OS this runs on, as a reason to skip running a program names it. */
const OS =
  ({ darwin: "macOS", linux: "Linux" } as Record<string, string>)[
    process.platform
  ] ?? process.platform;

/** A folder holding an (empty) file of each name, for the fake engine to answer for by name. */
async function folderOf(...names: string[]): Promise<string> {
  const folder = await scratch();
  await Promise.all(names.map((name) => writeFile(join(folder, name), "")));
  return folder;
}

describe("reconstruct, with resources", () => {
  it(
    "recovers each resource under its logical name, the satellite assemblies' beside the Assembly's, and builds them, warning of the one kept as it is and the one not recovered",
    async () => {
      const input = await folderOf("resources.dll");
      for (const culture of ["de", "es", "fr"]) {
        await mkdir(join(input, culture));
        await writeFile(join(input, culture, "App.resources.dll"), "");
      }
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        join(input, "resources.dll"),
        output,
        fakeEngine,
      );

      expect(reconstruction).toMatchObject({
        outcome: "full",
        build: { succeeded: true },
      });
      const accepted = reconstruction as AcceptedReconstruction;
      expect(accepted.solution.projects[0]?.resources).toEqual([
        {
          name: "App.Strings.resources",
          culture: null,
          public: true,
          recoveredAs: "resx",
          path: "App/Strings.resx",
          reason: null,
        },
        {
          name: "App.Program.resources",
          culture: null,
          public: true,
          recoveredAs: "resx",
          path: "App/Program.resx",
          reason: null,
        },
        {
          name: "App.Limits.resources",
          culture: null,
          public: true,
          recoveredAs: "file",
          path: "App/Limits.resources",
          reason:
            'Its entry "Max" is a System.Int32, not a string, a byte[] or a stream.',
        },
        {
          name: "App.Models.logo.png",
          culture: null,
          public: true,
          recoveredAs: "file",
          path: "App/Models/logo.png",
          reason: null,
        },
        {
          name: "secret",
          culture: null,
          public: false,
          recoveredAs: "file",
          path: "App/secret",
          reason: null,
        },
        {
          name: "jquery.min.js",
          culture: null,
          public: true,
          recoveredAs: "file",
          path: "App/jquery_min.js",
          reason: null,
        },
        {
          name: "App.Template.cs",
          culture: null,
          public: true,
          recoveredAs: "file",
          path: "App/Template.cs",
          reason: null,
        },
        {
          name: "App.Linked.txt",
          culture: null,
          public: true,
          recoveredAs: "not-recovered",
          path: null,
          reason:
            "It is not embedded in the Assembly, but in the file Linked.txt, which Xray does not recover, so the rebuilt Assembly has no resource of that name.",
        },
        {
          name: "App.Strings.de.resources",
          culture: "de",
          public: true,
          recoveredAs: "resx",
          path: "App/Strings.de.resx",
          reason: null,
        },
        {
          name: "App.Strings.fr.resources",
          culture: "fr",
          public: true,
          recoveredAs: "resx",
          path: "App/Strings.fr.resx",
          reason: null,
        },
        {
          name: "App.notes.txt",
          culture: "fr",
          public: true,
          recoveredAs: "file",
          path: "App/notes.fr.txt",
          reason: null,
        },
      ]);
      expect(
        (await filesUnder(output)).filter(
          (file) => !/\/(bin|obj)\//.test(file),
        ),
      ).toEqual([
        "App.sln",
        "App/App.csproj",
        "App/GlobalHelper.cs",
        "App/Limits.resources",
        "App/Models/Point-2.cs",
        "App/Models/Point.cs",
        "App/Models/logo.png",
        "App/Program.cs",
        "App/Program.resx",
        "App/Program/Logo.png",
        "App/Program/Note.txt",
        "App/Properties/AssemblyInfo.cs",
        "App/Strings.de.resx",
        "App/Strings.fr.resx",
        "App/Strings.resx",
        "App/Template.cs",
        "App/Tools/Text/Shouter.cs",
        "App/jquery_min.js",
        "App/notes.fr.txt",
        "App/secret",
        "xray-report.json",
      ]);
      // As the engine gave them, byte for byte.
      expect(await readFile(join(output, "App", "secret"), "utf8")).toBe(
        "swordfish",
      );
      expect(
        await readFile(join(output, "App", "Program", "Note.txt"), "utf8"),
      ).toBe("A note.\n");
      const project = await readFile(join(output, "App", "App.csproj"), "utf8");
      expect(project).toContain(
        "    <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>\n",
      );
      expect(project).toContain(
        '    <EmbeddedResource Include="secret" LogicalName="secret" Access="Private" />\n',
      );
      expect(project).toContain('    <Compile Remove="Template.cs" />\n');
      // The build made a satellite assembly for each culture.
      const built = (await filesUnder(join(output, "App", "bin"))).filter(
        (file) => file.endsWith(".resources.dll"),
      );
      expect(built.map((file) => file.split("/").at(-2))).toEqual(["de", "fr"]);
      expect(
        accepted.warnings.map(({ kind, assemblyPath, message }) => ({
          kind,
          assemblyPath,
          message,
        })),
      ).toEqual([
        {
          kind: "resource-kept-as-is",
          assemblyPath: join(input, "resources.dll"),
          message:
            'App.Limits.resources, a resource of resources.dll, is embedded as it is, as App/Limits.resources, rather than written as a .resx. Its entry "Max" is a System.Int32, not a string, a byte[] or a stream. A .resx the .NET SDK builds holds only strings, and byte[]s and streams in files it refers to, without System.Resources.Extensions; the rebuilt Assembly holds this resource byte for byte all the same.',
        },
        {
          kind: "resource-not-recovered",
          assemblyPath: join(input, "resources.dll"),
          message:
            "App.Linked.txt, a resource of resources.dll, was not recovered. It is not embedded in the Assembly, but in the file Linked.txt, which Xray does not recover, so the rebuilt Assembly has no resource of that name.",
        },
      ]);
      await expectReportOf(reconstruction);
    },
    BUILD_TIMEOUT_MS,
  );

  it("has no resources for an Assembly with none, nor any satellite assembly", async () => {
    const input = await folderOf("app.dll");
    await mkdir(join(input, "fr"));
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(join(input, "app.dll"), output, {
      ...fakeEngine,
      build: false,
    });

    expect(reconstruction).toMatchObject({
      solution: { projects: [{ resources: [] }] },
      warnings: [],
    });
    expect(
      await readFile(join(output, "App", "App.csproj"), "utf8"),
    ).not.toContain("EmbeddedResource");
  });
});

// Off Windows only: Windows has the frameworks Windows Forms is part of, so
// nothing more is looked for (reference-packs.test.ts holds that).
describe.skipIf(process.platform === "win32")(
  "reconstruct, of an Assembly using Windows Forms, off Windows",
  () => {
    /** A global-packages folder holding `versions` of the Windows Desktop framework's targeting pack. */
    async function cacheHolding(...versions: string[]): Promise<string> {
      const root = await scratch();
      for (const version of versions) {
        const pack = join(root, "microsoft.windowsdesktop.app.ref", version);
        await mkdir(join(pack, "ref", "net8.0"), { recursive: true });
        await writeFile(join(pack, ".nupkg.metadata"), "{}");
        await writeFile(
          join(pack, "ref", "net8.0", "System.Windows.Forms.dll"),
          "a reference assembly",
        );
        // Listing it, as the pack's own list does.
        await mkdir(join(pack, "data"));
        await writeFile(
          join(pack, "data", "FrameworkList.xml"),
          '<FileList><File Type="Managed" Path="ref/net8.0/System.Windows.Forms.dll" AssemblyName="System.Windows.Forms" PublicKeyToken="b77a5c561934e089" AssemblyVersion="8.0.0.0" /></FileList>',
        );
      }
      return root;
    }

    /** The folders the fake engine was asked to find Greeter's references in, as its code says. */
    async function askedToLookIn(output: string): Promise<unknown> {
      const code = await readFile(
        join(output, "Greeter", "Program.cs"),
        "utf8",
      );
      return JSON.parse(
        /^\/\/ referenceDirectories: (.*)$/m.exec(code)?.[1] ?? "undefined",
      );
    }

    it("decompiles it with the reference assemblies of the Windows Desktop framework for its version, from the global-packages folder, asking nuget.org nothing", async () => {
      const cache = await cacheHolding("7.0.20", "8.0.4", "8.0.31");
      const output = join(await scratch(), "out");
      nugetOrgAsked.length = 0;

      const reconstruction = await reconstruct("greeter.dll", output, {
        ...fakeEngine,
        globalPackagesFolder: cache,
        build: false,
      });

      expect(await askedToLookIn(output)).toEqual([
        join(
          cache,
          "microsoft.windowsdesktop.app.ref",
          "8.0.31",
          "ref",
          "net8.0",
        ),
      ]);
      expect(nugetOrgAsked).toEqual([]);
      expect(reconstruction).toMatchObject({
        accepted: true,
        solution: {
          targetFramework: "net8.0-windows7.0",
          outputType: "WinExe",
        },
        warnings: [],
      });
      expect(
        await readFile(join(output, "Greeter", "Greeter.csproj"), "utf8"),
      ).toContain("<UseWindowsForms>true</UseWindowsForms>");
    });

    it.each([
      [
        "offline",
        { offline: true },
        "Microsoft.WindowsDesktop.App.Ref 8.0.x is not in the global-packages folder, and nuget.org was not asked, as Xray is offline",
      ],
      [
        "where nuget.org has it not",
        {},
        "Microsoft.WindowsDesktop.App.Ref 8.0.x is not in the global-packages folder, nor on nuget.org",
      ],
    ])(
      "decompiles it without them %s, where the global-packages folder has them not, and warns of it",
      async (_, options, why) => {
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct("greeter.dll", output, {
          ...fakeEngine,
          ...options,
          globalPackagesFolder: await cacheHolding("9.0.0"),
          build: false,
        });

        expect(await askedToLookIn(output)).toBeNull();
        const os = process.platform === "darwin" ? "macOS" : "Linux";
        const warning = {
          kind: "reference-assemblies-not-found",
          assemblyPath: resolve("greeter.dll"),
          message: `greeter.dll was decompiled without the reference assemblies of Windows Forms for .NET 8.0, which ${os} does not have: ${why}. Code using them may be decompiled less precisely, so its project may not build or behave like the original: a call to a method of their base classes may call the override itself.`,
        };
        expect(reconstruction).toMatchObject({ warnings: [warning] });
        await expectReportOf(reconstruction);
        expect(await reportIn(output)).toMatchObject({ warnings: [warning] });
      },
    );
  },
);

describe("reconstruct, of a WPF app", () => {
  it("splits its WPF resources back into its XAML files, each beside its code-behind as Visual Studio lays it out, in the case another file refers to it by, and the files they held, listing each for the markup compiler in a project using WPF", async () => {
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct("tints.dll", output, {
      ...fakeEngine,
      build: false,
    });

    expect(reconstruction).toMatchObject({
      accepted: true,
      solution: { targetFramework: "net8.0-windows7.0", outputType: "WinExe" },
    });
    expect(await filesUnder(output)).toEqual([
      "Tints.sln",
      "Tints/App.xaml",
      "Tints/App.xaml.cs",
      "Tints/Images/Logo.png",
      "Tints/Properties/AssemblyInfo.cs",
      "Tints/Strings.resx",
      "Tints/Themes/Colors.xaml",
      "Tints/Tints.csproj",
      "Tints/Views/MainWindow.xaml",
      "Tints/Views/MainWindow.xaml.cs",
      "xray-report.json",
    ]);
    expect(await readFile(join(output, "Tints", "App.xaml"), "utf8")).toMatch(
      /^<Application x:Class="Tints\.App" .* StartupUri="Views\/MainWindow\.xaml">\n/,
    );
    expect(
      await readFile(
        join(output, "Tints", "Views", "MainWindow.xaml.cs"),
        "utf8",
      ),
    ).toContain("public partial class MainWindow : Window\n");
    expect(await readFile(join(output, "Tints", "Images", "Logo.png"))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    );
    const project = await readFile(
      join(output, "Tints", "Tints.csproj"),
      "utf8",
    );
    expect(project).toContain("    <UseWPF>true</UseWPF>\n");
    expect(project).toContain(
      "    <EnableDefaultPageItems>false</EnableDefaultPageItems>\n    <EnableDefaultApplicationDefinition>false</EnableDefaultApplicationDefinition>\n",
    );
    expect(project).toContain(
      [
        '    <ApplicationDefinition Include="App.xaml" />',
        '    <Page Include="Themes\\Colors.xaml" />',
        '    <Page Include="Views\\MainWindow.xaml" />',
        "  </ItemGroup>",
        "",
        "  <ItemGroup>",
        "    <!-- The files the original's WPF resources held beside its BAML, which the build puts back beside it. -->",
        '    <Resource Include="Images\\Logo.png" />',
      ].join("\n"),
    );
    // The markup compiler builds the WPF resources again; the .resx is embedded as ever.
    expect(project).not.toContain("Tints.g.resources");
    expect(project).toContain(
      '<EmbeddedResource Include="Strings.resx" LogicalName="Tints.Strings.resources" />',
    );
    const accepted = reconstruction as AcceptedReconstruction;
    expect(accepted.solution.projects[0]?.resources).toEqual([
      {
        name: "Tints.g.resources",
        culture: null,
        public: true,
        recoveredAs: "xaml",
        path: null,
        reason: null,
      },
      {
        name: "Tints.Strings.resources",
        culture: null,
        public: true,
        recoveredAs: "resx",
        path: "Tints/Strings.resx",
        reason: null,
      },
    ]);
    expect(
      accepted.warnings.filter(({ kind }) => kind === "xaml-not-recovered"),
    ).toEqual([]);
    await expectReportOf(reconstruction);
  });

  it("embeds its WPF resources as the BAML they are where the engine could not decompile it, and warns of it", async () => {
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct("tints-undecompiled.dll", output, {
      ...fakeEngine,
      build: false,
    });

    const warning = {
      kind: "xaml-not-recovered",
      assemblyPath: resolve("tints-undecompiled.dll"),
      message:
        'The WPF resources of tints-undecompiled.dll were not recovered as XAML: Tints.g.resources\'s BAML was not decompiled. Its entry "app.baml" could not be decompiled: boom. It is embedded as it is, and the classes it names keep the code the markup compiler generated of their XAML, which loads it; but the project has no XAML to change.',
    };
    expect(reconstruction).toMatchObject({
      accepted: true,
      warnings: expect.arrayContaining([warning]) as unknown,
    });
    const accepted = reconstruction as AcceptedReconstruction;
    expect(accepted.solution.projects[0]?.resources[0]).toMatchObject({
      name: "Tints.g.resources",
      recoveredAs: "resx",
    });
    const project = await readFile(
      join(output, "Tints", "Tints.csproj"),
      "utf8",
    );
    expect(project).toContain("<UseWPF>true</UseWPF>");
    expect(project).not.toContain("<Page ");
    expect(project).toContain('LogicalName="Tints.g.resources"');
    await expectReportOf(reconstruction);
    expect(await reportIn(output)).toMatchObject({
      warnings: expect.arrayContaining([warning]) as unknown,
    });
  });
});

describe("reconstruct, with Sibling Assemblies", () => {
  it(
    "reconstructs each Sibling Assembly it references into a project of its own, wired with ProjectReference, and builds them all",
    async () => {
      // System.Runtime.dll is beside it, as in a self-contained app, but is
      // Microsoft's: the fake engine has no answer for it, so asking would fail.
      const input = await folderOf(
        "shop.dll",
        "stock.dll",
        "prices.dll",
        "system.runtime.dll",
        "unreferenced.dll",
      );
      const output = join(await scratch(), "out");
      const { options, heard } = listening();

      const reconstruction = await reconstruct(
        join(input, "shop.dll"),
        output,
        options,
      );

      expect(reconstruction).toMatchObject({
        solution: {
          solutionPath: "Shop.sln",
          projectPath: "Shop/Shop.csproj",
          typeCount: 1,
          projects: [
            {
              assemblyPath: join(input, "shop.dll"),
              assemblyName: "Shop",
              projectPath: "Shop/Shop.csproj",
              targetFramework: "net8.0",
              outputType: "Exe",
              typeCount: 1,
              projectReferences: ["Prices/Prices.csproj", "Stock/Stock.csproj"],
            },
            {
              assemblyPath: join(input, "prices.dll"),
              assemblyName: "Prices",
              projectPath: "Prices/Prices.csproj",
              outputType: "Library",
              projectReferences: ["Stock/Stock.csproj"],
            },
            {
              assemblyPath: join(input, "stock.dll"),
              assemblyName: "Stock",
              projectPath: "Stock/Stock.csproj",
              outputType: "Library",
              projectReferences: [],
            },
          ],
        },
        build: { succeeded: true },
        outcome: "full",
        siblings: true,
        siblingProblems: [],
      });
      expect(await filesUnder(output)).toEqual([
        "Prices/Pricer.cs",
        "Prices/Prices.csproj",
        "Prices/Properties/AssemblyInfo.cs",
        "Shop.sln",
        "Shop/Program.cs",
        "Shop/Properties/AssemblyInfo.cs",
        "Shop/Shop.csproj",
        "Stock/Properties/AssemblyInfo.cs",
        "Stock/Shelf.cs",
        "Stock/Stock.csproj",
        "xray-report.json",
      ]);
      expect(
        await readFile(join(output, "Shop", "Shop.csproj"), "utf8"),
      ).toContain(
        [
          "  <ItemGroup>",
          "    <!-- Sibling Assemblies, each recovered as a project of its own. -->",
          '    <ProjectReference Include="..\\Prices\\Prices.csproj" />',
          '    <ProjectReference Include="..\\Stock\\Stock.csproj" />',
          "  </ItemGroup>",
        ].join("\n"),
      );
      const solution = await readFile(join(output, "Shop.sln"), "utf8");
      for (const project of ["Shop\\Shop", "Prices\\Prices", "Stock\\Stock"]) {
        expect(solution).toContain(`"${project}.csproj"`);
      }

      const built = join(output, "Shop", "bin", "Debug", "net8.0", "Shop.dll");
      const { stdout } = await promisify(execFile)("dotnet", [built], {
        env: { ...process.env, DOTNET_ROLL_FORWARD: "Major" },
      });
      expect(stdout.trim()).toBe("11.5");

      // Found, then reconstructed, one by one, in resolve-dependencies.
      expect(outline(heard).slice(4, 6)).toEqual([
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
      ]);
      expect(
        heard.flatMap(({ event }) =>
          event.kind === "stage-progress" &&
          event.stage === "resolve-dependencies" &&
          event.current !== null
            ? [`${event.done}/${event.total} ${event.current}`]
            : [],
        ),
      ).toEqual(
        expect.not.arrayContaining([
          expect.stringMatching(/system\.runtime/i),
        ]) as unknown,
      );
      expectDurationsOf(heard, reconstruction);
      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        inputs: { options: { siblings: true } },
        siblingProblems: [],
        solution: {
          projects: [
            { projectPath: "Shop/Shop.csproj" },
            { projectPath: "Prices/Prices.csproj" },
            { projectPath: "Stock/Stock.csproj" },
          ],
        },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it("copies the Assemblies beside it into Dependencies, referenced with a HintPath, with siblings off (--no-siblings)", async () => {
    const input = await folderOf("shop.dll", "stock.dll", "prices.dll");
    await writeFile(join(input, "prices.dll"), "the Prices binary");
    const output = join(await scratch(), "out");
    const { options, heard } = listening({
      ...fakeEngine,
      siblings: false,
      build: false,
    });

    const reconstruction = await reconstruct(
      join(input, "shop.dll"),
      output,
      options,
    );

    expect(reconstruction).toMatchObject({
      solution: {
        projects: [
          {
            projectPath: "Shop/Shop.csproj",
            projectReferences: [],
            binaryReferences: [
              "Dependencies/prices.dll",
              "Dependencies/stock.dll",
            ],
          },
        ],
      },
      outcome: "unverified",
      reasons: [],
      siblings: false,
    });
    expect(
      reconstruction.accepted && reconstruction.solution.projects,
    ).toHaveLength(1);
    expect(await filesUnder(output)).toEqual([
      "Dependencies/prices.dll",
      "Dependencies/stock.dll",
      "Shop.sln",
      "Shop/Program.cs",
      "Shop/Properties/AssemblyInfo.cs",
      "Shop/Shop.csproj",
      "xray-report.json",
    ]);
    expect(
      await readFile(join(output, "Dependencies", "prices.dll"), "utf8"),
    ).toBe("the Prices binary");
    expect(
      await readFile(join(output, "Shop", "Shop.csproj"), "utf8"),
    ).toContain(
      [
        "  <ItemGroup>",
        "    <!-- Binaries found beside the original, copied into Dependencies and referenced as they are. -->",
        '    <Reference Include="Prices">',
        "      <HintPath>..\\Dependencies\\prices.dll</HintPath>",
        "    </Reference>",
        '    <Reference Include="Stock">',
        "      <HintPath>..\\Dependencies\\stock.dll</HintPath>",
        "    </Reference>",
        "  </ItemGroup>",
      ].join("\n"),
    );
    // Still run, to look the references up as NuGet packages: none holds them.
    expect(heard.map(({ event }) => event)).toContainEqual({
      kind: "stage-finished",
      stage: "resolve-dependencies",
      elapsedMs: expect.any(Number) as unknown,
      durationMs: expect.any(Number) as unknown,
    });
    expect(
      reconstruction.accepted &&
        reconstruction.packages.map(({ reference, package: found }) => [
          reference.name,
          found,
        ]),
    ).toEqual([
      ["Prices", null],
      ["Stock", null],
    ]);
    expect(
      reconstruction.accepted &&
        reconstruction.dependencies.map(
          ({ reference, resolution, copiedTo, path }) => [
            reference.name,
            resolution,
            copiedTo,
            path,
          ],
        ),
    ).toEqual([
      [
        "Prices",
        "copied-binary",
        "Dependencies/prices.dll",
        join(input, "prices.dll"),
      ],
      [
        "Stock",
        "copied-binary",
        "Dependencies/stock.dll",
        join(input, "stock.dll"),
      ],
      ["System.Console", "framework", null, null],
      ["System.Runtime", "framework", null, null],
    ]);
    await expectReportOf(reconstruction);
    expect(await reportIn(output)).toMatchObject({
      inputs: { options: { siblings: false } },
      solution: {
        files: expect.arrayContaining([
          "Dependencies/prices.dll",
          "Dependencies/stock.dll",
        ]) as unknown,
      },
    });
  });

  it("copies a third party's Assembly beside it, strong-named with another key, into Dependencies, and reconstructs its own as a Sibling Assembly", async () => {
    const input = await folderOf("till.dll", "stock.dll", "receipts.dll");
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(join(input, "till.dll"), output, {
      ...fakeEngine,
      build: false,
    });

    expect(reconstruction).toMatchObject({
      solution: {
        projects: [
          {
            assemblyName: "Till",
            projectReferences: ["Stock/Stock.csproj"],
            binaryReferences: ["Dependencies/receipts.dll"],
          },
          {
            assemblyName: "Stock",
            projectReferences: [],
            binaryReferences: [],
            resources: [],
          },
        ],
      },
      outcome: "unverified",
      // In the order the summary lists references: by name.
      dependencies: [
        {
          reference: { name: "Receipts", publicKeyToken: "51ca75d1f3633191" },
          referencedBy: ["Till"],
          resolution: "copied-binary",
          package: null,
          projectPath: null,
          copiedTo: "Dependencies/receipts.dll",
          path: join(input, "receipts.dll"),
          reason: `No NuGet package was found to hold it. ${join(input, "receipts.dll")}, beside the input, is strong-named with a key (public key token 51ca75d1f3633191), so it is a third party's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath.`,
        },
        {
          reference: { name: "Stock" },
          referencedBy: ["Till"],
          resolution: "sibling-assembly",
          package: null,
          projectPath: "Stock/Stock.csproj",
          copiedTo: null,
          path: join(input, "stock.dll"),
        },
        {
          reference: { name: "System.Runtime" },
          referencedBy: ["Till", "Stock"],
          resolution: "framework",
        },
      ],
    });
    expect(
      reconstruction.accepted && reconstruction.solution.projects,
    ).toHaveLength(2);
    expect(existsSync(join(output, "Dependencies", "receipts.dll"))).toBe(true);
    await expectReportOf(reconstruction);
  });

  it("makes each reference nothing beside it satisfies an Unresolved Dependency, a Partial Reconstruction even unbuilt, naming each", async () => {
    const input = await folderOf("shop.dll");
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(join(input, "shop.dll"), output, {
      ...fakeEngine,
      build: false,
    });

    const unresolved = (name: string) => ({
      reference: {
        name,
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      referencedBy: ["Shop"],
      resolution: "unresolved",
      package: null,
      projectPath: null,
      copiedTo: null,
      path: null,
      reason: `${name} is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of ${name} 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named ${name} is beside the input to reconstruct or copy, so nothing satisfies it.`,
    });
    expect(reconstruction).toMatchObject({
      outcome: "partial",
      reasons: [
        {
          kind: "unresolved-dependencies",
          dependencies: [unresolved("Prices"), unresolved("Stock")],
        },
      ],
      build: null,
    });
    // Its Recovered Solution is written all the same.
    expect(await filesUnder(output)).toEqual([
      "Shop.sln",
      "Shop/Program.cs",
      "Shop/Properties/AssemblyInfo.cs",
      "Shop/Shop.csproj",
      "xray-report.json",
    ]);
    await expectReportOf(reconstruction);
    expect(await reportIn(output)).toMatchObject({
      outcome: "partial",
      reasons: [{ kind: "unresolved-dependencies" }],
    });
  });

  it("reports Assemblies that reference one another in a cycle, leaving out the reference that closes it, and carries on", async () => {
    const input = await folderOf("loop.dll", "ring.dll");
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(join(input, "loop.dll"), output, {
      ...fakeEngine,
      build: false,
    });

    const message =
      "Loop references Ring references Loop, a cycle projects cannot have. The reference from Ring to Loop is left out, so Ring does not build.";
    expect(reconstruction).toMatchObject({
      outcome: "unverified",
      solution: {
        projects: [
          { assemblyName: "Loop", projectReferences: ["Ring/Ring.csproj"] },
          { assemblyName: "Ring", projectReferences: [] },
        ],
      },
      siblingProblems: [
        {
          kind: "cyclic-reference",
          cycle: ["Loop", "Ring", "Loop"],
          omitted: { from: "Ring", to: "Loop" },
          message,
        },
      ],
    });
    expect(
      await readFile(join(output, "Ring", "Ring.csproj"), "utf8"),
    ).not.toContain("ProjectReference");
    await expectReportOf(reconstruction);
    expect(await reportIn(output)).toMatchObject({
      siblingProblems: [{ kind: "cyclic-reference", message }],
    });
  });

  it("reports two Assemblies of the name a reference asks for, reconstructing the .dll, and skips a file of that name that is not a Managed Assembly", async () => {
    const input = await folderOf(
      "twin.dll",
      "pair.dll",
      "pair.exe",
      "helper.dll",
    );
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(join(input, "twin.dll"), output, {
      ...fakeEngine,
      build: false,
    });

    expect(reconstruction).toMatchObject({
      solution: {
        projects: [
          { assemblyName: "Twin", projectReferences: ["Pair/Pair.csproj"] },
          { assemblyName: "Pair", assemblyPath: join(input, "pair.dll") },
        ],
      },
      siblingProblems: [
        {
          kind: "duplicate-assembly-name",
          name: "Pair",
          paths: [join(input, "pair.dll"), join(input, "pair.exe")],
          chosen: join(input, "pair.dll"),
          message: `2 Assemblies beside the input are named Pair: ${join(input, "pair.dll")}, ${join(input, "pair.exe")}. Only ${join(input, "pair.dll")} is reconstructed, as the runtime would load it.`,
        },
      ],
    });
    expect(
      reconstruction.accepted && reconstruction.solution.projects,
    ).toHaveLength(2);
    await expectReportOf(reconstruction);
  });

  it("reconstructs a folder from its application's Assembly, with the Sibling Assemblies beside it", async () => {
    const input = await folderOf(
      "shop.dll",
      "shop.runtimeconfig.json",
      "stock.dll",
      "prices.dll",
    );
    const output = join(await scratch(), "out");

    const reconstruction = await reconstruct(input, output, {
      ...fakeEngine,
      build: false,
    });

    expect(reconstruction).toMatchObject({
      summary: { path: join(input, "shop.dll") },
      solution: {
        solutionPath: "Shop.sln",
        projects: [
          { assemblyName: "Shop" },
          { assemblyName: "Prices" },
          { assemblyName: "Stock" },
        ],
      },
    });
    expect(await reportIn(output)).toMatchObject({
      inputs: { path: join(input, "shop.dll") },
    });
  });

  it("reports a folder that does not say which Assembly to reconstruct, or holds none, writing nothing", async () => {
    const several = await folderOf("shop.dll", "stock.dll", "prices.dll");
    const none = await folderOf("readme.txt", "notes.md");
    const output = join(await scratch(), "out");
    const { options, heard } = listening();

    const ambiguous: unknown = await reconstruct(
      several,
      output,
      options,
    ).catch((error: unknown) => error);
    const empty: unknown = await reconstruct(none, output, fakeEngine).catch(
      (error: unknown) => error,
    );

    expect(ambiguous).toBeInstanceOf(InputError);
    expect(ambiguous).toMatchObject({
      code: "assembly-not-chosen",
      message: `${several} is a folder with 3 .exe and .dll files in it, and nothing in it says which is the application's; give the path of the one to reconstruct: prices.dll, shop.dll, stock.dll.`,
    });
    expect(outline(heard)).toEqual([
      "stage-started analyse",
      "stage-failed analyse",
    ]);
    expect(empty).toBeInstanceOf(InputError);
    expect(empty).toMatchObject({
      code: "no-assembly-in-folder",
      message: `${none} is a folder with no .exe or .dll file in it to reconstruct; give the path of an Assembly, or of the folder holding one.`,
    });
    expect(existsSync(output)).toBe(false);
  });
});

describe("reconstruct, asked to run the rebuilt program", () => {
  const running: ReconstructOptions = { ...fakeEngine, run: true };

  it(
    "runs it once it builds, recording its exit code and output",
    async () => {
      const output = join(await scratch(), "out");
      const { options, heard } = listening(running);

      const reconstruction = await reconstruct("app.dll", output, options);

      const run = {
        status: "exited",
        reason: null,
        program: "App/bin/Debug/net8.0/App.dll",
        exitCode: 0,
        stdout: expect.stringMatching(
          /^POINT \{ X = 1, Y = 2 \}342!\r?\n$/,
        ) as unknown,
        stderr: "",
      };
      expect(reconstruction).toMatchObject({
        build: { succeeded: true },
        run,
        outcome: "full",
        reasons: [],
      });
      expect(outline(heard).slice(-3)).toEqual([
        "stage-finished build",
        "stage-started run",
        "stage-finished run",
      ]);
      expect(
        heard.some(
          ({ event }) =>
            event.kind === "stage-progress" &&
            event.stage === "run" &&
            event.current === "App/bin/Debug/net8.0/App.dll",
        ) ||
          // A program this quick may be done before the first progress.
          heard.filter(({ event }) => event.stage === "run").length === 2,
      ).toBe(true);
      expectDurationsOf(heard, reconstruction);
      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        outcome: "full",
        inputs: { options: { build: true, run: true } },
        run,
        timings: { run: expect.any(Number) as unknown },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "is a Partial Reconstruction when the rebuilt program crashes",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct("crashes.dll", output, running);

      expect(reconstruction).toMatchObject({
        build: { succeeded: true },
        run: { status: "crashed", program: "App/bin/Debug/net8.0/App.dll" },
        outcome: "partial",
        reasons: [{ kind: "run-failed" }],
      });
      const run = reconstruction.accepted ? reconstruction.run : null;
      expect(run?.reason).toMatch(
        /as \.NET ends a program that throws an unhandled exception\.$/,
      );
      expect(run?.stderr).toContain(
        "Unhandled exception. System.InvalidOperationException: boom",
      );
      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        outcome: "partial",
        reasons: [{ kind: "run-failed" }],
        run: { status: "crashed" },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "is a Partial Reconstruction when the rebuilt program does not exit in time, and stops it",
    async () => {
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct("hangs.dll", output, {
        ...running,
        runTimeoutMs: 2_000,
      });

      expect(reconstruction).toMatchObject({
        run: {
          status: "timed-out",
          reason: "It did not exit within 2000 ms, so it was stopped.",
          exitCode: null,
        },
        outcome: "partial",
        reasons: [{ kind: "run-failed" }],
      });
      await expectReportOf(reconstruction);
    },
    BUILD_TIMEOUT_MS,
  );

  it.skipIf(process.platform === "win32")(
    "skips running a WinForms program anywhere but Windows, saying why, without counting it against the Reconstruction",
    async () => {
      const output = join(await scratch(), "out");
      const { options, heard } = listening(running);

      const reconstruction = await reconstruct("winforms.dll", output, options);

      const reason = `It is a WinForms program, and WinForms runs only on Windows, not on ${OS}.`;
      expect(reconstruction).toMatchObject({
        summary: { outputKind: "winforms" },
        solution: { outputType: "WinExe" },
        build: { succeeded: true },
        run: {
          status: "skipped",
          reason,
          program: null,
          exitCode: null,
          stdout: null,
          stderr: null,
        },
        outcome: "full",
        reasons: [],
      });
      expect(heard.at(-1)?.event).toEqual({
        kind: "stage-skipped",
        stage: "run",
        elapsedMs: expect.any(Number) as unknown,
        reason,
      });
      await expectReportOf(reconstruction);
      expect(await reportIn(output)).toMatchObject({
        outcome: "full",
        inputs: { options: { run: true } },
        run: { status: "skipped", reason },
        timings: { run: null },
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it.runIf(process.platform === "win32")(
    "runs a WinForms program on Windows, as a GUI program",
    async () => {
      const reconstruction = await reconstruct(
        "winforms.dll",
        join(await scratch(), "out"),
        running,
      );

      // Its code is the console program's, so it exits on its own.
      expect(reconstruction).toMatchObject({
        run: { status: "exited", exitCode: 0 },
        outcome: "full",
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "does not run a Recovered Solution that did not build",
    async () => {
      const reconstruction = await reconstruct(
        "broken.dll",
        join(await scratch(), "out"),
        running,
      );

      expect(reconstruction).toMatchObject({
        run: {
          status: "skipped",
          reason:
            "The Recovered Solution did not build, so there is no rebuilt program to run.",
        },
        outcome: "partial",
        reasons: [{ kind: "build-failed" }],
      });
    },
    BUILD_TIMEOUT_MS,
  );

  it("does not run a Recovered Solution that was not built", async () => {
    const reconstruction = await reconstruct(
      "app.dll",
      join(await scratch(), "out"),
      { ...running, build: false },
    );

    expect(reconstruction).toMatchObject({
      build: null,
      run: {
        status: "skipped",
        reason:
          "The Recovered Solution was not built, so there is no rebuilt program to run.",
      },
      outcome: "unverified",
    });
  });
});

describe("reconstruct, stopped by its signal", () => {
  /**
   * Options that abort with `reason` as soon as `stage` starts, recording
   * each event in `heard`, and when the abort was, in `abortedAt`.
   */
  function stoppingAt(
    stage: ProgressEvent["stage"],
    reason: Error,
    options: ReconstructOptions = fakeEngine,
  ): {
    readonly options: ReconstructOptions;
    readonly heard: Heard[];
    readonly abortedAt: () => number;
  } {
    const controller = new AbortController();
    const heard: Heard[] = [];
    let abortedAt = Infinity;
    return {
      options: {
        ...options,
        signal: controller.signal,
        onProgress: (event) => {
          heard.push({ event, at: performance.now() });
          if (event.kind === "stage-started" && event.stage === stage) {
            abortedAt = performance.now();
            controller.abort(reason);
          }
        },
      },
      heard,
      abortedAt: () => abortedAt,
    };
  }

  it("does not start once its signal is aborted", async () => {
    const output = join(await scratch(), "out");
    const reason = new Error("Stopped before it started.");
    const { options, heard } = listening();

    await expect(
      reconstruct("app.dll", output, {
        ...options,
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(heard).toEqual([]);
    expect(existsSync(output)).toBe(false);
  });

  it("stops the engine at once while it decompiles, failing that stage with the signal's reason", async () => {
    const output = join(await scratch(), "out");
    const reason = new Error("Xray is stopping.");
    // Decompiling slow.dll would take 3 s.
    const { options, heard, abortedAt } = stoppingAt("decompile", reason, {
      ...fakeEngine,
      build: false,
    });

    await expect(reconstruct("slow.dll", output, options)).rejects.toBe(reason);

    expect(performance.now() - abortedAt()).toBeLessThan(1_000);
    expect(outline(heard)).toEqual([
      "stage-started analyse",
      "stage-finished analyse",
      "stage-started decompile",
      "stage-failed decompile",
    ]);
    expect(heard.at(-1)?.event).toMatchObject({ message: "Xray is stopping." });
    expect(existsSync(output)).toBe(false);
  });

  it(
    "stops `dotnet build`, writing no report",
    async () => {
      const output = join(await scratch(), "out");
      const reason = new Error("Xray is stopping.");
      const { options, heard } = stoppingAt("build", reason);

      await expect(reconstruct("app.dll", output, options)).rejects.toBe(
        reason,
      );

      expect(outline(heard).slice(-2)).toEqual([
        "stage-started build",
        "stage-failed build",
      ]);
      expect(heard.at(-1)?.event).toMatchObject({
        message: "Xray is stopping.",
      });
      expect(existsSync(join(output, "xray-report.json"))).toBe(false);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "stops the rebuilt program it is running",
    async () => {
      const output = join(await scratch(), "out");
      const reason = new Error("Xray is stopping.");
      // The program hangs.dll rebuilds to never exits by itself.
      const { options, heard, abortedAt } = stoppingAt("run", reason, {
        ...fakeEngine,
        run: true,
      });

      await expect(reconstruct("hangs.dll", output, options)).rejects.toBe(
        reason,
      );

      expect(performance.now() - abortedAt()).toBeLessThan(5_000);
      expect(outline(heard).slice(-2)).toEqual([
        "stage-started run",
        "stage-failed run",
      ]);
      expect(existsSync(join(output, "xray-report.json"))).toBe(false);
    },
    BUILD_TIMEOUT_MS,
  );
});
