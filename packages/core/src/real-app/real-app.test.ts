import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProgramRun } from "@xray/fixtures";
import { afterEach, describe, expect, it } from "vitest";

import { zip } from "../reconstruct/fakes/zip.js";
import type { Dependency } from "../reconstruct/sibling-assemblies.js";
import {
  CONFIGURATIONS,
  EXPECTED_RECONSTRUCTION,
  REAL_APP,
  checkPackage,
  checkReconstruction,
  compareAppRuns,
  downloadPackage,
  extractApp,
  formatRealApp,
  packageUrl,
  realAppInputs,
  realAppPassed,
  summarizeReconstruction,
  withoutStackFrames,
  writeConfigurations,
  type AcceptedReconstruction,
  type RealApp,
  type RealAppResult,
  type RealAppRun,
} from "./real-app.js";

// The smoke test itself, which downloads the app and reconstructs it, is
// `pnpm real-app`, run by CI as a job of its own; these test its parts.

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-real-app-"));
  temporary.push(folder);
  return folder;
}

/** {@link REAL_APP}, released in `archive` instead. */
function releasedIn(archive: Buffer): RealApp {
  return {
    ...REAL_APP,
    package: {
      ...REAL_APP.package,
      sha512: createHash("sha512").update(archive).digest("base64"),
    },
  };
}

const PACKAGE = zip({
  "JustEatTakeaway.Watchman.nuspec": "<package />",
  "tools/net8.0/any/Watchman.dll": "the app",
  "tools/net8.0/any/Watchman.Engine.dll": "a Sibling Assembly",
  "tools/net8.0/any/runtimes/win/lib/net8.0/Native.dll": "a runtime's",
  "tools/net6.0/any/Watchman.dll": "another framework's",
});

function dependency(
  name: string,
  resolution: Dependency["resolution"],
): Dependency {
  return {
    reference: {
      name,
      version: "1.0.0.0",
      culture: null,
      publicKeyToken: null,
    },
    referencedBy: ["Watchman"],
    resolution,
    package: null,
    projectPath: null,
    copiedTo: null,
    path: null,
    reason: `${name} was ${resolution}.`,
  };
}

/** A Reconstruction of the real app, as expected, with `overrides`. */
function reconstruction(
  overrides: Partial<AcceptedReconstruction> = {},
): AcceptedReconstruction {
  return {
    accepted: true,
    outcome: "full",
    reasons: [],
    solution: {
      targetFramework: "net8.0",
      projects: [
        { assemblyName: "Watchman", typeCount: 9 },
        { assemblyName: "Watchman.Engine", typeCount: 83 },
      ],
    },
    dependencies: [
      dependency("System.Runtime", "framework"),
      ...Object.entries(EXPECTED_RECONSTRUCTION.dependencies).map(
        ([name, resolution]) => dependency(name, resolution),
      ),
    ],
    timings: {
      analyse: 120,
      decompile: 460,
      resolveDependencies: 32_300,
      generate: 30,
      build: 2_300,
      run: null,
      total: 35_210,
    },
    ...overrides,
  } as unknown as AcceptedReconstruction;
}

const run = (overrides: Partial<ProgramRun> = {}): ProgramRun => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  ...overrides,
});

describe("REAL_APP", () => {
  it("is AwsWatchman 2.0.0, Apache-2.0, as released on nuget.org", () => {
    expect(REAL_APP).toMatchObject({
      name: "AwsWatchman",
      licence: "Apache-2.0",
      package: { id: "JustEatTakeaway.Watchman", version: "2.0.0" },
    });
    expect(packageUrl()).toBe(
      "https://api.nuget.org/v3-flatcontainer/justeattakeaway.watchman/2.0.0/justeattakeaway.watchman.2.0.0.nupkg",
    );
  });

  it("is expected to be a Full Reconstruction with Sibling Assemblies and NuGet packages", () => {
    const resolutions = Object.values(EXPECTED_RECONSTRUCTION.dependencies);

    expect(EXPECTED_RECONSTRUCTION.outcome).toBe("full");
    expect(resolutions).toContain("sibling-assembly");
    expect(resolutions).toContain("nuget-package");
    expect(resolutions).not.toContain("unresolved");
  });
});

describe("downloadPackage and checkPackage", () => {
  it("download the package from nuget.org and accept it if it is the one released", async () => {
    const asked: string[] = [];
    const fetchUrl = (async (url: string) => {
      asked.push(url);
      return new Response(new Uint8Array(PACKAGE));
    }) as typeof fetch;

    const archive = await downloadPackage(releasedIn(PACKAGE), fetchUrl);

    expect(archive.equals(PACKAGE)).toBe(true);
    expect(asked).toEqual([packageUrl()]);
  });

  it("reject a package that is not the one released", async () => {
    const fetchUrl = (async () =>
      new Response(new Uint8Array(PACKAGE))) as unknown as typeof fetch;

    await expect(downloadPackage(REAL_APP, fetchUrl)).rejects.toThrow(
      /JustEatTakeaway\.Watchman 2\.0\.0's package has SHA-512 .*, not JcBoCsf.*, the one released\./,
    );
    expect(() => checkPackage(Buffer.from("tampered"))).toThrow(
      /the one released/,
    );
  });

  it("reject when nuget.org does not serve it", async () => {
    const fetchUrl = (async () =>
      new Response("", {
        status: 404,
        statusText: "Not Found",
      })) as unknown as typeof fetch;

    await expect(downloadPackage(REAL_APP, fetchUrl)).rejects.toThrow(
      `Downloading ${packageUrl()} failed: 404 Not Found.`,
    );
  });
});

