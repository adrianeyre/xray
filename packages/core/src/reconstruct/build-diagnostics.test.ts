import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBuildDiagnostics } from "./build-diagnostics.js";

// Paths are made with this OS's separators, as `dotnet build` prints them.
const solution = join("/", "tmp", "out");
const project = join(solution, "App", "App.csproj");
const program = join(solution, "App", "Program.cs");

describe("parseBuildDiagnostics", () => {
  it("maps a compiler error to its file, line and column in the Recovered Solution, once", () => {
    const error = `${program}(2,7): error CS0246: The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?) [${project}]`;
    // What `dotnet build` prints: the error as it happens, then in its summary.
    const output = [
      "  Determining projects to restore...",
      `  Restored ${project} (in 55 ms).`,
      error,
      "",
      "Build FAILED.",
      "",
      error,
      "    0 Warning(s)",
      "    1 Error(s)",
      "",
      "Time Elapsed 00:00:00.80",
    ].join("\n");

    expect(parseBuildDiagnostics(output, solution)).toEqual([
      {
        severity: "error",
        code: "CS0246",
        message:
          "The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
        file: "App/Program.cs",
        line: 2,
        column: 7,
        project: "App/App.csproj",
      },
    ]);
  });

  it("keeps errors and warnings in the order they were printed, with Windows line endings", () => {
    const output = [
      `${program}(9,21): warning CS8600: Converting null literal or possible null value to non-nullable type. [${project}]`,
      `${program}(10,3): error CS1002: ; expected [${project}]`,
      `${program}(10,3): error CS1002: ; expected [${project}]`,
    ].join("\r\n");

    expect(parseBuildDiagnostics(output, solution)).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "CS8600",
        file: "App/Program.cs",
        line: 9,
        column: 21,
      }),
      expect.objectContaining({
        severity: "error",
        code: "CS1002",
        message: "; expected",
        line: 10,
        column: 3,
      }),
    ]);
  });

  it.each([
    ["(12)", { line: 12 }],
    ["(12-14)", { line: 12 }],
    ["(12,5-9)", { line: 12, column: 5 }],
    ["(12,5,14,9)", { line: 12, column: 5 }],
  ])("reads the location %s", (location, expected) => {
    const [diagnostic] = parseBuildDiagnostics(
      `${program}${location}: error CS0001: Broken. [${project}]`,
      solution,
    );

    expect(diagnostic).toEqual({
      severity: "error",
      code: "CS0001",
      message: "Broken.",
      file: "App/Program.cs",
      project: "App/App.csproj",
      ...expected,
    });
  });

  it("maps a file reached through another path to the same folder", () => {
    const real = join("/", "private", "tmp", "out");

    const [diagnostic] = parseBuildDiagnostics(
      `${join(real, "App", "Program.cs")}(3,1): error CS1022: Type or namespace definition, or end-of-file expected [${join(real, "App", "App.csproj")}]`,
      solution,
      [real],
    );

    expect(diagnostic).toMatchObject({
      file: "App/Program.cs",
      project: "App/App.csproj",
    });
  });

  it("keeps a file outside the Recovered Solution as printed", () => {
    const targets = join(
      "/",
      "usr",
      "share",
      "dotnet",
      "sdk",
      "8.0.425",
      "Microsoft.NET.TargetFrameworkInference.targets",
    );

    const [diagnostic] = parseBuildDiagnostics(
      `${targets}(166,5): error NETSDK1045: The current .NET SDK does not support targeting .NET 99.0. [${project}]`,
      solution,
    );

    expect(diagnostic).toEqual({
      severity: "error",
      code: "NETSDK1045",
      message: "The current .NET SDK does not support targeting .NET 99.0.",
      file: targets,
      line: 166,
      column: 5,
      project: "App/App.csproj",
    });
  });

  it("maps a file without a location, such as a project restore failed for", () => {
    const [diagnostic] = parseBuildDiagnostics(
      `${project} : error NU1101: Unable to find package Missing. No packages exist with this id in source(s): nuget.org [${join(solution, "App.sln")}]`,
      solution,
    );

    expect(diagnostic).toEqual({
      severity: "error",
      code: "NU1101",
      message:
        "Unable to find package Missing. No packages exist with this id in source(s): nuget.org",
      file: "App/App.csproj",
      project: "App.sln",
    });
  });

  it("names no file for a diagnostic from a tool", () => {
    expect(
      parseBuildDiagnostics(
        [
          "MSBUILD : error MSB1009: Project file does not exist.",
          "CSC : warning CS2008: No source files specified.",
          "error : Something went wrong.",
        ].join("\n"),
        solution,
      ),
    ).toEqual([
      {
        severity: "error",
        code: "MSB1009",
        message: "Project file does not exist.",
      },
      {
        severity: "warning",
        code: "CS2008",
        message: "No source files specified.",
      },
      { severity: "error", code: "", message: "Something went wrong." },
    ]);
  });

  it("reads a Windows path, its drive's colon and all", () => {
    const [diagnostic] = parseBuildDiagnostics(
      String.raw`C:\Elsewhere\App\Program.cs(4,9): error CS0103: The name 'Greeter' does not exist in the current context [C:\Elsewhere\App\App.csproj]`,
      solution,
    );

    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "CS0103",
      message: "The name 'Greeter' does not exist in the current context",
      line: 4,
      column: 9,
    });
    expect(diagnostic?.file).toMatch(/Program\.cs$/);
  });

  it("leaves a message's own brackets alone", () => {
    const [diagnostic] = parseBuildDiagnostics(
      `${program}(1,1): error CS0001: Expected [x]`,
      solution,
    );

    expect(diagnostic).toMatchObject({ message: "Expected [x]" });
    expect(diagnostic).not.toHaveProperty("project");
  });

  it("finds nothing in a build that reported nothing", () => {
    expect(
      parseBuildDiagnostics(
        [
          `  App -> ${join(solution, "App", "bin", "Debug", "net8.0", "App.dll")}`,
          "",
          "Build succeeded.",
          "    0 Warning(s)",
          "    0 Error(s)",
        ].join("\n"),
        solution,
      ),
    ).toEqual([]);
  });
});
