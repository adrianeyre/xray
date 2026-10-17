import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURES_DIRECTORY,
  NATIVE_EXECUTABLE_FIXTURE,
  buildFixture,
  isGuiFixture,
  listFixtures,
  readFixtureInputs,
  restoreFixture,
} from "./fixtures.js";
import { runAssembly } from "./run-assembly.js";

// These run the real `dotnet build`.
const BUILD_TIMEOUT_MS = 5 * 60_000;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** A fixtures folder of its own, holding a copy of the arithmetic Fixture. */
async function fixturesCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xray-fixtures-"));
  temporary.push(root);
  await cp(
    join(FIXTURES_DIRECTORY, "Directory.Build.props"),
    join(root, "Directory.Build.props"),
  );
  await cp(join(FIXTURES_DIRECTORY, "arithmetic"), join(root, "arithmetic"), {
    recursive: true,
    filter: (source) => !["bin", "obj"].includes(basename(source)),
  });
  return root;
}

async function edit(
  path: string,
  change: (text: string) => string,
): Promise<void> {
  await writeFile(path, change(await readFile(path, "utf8")));
}

describe("listFixtures", () => {
  it("names each folder holding a .csproj, and nothing else", async () => {
    const fixtures = await listFixtures();

    expect(fixtures).toContain("arithmetic");
    expect(fixtures).not.toContain("src");
    expect(fixtures).not.toContain(".cache");
    expect(fixtures).not.toContain("node_modules");
  });

  it("leaves out the native Fixture, which is prebuilt rather than built", async () => {
    expect(await listFixtures()).not.toContain("native");
  });
});

describe("restoreFixture", () => {
  it(
    "restores the nuget-dependencies Fixture's packages into the global-packages folder, leaving its source tree as it was",
    async () => {
      const source = join(FIXTURES_DIRECTORY, "nuget-dependencies");
      const before = (await readdir(source)).sort();
      const packages =
        process.env["NUGET_PACKAGES"] || join(homedir(), ".nuget", "packages");

      await restoreFixture("nuget-dependencies");

      expect(existsSync(join(packages, "newtonsoft.json", "13.0.3"))).toBe(
        true,
      );
      expect(existsSync(join(packages, "serilog", "3.1.1"))).toBe(true);
      expect((await readdir(source)).sort()).toEqual(before);
    },
    BUILD_TIMEOUT_MS,
  );

  it("refuses a Fixture there is not", async () => {
    await expect(restoreFixture("no-such-fixture")).rejects.toThrow(
      'There is no Fixture named "no-such-fixture".',
    );
  });
});

describe("NATIVE_EXECUTABLE_FIXTURE", () => {
  it("is the committed hello.exe, beside the C source it was built from", async () => {
    const exe = await readFile(NATIVE_EXECUTABLE_FIXTURE);

    expect(dirname(NATIVE_EXECUTABLE_FIXTURE)).toBe(
      join(FIXTURES_DIRECTORY, "native"),
    );
    expect(existsSync(join(FIXTURES_DIRECTORY, "native", "hello.c"))).toBe(
      true,
    );
    // Git checked it out byte for byte (.gitattributes), as README.md records.
    expect(exe.length).toBe(17_920);
    expect(createHash("sha256").update(exe).digest("hex")).toBe(
      "0602e8b3ceaab3f1cab68235489c496af1f5275063215027fbf806047c4f1bd7",
    );
  });
});