describe("extractApp", () => {
  it("writes the app's folder of the package, and nothing else, and resolves with its Assembly", async () => {
    const folder = await scratch();

    const assembly = await extractApp(PACKAGE, folder);

    expect(assembly).toBe(join(folder, "Watchman.dll"));
    expect(await readFile(assembly, "utf8")).toBe("the app");
    expect(
      (await readdir(folder, { recursive: true })).map((path) =>
        path.replaceAll("\\", "/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "Watchman.dll",
        "Watchman.Engine.dll",
        "runtimes/win/lib/net8.0/Native.dll",
      ]),
    );
    expect(await readdir(folder, { recursive: true })).toHaveLength(7);
  });

  it("refuses a path that would leave the folder", async () => {
    const folder = await scratch();
    const archive = zip({
      "tools/net8.0/any/Watchman.dll": "the app",
      "tools/net8.0/any/../../../escaped.dll": "out of place",
    });

    await expect(extractApp(archive, join(folder, "app"))).rejects.toThrow(
      "tools/net8.0/any/../../../escaped.dll, in JustEatTakeaway.Watchman's package, is not a path inside it.",
    );
    for (const path of [
      "tools/net8.0/any/..\\..\\escaped.dll",
      "tools/net8.0/any/C:escaped.dll",
    ]) {
      await expect(
        extractApp(
          zip({ "tools/net8.0/any/Watchman.dll": "the app", [path]: "" }),
          join(folder, "app"),
        ),
      ).rejects.toThrow(
        `${path}, in JustEatTakeaway.Watchman's package, is not a path inside it.`,
      );
    }
  });

  it("rejects a package without the app", async () => {
    const folder = await scratch();

    await expect(
      extractApp(zip({ "tools/net8.0/any/Other.dll": "" }), folder),
    ).rejects.toThrow(
      "JustEatTakeaway.Watchman's package holds no tools/net8.0/any/Watchman.dll.",
    );
  });
});

describe("checkReconstruction", () => {
  it("finds nothing amiss in a Reconstruction as expected", () => {
    expect(checkReconstruction(reconstruction())).toEqual([]);
  });

  it("says why a Partial Reconstruction is not the Full one expected", () => {
    const partial = reconstruction({
      outcome: "partial",
      reasons: [
        {
          kind: "build-failed",
          errors: [
            {
              severity: "error",
              code: "CS0246",
              message: "The type or namespace name 'Amazon' could not be found",
              file: "Watchman.Engine/Alarms.cs",
              line: 12,
            },
          ],
        },
      ],
    });

    expect(checkReconstruction(partial)).toEqual([
      "It was partial, not full. Its build failed: Watchman.Engine/Alarms.cs:12: CS0246 The type or namespace name 'Amazon' could not be found",
    ]);
  });

  it("names each reference resolved otherwise than expected, missing, or unexpected", () => {
    const expected = reconstruction();
    const changed = reconstruction({
      solution: { ...expected.solution, targetFramework: "net6.0" },
      dependencies: [
        ...expected.dependencies
          .filter(({ reference }) => reference.name !== "StructureMap")
          .map((d) =>
            d.reference.name === "AWSSDK.Core"
              ? dependency("AWSSDK.Core", "copied-binary")
              : d,
          ),
        dependency("Polly", "unresolved"),
        dependency("System.Console", "framework"),
      ],
    });

    expect(checkReconstruction(changed)).toEqual([
      "It targets net6.0, not net8.0.",
      "StructureMap was not referenced; nuget-package was expected.",
      "AWSSDK.Core was copied-binary, not nuget-package: AWSSDK.Core was copied-binary.",
      "Polly was unresolved, not framework: Polly was unresolved.",
    ]);
  });
});

describe("realAppInputs and writeConfigurations", () => {
  it("run its usage and argument errors, and validate each configuration folder", async () => {
    const folder = await scratch();
    await writeConfigurations(folder);

    const inputs = realAppInputs(folder);

    expect(inputs.slice(0, 3)).toEqual([
      { args: ["--help"], exitCode: 1 },
      { args: ["--version"], exitCode: 1 },
      { args: ["--ConfigFolder", folder, "--Unknown"], exitCode: 1 },
    ]);
    expect(inputs.slice(3)).toEqual(
      Object.keys(CONFIGURATIONS).map((name) => ({
        args: ["--RunMode", "TestConfig", "--ConfigFolder", join(folder, name)],
        exitCode: name === "valid" ? 0 : 2,
      })),
    );
    expect((await readdir(folder)).sort()).toEqual(
      Object.keys(CONFIGURATIONS).sort(),
    );
    expect(await readdir(join(folder, "no-files"))).toEqual([]);
    expect(
      JSON.parse(
        await readFile(join(folder, "valid", "payments.json"), "utf8"),
      ),
    ).toMatchObject({ Name: "Payments", AlarmNameSuffix: "payments" });
    await expect(
      readFile(join(folder, "malformed", "team.json"), "utf8").then(JSON.parse),
    ).rejects.toThrow(SyntaxError);
  });
});

