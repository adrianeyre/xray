import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FIXTURES_DIRECTORY,
  buildFixture,
  isGuiFixture,
  readFixtureInputs,
} from "./fixtures.js";
import {
  compareRuns,
  formatRoundTrip,
  roundTrip,
  type Reconstruct,
  type RoundTripResult,
  type SmokeTest,
} from "./round-trip.js";

// These build the arithmetic Fixture and each stand-in Recovered Solution with
// the real `dotnet build`, and run both programs over every input.
const ROUND_TRIP_TIMEOUT_MS = 5 * 60_000;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-round-trip-test-"));
  temporary.push(folder);
  return folder;
}

/**
 * Stands in for a Reconstruction, so these tests prove the harness alone,
 * without core (whose own Round-trip test is in
 * packages/core/src/reconstruct/reconstruct.engine.test.ts): lays a Fixture's
 * own source, the arithmetic Fixture's unless `fixture` names another folder,
 * out as a Recovered Solution — `<Name>.sln` beside `<Name>/<Name>.csproj` —
 * after passing `Program.cs` through `change`.
 */
function fromSource(
  change: (program: string) => string = (p) => p,
  fixture = join(FIXTURES_DIRECTORY, "arithmetic"),
): Reconstruct {
  return async (assemblyPath, outputDirectory) => {
    const name = basename(assemblyPath, extname(assemblyPath));
    const project = join(outputDirectory, name);
    await cp(fixture, project, {
      recursive: true,
      filter: (source) =>
        !["bin", "obj", "inputs.json"].includes(basename(source)),
    });
    const program = join(project, "Program.cs");
    await writeFile(program, change(await readFile(program, "utf8")));
    await writeFile(join(outputDirectory, `${name}.sln`), solution(name));
  };
}

function solution(name: string): string {
  const id = "{D5B1B9B0-6A43-4C1F-9B7E-0E2D2B4C9A10}";
  return [
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${name}", "${name}\\${name}.csproj", "${id}"`,
    "EndProject",
    "Global",
    "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
    "\t\tRelease|Any CPU = Release|Any CPU",
    "\tEndGlobalSection",
    "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
    `\t\t${id}.Release|Any CPU.ActiveCfg = Release|Any CPU`,
    `\t\t${id}.Release|Any CPU.Build.0 = Release|Any CPU`,
    "\tEndGlobalSection",
    "EndGlobal",
    "",
  ].join("\r\n");
}

const TICK = "// Runs once, half a second in.";
const CRASH =
  'throw new System.InvalidOperationException("The window crashed.");';

/**
 * A fixtures folder of its own, holding one GUI Fixture, `window`: a WinForms
 * app for .NET 8 that shows a form until it is closed, and half a second in
 * runs `tick` once. An exception there ends it, as a crash: a GUI Fixture
 * does not let WinForms show a dialog that would keep it alive.
 */
