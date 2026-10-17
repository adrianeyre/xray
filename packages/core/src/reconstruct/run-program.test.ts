import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SolutionBuild } from "./build-solution.js";
import {
  MAX_RUN_OUTPUT,
  planRun,
  runFailed,
  runProgram,
  type RunTarget,
} from "./run-program.js";

// The rebuilt programs here are Node scripts, run by Node in place of the
// `dotnet` host, so what they do is up to each test.

const built: SolutionBuild = {
  succeeded: true,
  output: "Build succeeded.\n",
  diagnostics: [],
};

const console8: RunTarget = {
  projectPath: "App/App.csproj",
  assemblyName: "App",
  targetFramework: "net8.0",
  outputKind: "console",
};

describe("planRun", () => {
  it("runs a .NET console program with the dotnet host, wherever it is", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      expect(planRun(console8, built, platform)).toEqual({
        runnable: true,
        program: "App/bin/Debug/net8.0/App.dll",
        hosted: true,
        gui: false,
      });
    }
  });

  it("runs a .NET Framework program as itself, on Windows", () => {
    expect(
      planRun({ ...console8, targetFramework: "net48" }, built, "win32"),
    ).toEqual({
      runnable: true,
      program: "App/bin/Debug/net48/App.exe",
      hosted: false,
      gui: false,
    });
  });

  it.each(["winforms", "wpf", "windows"] as const)(
    "runs a %s program on Windows, as a GUI program",
    (outputKind) => {
      expect(planRun({ ...console8, outputKind }, built, "win32")).toEqual({
        runnable: true,
        program: "App/bin/Debug/net8.0/App.dll",
        hosted: true,
        gui: true,
      });
    },
  );

  it.each([
    [
      "winforms",
      "linux",
      "It is a WinForms program, and WinForms runs only on Windows, not on Linux.",
    ],
    [
      "wpf",
      "darwin",
      "It is a WPF program, and WPF runs only on Windows, not on macOS.",
    ],
    [
      "winforms",
      "freebsd",
      "It is a WinForms program, and WinForms runs only on Windows, not on freebsd.",
    ],
  ] as const)(
    "skips a %s program on %s, saying why",
    (outputKind, platform, reason) => {
      expect(planRun({ ...console8, outputKind }, built, platform)).toEqual({
        runnable: false,
        reason,
      });
    },
  );

  it.each(["net48", "net40-client"])(
    "skips a .NET Framework program (%s) anywhere but Windows",
    (targetFramework) => {
      expect(planRun({ ...console8, targetFramework }, built, "linux")).toEqual(
        {
          runnable: false,
          reason: `It targets ${targetFramework}, and a .NET Framework program runs only on Windows, not on Linux.`,
        },
      );
    },
  );

  it("skips a program for a Windows target framework anywhere but Windows", () => {
    expect(
      planRun(
        { ...console8, targetFramework: "net8.0-windows" },
        built,
        "darwin",
      ),
    ).toEqual({
      runnable: false,
      reason:
        "It targets net8.0-windows, which runs only on Windows, not on macOS.",
    });
    expect(
      planRun(
        { ...console8, targetFramework: "net8.0-windows" },
        built,
        "win32",
      ),
    ).toMatchObject({ runnable: true });
  });

  it("skips a library, which has no entry point", () => {
    expect(
      planRun({ ...console8, outputKind: "library" }, built, "win32"),
    ).toEqual({
      runnable: false,
      reason:
        "It is a library, with no entry point, so there is no program to run.",
    });
  });

  it("skips a Recovered Solution that did not build, or was not built", () => {
    expect(planRun(console8, { ...built, succeeded: false }, "linux")).toEqual({
      runnable: false,
      reason:
        "The Recovered Solution did not build, so there is no rebuilt program to run.",
    });
    expect(planRun(console8, null, "linux")).toEqual({
      runnable: false,
      reason:
        "The Recovered Solution was not built, so there is no rebuilt program to run.",
    });
  });
});

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

/** A Recovered Solution whose rebuilt "program" is the Node script `source`. */
async function solutionRunning(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "xray-run-"));
  temporary.push(directory);
  await mkdir(join(directory, "App", "bin"), { recursive: true });
  await writeFile(join(directory, "App", "bin", "App.mjs"), source);
  return directory;
}

const node = { dotnetPath: process.execPath };
const PROGRAM = "App/bin/App.mjs";
const console_ = {
  runnable: true,
  program: PROGRAM,
  hosted: true,
  gui: false,
} as const;