describe("buildFixture", () => {
  it(
    "builds a Fixture by name and returns its Assembly",
    async () => {
      const fixture = await buildFixture("arithmetic");

      expect(fixture.name).toBe("arithmetic");
      expect(fixture.targetFramework).toBe("net8.0");
      expect(fixture.outputType).toBe("Exe");
      expect(isGuiFixture(fixture)).toBe(false);
      expect(isAbsolute(fixture.assemblyPath)).toBe(true);
      expect(basename(fixture.assemblyPath)).toBe("Arithmetic.dll");
      expect(existsSync(fixture.assemblyPath)).toBe(true);
      expect(fixture.outputDirectory).toBe(dirname(fixture.assemblyPath));
      expect(
        existsSync(
          join(fixture.outputDirectory, "Arithmetic.runtimeconfig.json"),
        ),
      ).toBe(true);
      // Built into the cache, not beside the source.
      expect(
        relative(join(FIXTURES_DIRECTORY, ".cache"), fixture.assemblyPath),
      ).not.toMatch(/^\.\./);
      expect(
        (await runAssembly(fixture.assemblyPath, ["int", "40", "2"])).stdout,
      ).toMatch(/^40 \+ 2 = 42\r?$/m);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "builds the net48 Fixture on any OS, into a .NET Framework program",
    async () => {
      const fixture = await buildFixture("net48-console");

      expect(fixture.targetFramework).toBe("net48");
      expect(basename(fixture.assemblyPath)).toBe("Net48Console.exe");
      expect(existsSync(fixture.assemblyPath)).toBe(true);
      // Started as itself, not by the dotnet host.
      expect(
        existsSync(
          join(fixture.outputDirectory, "Net48Console.runtimeconfig.json"),
        ),
      ).toBe(false);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "builds the netcoreapp3.1 Fixture, which runs on a later .NET",
    async () => {
      const fixture = await buildFixture("netcoreapp31-console");

      expect(fixture.targetFramework).toBe("netcoreapp3.1");
      expect(basename(fixture.assemblyPath)).toBe("NetCoreApp31Console.dll");
      expect(
        (await runAssembly(fixture.assemblyPath, ["framework"])).stdout,
      ).toMatch(/^\.NETCoreApp,Version=v3\.1\r?\n$/);
    },
    BUILD_TIMEOUT_MS,
  );

  it.each([
    ["net35-library", "Net35Library.dll", "Gradebook.dll", "framework"],
    [
      "netstandard20-library",
      "NetStandard20Library.dll",
      "Measures.dll",
      "framework",
    ],
  ])(
    "builds the %s Fixture, a .NET 8 program with its library beside it, which it runs on any OS",
    async (name, program, library, command) => {
      const fixture = await buildFixture(name);

      expect(fixture.targetFramework).toBe("net8.0");
      expect(basename(fixture.assemblyPath)).toBe(program);
      expect(existsSync(join(fixture.outputDirectory, library))).toBe(true);
      expect(
        (await runAssembly(fixture.assemblyPath, [command])).stdout,
      ).toMatch(
        name === "net35-library"
          ? /^Gradebook: CLR v2\.0\.50727, System\.Core 3\.5\.0\.0\r?\n$/
          : /^Measures: \.NETStandard,Version=v2\.0\r?\n$/,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  it.each([
    ["winforms", "net8.0-windows", "Greeter.dll"],
    ["net48-winforms", "net48", "Stopwatch.exe"],
    ["wpf", "net8.0-windows", "Tally.dll"],
    ["net48-wpf", "net48", "Swatches.exe"],
  ])(
    "builds the %s Fixture on any OS, a GUI Fixture for %s",
    async (name, targetFramework, assembly) => {
      const fixture = await buildFixture(name);

      expect(fixture).toMatchObject({ targetFramework, outputType: "WinExe" });
      expect(isGuiFixture(fixture)).toBe(true);
      expect(basename(fixture.assemblyPath)).toBe(assembly);
      expect(await readFixtureInputs(name)).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "builds the net48-winforms Fixture beside System.Resources.Extensions, which reads its form's resources, redirecting the version they name to its own",
    async () => {
      const fixture = await buildFixture("net48-winforms");

      expect(
        existsSync(
          join(fixture.outputDirectory, "System.Resources.Extensions.dll"),
        ),
      ).toBe(true);
      expect(
        await readFile(
          join(fixture.outputDirectory, "Stopwatch.exe.config"),
          "utf8",
        ),
      ).toMatch(
        /<assemblyIdentity name="System\.Resources\.Extensions"[^>]*\/>\s*<bindingRedirect oldVersion="0\.0\.0\.0-8\.0\.0\.0" newVersion="8\.0\.0\.0" \/>/,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "builds the resources Fixture with its French and German satellite assemblies beside it, and the .resources file it writes as it is built",
    async () => {
      const fixture = await buildFixture("resources");

      expect(basename(fixture.assemblyPath)).toBe("Phrasebook.dll");
      for (const culture of ["de", "fr"]) {
        expect(
          existsSync(
            join(fixture.outputDirectory, culture, "Phrasebook.resources.dll"),
          ),
        ).toBe(true);
      }
      expect(
        (await runAssembly(fixture.assemblyPath, ["limits"])).stdout,
      ).toMatch(/^MaxPhrases: 42 \(System\.Int32\)\r?\n/);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "reuses the build of an unchanged Fixture, and rebuilds it once its source or shared build files change",
    async () => {
      const root = await fixturesCopy();
      const cacheDirectory = join(root, ".cache");
      const options = { fixturesDirectory: root, cacheDirectory };

      const first = await buildFixture("arithmetic", options);
      // As a later run would: nothing is held in memory between these calls.
      const reused = await buildFixture("arithmetic", options);
      expect(reused).toEqual(first);

      await edit(join(root, "arithmetic", "Program.cs"), (text) =>
        text.replace("Cannot divide by zero.", "Division by zero."),
      );
      const changed = await buildFixture("arithmetic", options);
      expect(changed.assemblyPath).not.toBe(first.assemblyPath);
      expect(
        (await runAssembly(changed.assemblyPath, ["int", "1", "0"])).stderr,
      ).toMatch(/^Division by zero\.\r?\n$/);
      // The out-of-date build is cleared away.
      expect(existsSync(first.assemblyPath)).toBe(false);

      await edit(join(root, "Directory.Build.props"), (text) =>
        text.replace(
          "</PropertyGroup>",
          "<Deterministic>true</Deterministic></PropertyGroup>",
        ),
      );
      const reconfigured = await buildFixture("arithmetic", options);
      expect(reconfigured.assemblyPath).not.toBe(changed.assemblyPath);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "leaves the Fixture's source folder free of build output",
    async () => {
      const root = await fixturesCopy();
      const before = await readdir(join(root, "arithmetic"));

      await buildFixture("arithmetic", { fixturesDirectory: root });

      expect(await readdir(join(root, "arithmetic"))).toEqual(before);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "serves concurrent requests for one Fixture from one build",
    async () => {
      const root = await fixturesCopy();

      const [one, two] = await Promise.all([
        buildFixture("arithmetic", { fixturesDirectory: root }),
        buildFixture("arithmetic", { fixturesDirectory: root }),
      ]);

      expect(two).toEqual(one);
      expect(existsSync(one.assemblyPath)).toBe(true);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "rejects with the compiler's errors when a Fixture does not compile, caching nothing",
    async () => {
      const root = await fixturesCopy();
      await edit(join(root, "arithmetic", "Program.cs"), (text) =>
        text.replace("return Succeeded;", "return Succeeded"),
      );

      await expect(
        buildFixture("arithmetic", { fixturesDirectory: root }),
      ).rejects.toThrow(
        /^Building the Fixture "arithmetic" failed\.\n[\s\S]*Program\.cs\(\d+,\d+\): error CS1002: ; expected/,
      );
      expect(await readdir(join(root, ".cache", "arithmetic"))).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  it("rejects a name that is not a Fixture, listing those that are", async () => {
    await expect(buildFixture("geometry")).rejects.toThrow(
      /^There is no Fixture named "geometry"\. Fixtures: .*\barithmetic\b/,
    );
    await expect(buildFixture("../engine")).rejects.toThrow(
      'There is no Fixture named "../engine".',
    );
  });

  it("explains that the .NET SDK is needed when dotnet cannot be found", async () => {
    await expect(
      buildFixture("arithmetic", {
        dotnetPath: join(tmpdir(), "no-such-dir", "dotnet"),
      }),
    ).rejects.toThrow(/needs the \.NET SDK 8 or later on PATH\.$/);
  });
});

describe("readFixtureInputs", () => {
  it("reads the inputs a console Fixture is run with", async () => {
    const inputs = await readFixtureInputs("arithmetic");

    expect(inputs).toContainEqual({
      args: ["int", "7", "0"],
      expected: {
        stdout: [
          "7 + 0 = 7",
          "7 - 0 = 7",
          "7 * 0 = 0",
          "checked(7 + 0) = 7",
          "checked(7 * 0) = 0",
        ],
        stderr: ["Cannot divide by zero."],
        exitCode: 2,
      },
    });
  });

  it("reads none for a Fixture without an inputs.json", async () => {
    const root = await fixturesCopy();
    await rm(join(root, "arithmetic", "inputs.json"));

    expect(
      await readFixtureInputs("arithmetic", { fixturesDirectory: root }),
    ).toEqual([]);
  });

  it("rejects a malformed inputs.json", async () => {
    const root = await fixturesCopy();
    await writeFile(
      join(root, "arithmetic", "inputs.json"),
      JSON.stringify([{ args: ["int", "1", "2"], expected: { stdout: "3" } }]),
    );

    await expect(
      readFixtureInputs("arithmetic", { fixturesDirectory: root }),
    ).rejects.toThrow(/inputs\.json must be an array of/);
  });

  it("rejects a name that is not a Fixture", async () => {
    await expect(readFixtureInputs("geometry")).rejects.toThrow(
      'There is no Fixture named "geometry".',
    );
  });
});