async function guiFixtures(tick = TICK): Promise<string> {
  const root = await temporaryFolder();
  await cp(
    join(FIXTURES_DIRECTORY, "Directory.Build.props"),
    join(root, "Directory.Build.props"),
  );
  const fixture = join(root, "window");
  await mkdir(fixture);
  await writeFile(
    join(fixture, "Window.csproj"),
    [
      '<Project Sdk="Microsoft.NET.Sdk">',
      "  <PropertyGroup>",
      "    <OutputType>WinExe</OutputType>",
      "    <TargetFramework>net8.0-windows</TargetFramework>",
      "    <UseWindowsForms>true</UseWindowsForms>",
      "    <!-- Builds on every OS; runs only on Windows. -->",
      "    <EnableWindowsTargeting>true</EnableWindowsTargeting>",
      "  </PropertyGroup>",
      "</Project>",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(fixture, "Program.cs"),
    [
      "using System;",
      "using System.Windows.Forms;",
      "",
      "namespace Window;",
      "",
      "static class Program",
      "{",
      "    [STAThread]",
      "    static void Main()",
      "    {",
      "        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);",
      '        using var form = new Form { Text = "Window" };',
      "        var timer = new System.Windows.Forms.Timer { Interval = 500 };",
      "        timer.Tick += (_, _) =>",
      "        {",
      "            timer.Stop();",
      "            Tick();",
      "        };",
      "        timer.Start();",
      "        Application.Run(form);",
      "    }",
      "",
      "    static void Tick()",
      "    {",
      `        ${tick}`,
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  return root;
}

/** Replaces the first occurrence, failing if there is none to replace. */
function replaceFirst(text: string, from: string, to: string): string {
  if (!text.includes(from)) {
    throw new Error(`Program.cs has no "${from}" to replace.`);
  }
  return text.replace(from, () => to);
}

function runGiven(result: RoundTripResult, ...args: string[]) {
  const run = result.runs.find(
    (candidate) => JSON.stringify(candidate.args) === JSON.stringify(args),
  );
  if (run === undefined) {
    throw new Error(`No run given [${args.join(" ")}].`);
  }
  return run;
}

describe("roundTrip", () => {
  it(
    "passes a Reconstruction that behaves like the original on every input",
    async () => {
      const inputs = await readFixtureInputs("arithmetic");

      const result = await roundTrip("arithmetic", fromSource());

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.failure).toBeUndefined();
      // Every input, in order, each run through both programs.
      expect(result.runs.map(({ args }) => args)).toEqual(
        inputs.map(({ args }) => args),
      );
      for (const run of result.runs) {
        expect(run.differences).toEqual([]);
        expect(run.rebuilt).toEqual(run.original);
      }
      expect(runGiven(result, "int", "7", "0").original.exitCode).toBe(2);
      expect(formatRoundTrip(result)).toBe(
        `Round-trip of the arithmetic Fixture passed: all ${inputs.length} inputs behaved identically.`,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "fails a deliberately wrong Reconstruction, reporting each input's differences",
    async () => {
      const wrong = fromSource((program) =>
        [
          // The first subtraction, int's, adds; long's, double's and decimal's
          // are untouched.
          (text: string) =>
            replaceFirst(text, "{a} - {b} = {a - b}", "{a} - {b} = {a + b}"),
          // Division by zero says something else and exits with another code.
          (text: string) =>
            replaceFirst(text, "Cannot divide by zero.", "Division by zero."),
          (text: string) =>
            replaceFirst(text, "DividedByZero = 2;", "DividedByZero = 4;"),
          // An unknown type hangs.
          (text: string) =>
            replaceFirst(
              text,
              "default:\n",
              "default:\n                    System.Threading.Thread.Sleep(-1);\n",
            ),
        ].reduce(
          (text, change) => change(text),
          program.replaceAll("\r\n", "\n"),
        ),
      );

      const result = await roundTrip("arithmetic", wrong, {
        timeoutMs: 10_000,
      });

      expect(result.passed).toBe(false);
      expect(result.failure).toBeUndefined();

      // A line keeps the "\r" Windows ends it with.
      const cr = process.platform === "win32" ? "\r" : "";
      expect(runGiven(result, "int", "7", "2").differences).toEqual([
        {
          kind: "stdout",
          lines: [
            {
              line: 2,
              original: `7 - 2 = 5${cr}`,
              rebuilt: `7 - 2 = 9${cr}`,
            },
          ],
        },
      ]);
      // b = 0 hides the wrong operator, but not the wrong error handling.
      expect(runGiven(result, "int", "7", "0").differences).toEqual([
        {
          kind: "stderr",
          lines: [
            {
              line: 1,
              original: `Cannot divide by zero.${cr}`,
              rebuilt: `Division by zero.${cr}`,
            },
          ],
        },
        { kind: "exit-code", original: 2, rebuilt: 4 },
      ]);
      expect(runGiven(result, "complex", "1", "2").differences).toEqual([
        {
          kind: "did-not-exit",
          message: expect.stringMatching(/did not exit within 10000 ms/),
        },
      ]);
      // Inputs that do not reach a fault behave the same.
      expect(runGiven(result, "long", "3000000000", "3").differences).toEqual(
        [],
      );
      expect(runGiven(result, "int", "seven", "2").differences).toEqual([]);

      const differing = result.runs.filter(
        ({ differences }) => differences.length > 0,
      );
      const report = formatRoundTrip(result);
      expect(report).toMatch(
        new RegExp(
          `^Round-trip of the arithmetic Fixture FAILED: ${differing.length} of ${result.runs.length} inputs behaved differently\\.\n`,
        ),
      );
      expect(report).toContain(
        [
          "Given int 7 2:",
          "  stdout line 2:",
          `    original: ${JSON.stringify(`7 - 2 = 5${cr}`)}`,
          `    rebuilt:  ${JSON.stringify(`7 - 2 = 9${cr}`)}`,
        ].join("\n"),
      );
      expect(report).toContain(
        [
          "Given int 7 0:",
          "  stderr line 1:",
          `    original: ${JSON.stringify(`Cannot divide by zero.${cr}`)}`,
          `    rebuilt:  ${JSON.stringify(`Division by zero.${cr}`)}`,
          "  exit code: original 2, rebuilt 4",
        ].join("\n"),
      );
      expect(report).toMatch(
        /Given complex 1 2:\n {2}the rebuilt program did not exit normally: .*did not exit within 10000 ms/,
      );
      expect(report).not.toContain("Given long 3000000000 3:");
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "fails a Reconstruction that does not rebuild, with the compiler's errors",
    async () => {
      const result = await roundTrip(
        "arithmetic",
        fromSource((program) =>
          replaceFirst(program, "return Succeeded;", "return Succeeded"),
        ),
      );

      expect(result).toMatchObject({
        passed: false,
        failure: { stage: "rebuild" },
        runs: [],
      });
      expect(formatRoundTrip(result)).toMatch(
        /^Round-trip of the arithmetic Fixture FAILED: the Recovered Solution did not rebuild\.\nBuilding the Recovered Solution failed\.\n[\s\S]*Program\.cs\(\d+,\d+\): error CS1002: ; expected/,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "fails a Reconstruction that throws, with its message",
    async () => {
      const result = await roundTrip("arithmetic", () =>
        Promise.reject(new Error("The engine crashed.")),
      );

      expect(result).toEqual({
        fixture: "arithmetic",
        passed: false,
        failure: { stage: "reconstruct", message: "The engine crashed." },
        runs: [],
      });
      expect(formatRoundTrip(result)).toBe(
        "Round-trip of the arithmetic Fixture FAILED: the Reconstruction failed.\nThe engine crashed.",
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "fails a Reconstruction that writes no .sln",
    async () => {
      const result = await roundTrip(
        "arithmetic",
        async (assemblyPath, outputDirectory) => {
          await fromSource()(assemblyPath, outputDirectory);
          await rm(join(outputDirectory, "Arithmetic.sln"));
        },
      );

      expect(result.passed).toBe(false);
      expect(result.failure?.stage).toBe("reconstruct");
      expect(result.failure?.message).toMatch(
        /should hold exactly one \.sln at its top, but holds none\.$/,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "reconstructs into a folder that does not exist yet, in a temporary folder deleted once done",
    async () => {
      let given = "";
      let existed: boolean | undefined;

      await roundTrip("arithmetic", async (assemblyPath, outputDirectory) => {
        given = outputDirectory;
        existed = existsSync(outputDirectory);
        await fromSource()(assemblyPath, outputDirectory);
      });

      expect(existed).toBe(false);
      expect(existsSync(dirname(given))).toBe(false);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "leaves the Recovered Solution and its rebuild in a work directory it is given",
    async () => {
      const work = join(await temporaryFolder(), "work");

      const result = await roundTrip("arithmetic", fromSource(), {
        workDirectory: work,
      });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect((await readdir(work)).sort()).toEqual(["rebuilt", "recovered"]);
      expect(existsSync(join(work, "recovered", "Arithmetic.sln"))).toBe(true);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it("refuses a work directory that is not empty", async () => {
    const work = await temporaryFolder();
    await writeFile(join(work, "left-over.txt"), "");

    await expect(
      roundTrip("arithmetic", fromSource(), { workDirectory: work }),
    ).rejects.toThrow(/must be empty or not exist yet\.$/);
  });

  it.skipIf(process.platform === "win32")(
    "rejects the Round-trip of a .NET Framework Fixture off Windows, where it cannot run, before reconstructing it",
    async () => {
      let reconstructed = false;

      await expect(
        roundTrip("net48-console", async () => {
          reconstructed = true;
        }),
      ).rejects.toThrow(
        `The net48-console Fixture targets net48, a .NET Framework program that runs only on Windows, so its Round-trip cannot run on ${process.platform}.`,
      );
      expect(reconstructed).toBe(false);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it("rejects a name that is not a Fixture", async () => {
    await expect(roundTrip("geometry", fromSource())).rejects.toThrow(
      /^There is no Fixture named "geometry"\./,
    );
  });
});

describe("roundTrip of a GUI Fixture", () => {
  const ALIVE_FOR_MS = 3_000;

  it.skipIf(process.platform === "win32")(
    "only rebuilds it off Windows, launching nothing, even one that crashes, and says so",
    async () => {
      const root = await guiFixtures(CRASH);
      const options = { fixturesDirectory: root, aliveForMs: ALIVE_FOR_MS };
      expect(isGuiFixture(await buildFixture("window", options))).toBe(true);

      const result = await roundTrip(
        "window",
        fromSource(undefined, join(root, "window")),
        options,
      );

      const reason = `a GUI Fixture is launched only on Windows, and this is ${process.platform}`;
      expect(result).toEqual({
        fixture: "window",
        passed: true,
        runs: [],
        smokeTest: { outcome: "build-only", reason },
      });
      expect(formatRoundTrip(result)).toBe(
        `Round-trip of the window Fixture passed, build only: the Recovered Solution rebuilt, and its app was not launched, as ${reason}.`,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "fails it on every OS when its Recovered Solution does not rebuild, before launching anything",
    async () => {
      const root = await guiFixtures();

      const result = await roundTrip(
        "window",
        fromSource(
          (program) => replaceFirst(program, "timer.Start();", "timer.Start()"),
          join(root, "window"),
        ),
        { fixturesDirectory: root, aliveForMs: ALIVE_FOR_MS },
      );

      expect(result).toMatchObject({
        passed: false,
        failure: { stage: "rebuild" },
        runs: [],
      });
      expect(result.smokeTest).toBeUndefined();
      expect(formatRoundTrip(result)).toMatch(
        /^Round-trip of the window Fixture FAILED: the Recovered Solution did not rebuild\.\nBuilding the Recovered Solution failed\.\n[\s\S]*Program\.cs\(\d+,\d+\): error CS1002: ; expected/,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.runIf(process.platform === "win32")(
    "launches its rebuilt app on Windows, and passes it once it has stayed alive, then closes it",
    async () => {
      const root = await guiFixtures();

      const result = await roundTrip(
        "window",
        fromSource(undefined, join(root, "window")),
        { fixturesDirectory: root, aliveForMs: ALIVE_FOR_MS },
      );

      expect(result).toEqual({
        fixture: "window",
        passed: true,
        runs: [],
        smokeTest: { outcome: "stayed-alive", aliveForMs: ALIVE_FOR_MS },
      });
      expect(formatRoundTrip(result)).toBe(
        "Round-trip of the window Fixture passed: the Recovered Solution rebuilt, and its app stayed alive for 3 s once launched, then was closed.",
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.runIf(process.platform === "win32")(
    "fails a crashing GUI Fixture on Windows, with how its rebuilt app crashed and what it wrote",
    async () => {
      const root = await guiFixtures(CRASH);

      const result = await roundTrip(
        "window",
        fromSource(undefined, join(root, "window")),
        { fixturesDirectory: root, aliveForMs: ALIVE_FOR_MS },
      );

      expect(result.passed, formatRoundTrip(result)).toBe(false);
      expect(result.failure).toBeUndefined();
      expect(result.smokeTest).toMatchObject({
        outcome: "exited",
        aliveForMs: ALIVE_FOR_MS,
        stderr: expect.stringContaining("The window crashed."),
      });
      // Crashed, rather than exiting by itself.
      expect(result.smokeTest).not.toMatchObject({ exitCode: 0 });
      expect(formatRoundTrip(result)).toMatch(
        /^Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 3 s: [\d.]+ m?s after it was launched, it crashed with [\s\S]*\n\nIt wrote to stderr:\n[\s\S]*The window crashed\./,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.runIf(process.platform === "win32")(
    "fails a Reconstruction whose rebuilt app crashes on Windows where the Fixture's does not",
    async () => {
      const root = await guiFixtures();

      const result = await roundTrip(
        "window",
        fromSource(
          (program) => replaceFirst(program, TICK, CRASH),
          join(root, "window"),
        ),
        { fixturesDirectory: root, aliveForMs: ALIVE_FOR_MS },
      );

      expect(result.passed, formatRoundTrip(result)).toBe(false);
      expect(result.smokeTest).toMatchObject({
        outcome: "exited",
        stderr: expect.stringContaining("The window crashed."),
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );
});

describe("compareRuns", () => {
  const ran = (stdout: string, stderr = "", exitCode = 0) => ({
    stdout,
    stderr,
    exitCode,
  });

  it("finds no difference between identical runs", () => {
    expect(
      compareRuns(ran("a\nb\n", "c\n", 3), ran("a\nb\n", "c\n", 3)),
    ).toEqual([]);
  });

  it("lists each differing line, and lines one program wrote and the other did not", () => {
    expect(compareRuns(ran("a\nb\nc\n"), ran("a\nB\nc\nd\n"))).toEqual([
      {
        kind: "stdout",
        lines: [
          { line: 2, original: "b", rebuilt: "B" },
          { line: 4, original: "", rebuilt: "d" },
          { line: 5, original: undefined, rebuilt: "" },
        ],
      },
    ]);
  });

  it("tells apart output that differs only in its line endings", () => {
    expect(compareRuns(ran("a\n"), ran("a\r\n"))).toEqual([
      { kind: "stdout", lines: [{ line: 1, original: "a", rebuilt: "a\r" }] },
    ]);
    expect(compareRuns(ran("a\n"), ran("a"))).toEqual([
      {
        kind: "stdout",
        lines: [{ line: 2, original: "", rebuilt: undefined }],
      },
    ]);
  });

  it("compares stderr and the exit code too", () => {
    expect(compareRuns(ran("", "x\n", 1), ran("", "y\n", 2))).toEqual([
      { kind: "stderr", lines: [{ line: 1, original: "x", rebuilt: "y" }] },
      { kind: "exit-code", original: 1, rebuilt: 2 },
    ]);
  });

  it("reports a rebuilt program that did not exit", () => {
    expect(compareRuns(ran(""), { error: "It hung." })).toEqual([
      { kind: "did-not-exit", message: "It hung." },
    ]);
  });
});

describe("formatRoundTrip", () => {
  const ran = { stdout: "", stderr: "", exitCode: 0 };

  it("quotes arguments and lines whose whitespace would otherwise be lost", () => {
    const report = formatRoundTrip({
      fixture: "echo",
      passed: false,
      runs: [
        {
          args: ["a b", "", "c"],
          original: ran,
          rebuilt: ran,
          differences: [
            {
              kind: "stdout",
              lines: [{ line: 1, original: "x ", rebuilt: undefined }],
            },
          ],
        },
        { args: [], original: ran, rebuilt: ran, differences: [] },
        {
          args: [],
          original: ran,
          rebuilt: ran,
          differences: [{ kind: "exit-code", original: 0, rebuilt: 1 }],
        },
      ],
    });

    expect(report).toBe(
      [
        "Round-trip of the echo Fixture FAILED: 2 of 3 inputs behaved differently.",
        "",
        'Given "a b" "" c:',
        "  stdout line 1:",
        '    original: "x "',
        "    rebuilt:  (no such line)",
        "",
        "Given no arguments:",
        "  exit code: original 0, rebuilt 1",
      ].join("\n"),
    );
  });

  it("shows the first ten differing lines of a stream and counts the rest", () => {
    const lines = Array.from({ length: 13 }, (_, i) => ({
      line: i + 1,
      original: `${i}`,
      rebuilt: `${-i}`,
    }));

    const report = formatRoundTrip({
      fixture: "loud",
      passed: false,
      runs: [
        {
          args: ["go"],
          original: ran,
          rebuilt: ran,
          differences: [{ kind: "stderr", lines }],
        },
      ],
    });

    expect(report).toContain("  stderr line 10:");
    expect(report).not.toContain("  stderr line 11:");
    expect(report).toMatch(/ {2}\.\.\.and 3 more differing stderr lines\.$/);
  });

  describe("of a GUI Fixture", () => {
    const exited = {
      outcome: "exited",
      aliveForMs: 5_000,
      afterMs: 1_430,
      exitCode: 0xe0434352,
      signal: null,
      stdout: "",
      stderr: "",
    } as const;
    const report = (smokeTest: SmokeTest) =>
      formatRoundTrip({
        fixture: "window",
        passed: false,
        runs: [],
        smokeTest,
      });

    it("says a rebuilt app that crashed with an unhandled exception did, and what it wrote", () => {
      expect(
        report({
          ...exited,
          stderr:
            "Unhandled exception. System.InvalidOperationException: The window crashed.\r\n   at Window.Program.Tick()\r\n\r\n",
        }),
      ).toBe(
        [
          "Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 5 s: 1.4 s after it was launched, it crashed with 0xE0434352, as .NET ends a program that throws an unhandled exception.",
          "",
          "It wrote to stderr:",
          "  Unhandled exception. System.InvalidOperationException: The window crashed.",
          "     at Window.Program.Tick()",
          "",
        ].join("\n"),
      );
      // Node may give Windows' exit code as signed.
      expect(report({ ...exited, exitCode: 0xe0434352 - 2 ** 32 })).toContain(
        "it crashed with 0xE0434352,",
      );
    });

    it("says how else it ended before its time was up", () => {
      expect(report({ ...exited, exitCode: 3, afterMs: 40 })).toBe(
        "Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 5 s: 40 ms after it was launched, it crashed with exit code 3.",
      );
      expect(report({ ...exited, exitCode: 0 })).toBe(
        "Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 5 s: 1.4 s after it was launched, it exited by itself, with exit code 0.",
      );
      expect(report({ ...exited, exitCode: null, signal: "SIGABRT" })).toBe(
        "Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 5 s: 1.4 s after it was launched, it was ended by SIGABRT.",
      );
    });

    it("shows the first ten lines of what it wrote to each stream and counts the rest", () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);

      const text = report({
        ...exited,
        stdout: "started\n",
        stderr: `${lines.join("\n")}\n`,
      });

      expect(text).toContain(
        "\n\nIt wrote to stdout:\n  started\n\nIt wrote to stderr:\n  line 1\n",
      );
      expect(text).toContain("  line 10\n  ...and 2 more lines.");
      expect(text).not.toContain("line 11");
    });

    it("says a rebuilt app that could not be launched could not, and why", () => {
      expect(
        report({
          outcome: "did-not-start",
          message: 'Could not run Window.dll with "dotnet".',
        }),
      ).toBe(
        'Round-trip of the window Fixture FAILED: the rebuilt app could not be launched.\nCould not run Window.dll with "dotnet".',
      );
    });
  });

  it("says when a Fixture rebuilt but has no inputs to compare", () => {
    expect(
      formatRoundTrip({ fixture: "library", passed: true, runs: [] }),
    ).toBe(
      "Round-trip of the library Fixture passed: the Recovered Solution rebuilt; the Fixture has no inputs to run.",
    );
  });
});