describe("compareAppRuns", () => {
  it("compares output but for the frames of a stack trace, which name the original's source files", () => {
    const original = run({
      stdout:
        "Error in run : Config must have alerting groups\n   at Watchman.Configuration.Validation.ConfigValidator.Validate(WatchmanConfiguration config) in /_/Watchman.Configuration/Validation/ConfigValidator.cs:line 14\nRun failed\n",
      exitCode: 2,
    });
    const rebuilt = run({
      stdout:
        "Error in run : Config must have alerting groups\n   at Watchman.Configuration.Validation.ConfigValidator.Validate(WatchmanConfiguration config)\r\nRun failed\n",
      exitCode: 2,
    });

    expect(compareAppRuns(original, rebuilt)).toEqual([]);
    expect(withoutStackFrames(original).stdout).toBe(
      "Error in run : Config must have alerting groups\nRun failed\n",
    );
  });

  it("finds any other difference, and a rebuilt app that did not run", () => {
    const original = run({ stderr: "Watchman 2.0.0\n", exitCode: 1 });

    expect(
      compareAppRuns(
        original,
        run({ stderr: "Watchman 0.0.0\n", exitCode: 1 }),
      ),
    ).toEqual([
      {
        kind: "stderr",
        lines: [
          { line: 1, original: "Watchman 2.0.0", rebuilt: "Watchman 0.0.0" },
        ],
      },
    ]);
    expect(compareAppRuns(original, { error: "It timed out." })).toEqual([
      { kind: "did-not-exit", message: "It timed out." },
    ]);
  });
});

describe("realAppPassed and formatRealApp", () => {
  const passing = (runs: readonly RealAppRun[] = []): RealAppResult => ({
    app: REAL_APP,
    reconstruction: summarizeReconstruction(reconstruction(), 35_210),
    mismatches: [],
    runs,
  });
  const same: RealAppRun = {
    args: ["--help"],
    expectedExitCode: 1,
    original: run({ exitCode: 1 }),
    rebuilt: run({ exitCode: 1 }),
    differences: [],
  };

  it("pass and report a Reconstruction as expected whose app behaves identically", () => {
    const result = passing([same, same]);

    expect(realAppPassed(result)).toBe(true);
    expect(formatRealApp(result)).toBe(
      [
        "## Smoke test: reconstructing AwsWatchman 2.0.0 passed",
        "",
        "AwsWatchman, by Just Eat Takeaway.com (Apache-2.0, https://github.com/justeattakeaway/AwsWatchman at 6360ec8), as released in JustEatTakeaway.Watchman 2.0.0 on nuget.org, its SHA-512 checked: tools/net8.0/any/Watchman.dll.",
        "",
        "- **Outcome**: Full Reconstruction, targeting net8.0, in 35.2 s (resolve dependencies 32.3 s, build 2.3 s).",
        "- **Projects**: Watchman (9 types), Watchman.Engine (83 types).",
        "- **Dependency Resolution**: 1 framework, 18 NuGet packages, 3 Sibling Assemblies, 0 copied binaries, 0 Unresolved Dependencies.",
        "- **As expected**: yes, reference by reference.",
        "- **Behaviour**: all 2 inputs behaved identically, stack frames aside.",
        "",
      ].join("\n"),
    );
  });

  it("fail, saying why, when the Reconstruction or the app's behaviour is not as expected", () => {
    const result: RealAppResult = {
      ...passing([
        same,
        {
          ...same,
          args: ["--version"],
          original: run({ exitCode: 0 }),
          rebuilt: run({ exitCode: 3 }),
          differences: [{ kind: "exit-code", original: 0, rebuilt: 3 }],
        },
      ]),
      mismatches: ["StructureMap was copied-binary, not nuget-package."],
    };

    expect(realAppPassed(result)).toBe(false);
    const report = formatRealApp(result);
    expect(report).toContain("AwsWatchman 2.0.0 FAILED");
    expect(report).toContain(
      "- **As expected**: NO:\n  - StructureMap was copied-binary, not nuget-package.",
    );
    expect(report).toContain(
      "- **Behaviour**: 1 of 2 inputs did not behave as expected:\n  - Given `--version`:\n    - The original exited with 0, not 1.\n    - exit code: original 0, rebuilt 3",
    );
  });

  it("fail when the Recovered Solution did not build, so nothing was run", () => {
    const result = passing([]);

    expect(realAppPassed(result)).toBe(false);
    expect(formatRealApp(result)).toContain(
      "- **Behaviour**: not compared, as the Recovered Solution did not build.",
    );
  });
});