describe("runProgram", () => {
  it("records the exit code and what it wrote, from its own folder, with no stdin", async () => {
    const directory = await solutionRunning(
      [
        'import { basename } from "node:path";',
        'import { readFileSync } from "node:fs";',
        "const stdin = readFileSync(0, 'utf8');",
        "console.log(`in ${basename(process.cwd())}, stdin ${JSON.stringify(stdin)}, roll forward ${process.env.DOTNET_ROLL_FORWARD}`);",
        "console.error('usage');",
        "process.exitCode = 3;",
      ].join("\n"),
    );

    const run = await runProgram(directory, console_, node);

    expect(run).toEqual({
      status: "exited",
      reason: null,
      program: PROGRAM,
      exitCode: 3,
      stdout: 'in bin, stdin "", roll forward Major\n',
      stderr: "usage\n",
    });
    expect(runFailed(run)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "records a program ended by a signal as crashed, as .NET ends one on an unhandled exception",
    async () => {
      const directory = await solutionRunning(
        "console.error('Unhandled exception.');\nprocess.kill(process.pid, 'SIGABRT');\n",
      );

      const run = await runProgram(directory, console_, node);

      expect(run).toEqual({
        status: "crashed",
        reason:
          "It was ended by SIGABRT, as .NET ends a program that throws an unhandled exception.",
        program: PROGRAM,
        exitCode: null,
        stdout: "",
        stderr: "Unhandled exception.\n",
      });
      expect(runFailed(run)).toBe(true);
    },
  );

  it("records a Windows program ended by an unhandled exception as crashed", async () => {
    const directory = await solutionRunning("process.exit(0xe0434352);\n");

    const run = await runProgram(directory, console_, node);

    // Only Windows has 32-bit exit codes; elsewhere it is cut to its last byte.
    if (process.platform === "win32") {
      expect(run).toMatchObject({
        status: "crashed",
        reason:
          "It exited with 0xE0434352, as .NET ends a program that throws an unhandled exception.",
      });
    } else {
      expect(run).toMatchObject({ status: "exited", exitCode: 0x52 });
    }
  });

  it("stops a console program that outlives its time, as timed out", async () => {
    const directory = await solutionRunning(
      "console.log('waiting');\nsetInterval(() => {}, 1000);\n",
    );

    const run = await runProgram(directory, console_, {
      ...node,
      timeoutMs: 1_000,
    });

    expect(run).toEqual({
      status: "timed-out",
      reason: "It did not exit within 1000 ms, so it was stopped.",
      program: PROGRAM,
      exitCode: null,
      stdout: "waiting\n",
      stderr: "",
    });
    expect(runFailed(run)).toBe(true);
  });

  it("closes a GUI program still running once it has launched", async () => {
    const directory = await solutionRunning("setInterval(() => {}, 1000);\n");

    const run = await runProgram(
      directory,
      { ...console_, gui: true },
      { ...node, launchMs: 500, timeoutMs: 60_000 },
    );

    expect(run).toEqual({
      status: "launched",
      reason: null,
      program: PROGRAM,
      exitCode: null,
      stdout: "",
      stderr: "",
    });
    expect(runFailed(run)).toBe(false);
  });

  it("records a GUI program that exits before then as exited", async () => {
    const directory = await solutionRunning("process.exitCode = 0;\n");

    expect(
      await runProgram(
        directory,
        { ...console_, gui: true },
        { ...node, launchMs: 10_000 },
      ),
    ).toMatchObject({ status: "exited", exitCode: 0 });
  });

  it("records a program that is not where the build should have put it as failing to start", async () => {
    const directory = await solutionRunning("");

    expect(
      await runProgram(
        directory,
        { ...console_, program: "App/bin/Debug/net8.0/App.dll" },
        node,
      ),
    ).toEqual({
      status: "failed-to-start",
      reason:
        "There is no program at App/bin/Debug/net8.0/App.dll, where `dotnet build` should have put it.",
      program: "App/bin/Debug/net8.0/App.dll",
      exitCode: null,
      stdout: "",
      stderr: "",
    });
  });

  it("records a dotnet host that cannot be run as failing to start", async () => {
    const directory = await solutionRunning("");

    const run = await runProgram(directory, console_, {
      dotnetPath: join(directory, "no-such-dotnet"),
    });

    expect(run).toMatchObject({
      status: "failed-to-start",
      program: PROGRAM,
      exitCode: null,
    });
    expect(run.reason).toContain(
      `Could not run ${PROGRAM} with "${join(directory, "no-such-dotnet")}"`,
    );
  });

  it("keeps only the first MiB of what it writes", async () => {
    const directory = await solutionRunning(
      `process.stdout.write("x".repeat(${MAX_RUN_OUTPUT + 10}));\n`,
    );

    const run = await runProgram(directory, console_, node);

    expect(run.status).toBe("exited");
    expect(run.stdout).toBe(
      `${"x".repeat(MAX_RUN_OUTPUT)}\n[Xray kept only the first ${MAX_RUN_OUTPUT} characters.]\n`,
    );
  });
});
