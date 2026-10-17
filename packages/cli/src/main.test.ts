import {
  InputError,
  ReconstructionError,
  type AssemblySummary,
  type BuildDiagnostic,
  type DoctorReport,
  type Inspection,
  type ProgramRun,
  type ProgressEvent,
  type Reconstruction,
  type RecoveredProject,
} from "@xray/core";
import { DEFAULT_PORT, ServerError, type XrayServer } from "@xray/server";
import { describe, expect, it } from "vitest";

import {
  ExitCode,
  main,
  RUN_WARNING,
  USAGE,
  type Commands,
  type ReconstructCommandOptions,
} from "./main.js";
import type { BrowserLaunch } from "./ui.js";

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly doctorRuns: number;
  readonly inspected: readonly string[];
  readonly reconstructed: readonly ReconstructCall[];
}

interface ReconstructCall {
  readonly path: string;
  readonly outputDirectory: string;
  readonly force: boolean;
  readonly build: boolean;
  readonly run: boolean;
  readonly siblings: boolean;
  readonly offline: boolean;
}

async function run(
  argv: string[],
  report: DoctorReport = passing,
  inspectWith: (path: string) => Promise<Inspection> = managed,
  reconstructWith: (
    path: string,
    options: ReconstructCommandOptions,
  ) => Promise<Reconstruction> = reconstructed("full"),
  stderrColumns?: number,
): Promise<Run> {
  let stdout = "";
  let stderr = "";
  let doctorRuns = 0;
  const inspected: string[] = [];
  const reconstructCalls: ReconstructCall[] = [];
  const commands: Commands = {
    inspect: (path) => {
      inspected.push(path);
      return inspectWith(path);
    },
    reconstruct: (path, outputDirectory, options) => {
      const { force, build, run, siblings, offline } = options;
      reconstructCalls.push({
        path,
        outputDirectory,
        force,
        build,
        run,
        siblings,
        offline,
      });
      return reconstructWith(path, options);
    },
    doctor: () => {
      doctorRuns++;
      return Promise.resolve(report);
    },
    ui: () => Promise.reject(new Error("Not expected to start the UI.")),
    openBrowser: () =>
      Promise.reject(new Error("Not expected to open a browser.")),
    listenForStop: () => {
      throw new Error("Not expected to listen for signals.");
    },
  };
  const code = await main(
    argv,
    {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      stderrColumns: () => stderrColumns,
    },
    commands,
  );
  return {
    code,
    stdout,
    stderr,
    doctorRuns,
    inspected,
    reconstructed: reconstructCalls,
  };
}

/** Not a Managed Assembly: what inspect and reconstruct both answer. */
function rejectedAs(
  kind: "native-executable" | "not-pe",
  explanation: string,
): (path: string) => Promise<Inspection & Reconstruction> {
  return (path) =>
    Promise.resolve({
      accepted: false,
      classification: {
        path: `/abs/${path}`,
        kind,
        accepted: false,
        explanation,
      },
    });
}

const summary: AssemblySummary = {
  path: "/abs/MyApp.dll",
  assembly: {
    name: "MyApp",
    version: "2.0.0.0",
    culture: null,
    publicKeyToken: null,
  },
  targetFramework: {
    moniker: "net8.0",
    frameworkName: ".NETCoreApp,Version=v8.0",
    runtimeVersion: "v4.0.30319",
    inferredFrom: null,
    support: "full",
  },
  architecture: {
    platformTarget: "AnyCPU",
    prefer32Bit: false,
    bitness: "any",
    machine: "I386",
  },
  entryPoint: { type: "MyApp.Program", method: "Main" },
  outputKind: "console",
  references: [
    {
      name: "System.Runtime",
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
  ],
  counts: { types: 3, methods: 12, resources: 1 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};

const managed = (path: string): Promise<Inspection> =>
  Promise.resolve({
    accepted: true,
    classification: {
      path: `/abs/${path}`,
      kind: "managed-assembly",
      accepted: true,
      explanation: `"${path}" is a Managed Assembly.`,
    },
    summary,
  });

const missingSemicolon: BuildDiagnostic = {
  severity: "error",
  code: "CS1002",
  message: "; expected",
  file: "MyApp/Program.cs",
  line: 3,
  column: 9,
  project: "MyApp/MyApp.csproj",
};

const unknownName: BuildDiagnostic = {
  severity: "error",
  code: "CS0103",
  message: "The name 'Greeter' does not exist in the current context",
  file: "MyApp/Program.cs",
  line: 7,
  column: 21,
  project: "MyApp/MyApp.csproj",
};

const restoreFailed: BuildDiagnostic = {
  severity: "error",
  code: "MSB4025",
  message: "The project file could not be loaded.",
};

const nullable: BuildDiagnostic = {
  severity: "warning",
  code: "CS8600",
  message:
    "Converting null literal or possible null value to non-nullable type.",
  file: "MyApp/Program.cs",
  line: 5,
  column: 13,
  project: "MyApp/MyApp.csproj",
};

function reconstructed(
  outcome: "full" | "partial" | "unverified",
  errors: readonly BuildDiagnostic[] = [missingSemicolon],
  run: ProgramRun | null = null,
): (path: string) => Promise<Reconstruction> {
  return (path) =>
    Promise.resolve({
      accepted: true,
      classification: {
        path: `/abs/${path}`,
        kind: "managed-assembly",
        accepted: true,
        explanation: `"${path}" is a Managed Assembly.`,
      },
      summary,
      solution: {
        directory: "/abs/out",
        solutionPath: "MyApp.sln",
        projectPath: "MyApp/MyApp.csproj",
        targetFramework: "net8.0",
        outputType: "Exe",
        files: [
          "MyApp.sln",
          "MyApp/MyApp.csproj",
          "MyApp/Properties/AssemblyInfo.cs",
          "MyApp/Program.cs",
          "xray-report.json",
        ],
        reportPath: "xray-report.json",
        typeCount: 3,
        sourceFileCount: 3,
        projects: [
          {
            assemblyPath: `/abs/${path}`,
            assemblyName: "MyApp",
            projectPath: "MyApp/MyApp.csproj",
            targetFramework: "net8.0",
            outputType: "Exe",
            typeCount: 3,
            sourceFileCount: 3,
            pdb: { status: "none" },
            obfuscation: { status: "clean", indicators: [] },
            projectReferences: [],
            packageReferences: [],
            binaryReferences: [],
            resources: [],
          },
        ],
      },
      build:
        outcome === "unverified"
          ? null
          : outcome === "full"
            ? {
                succeeded: true,
                output: "Build succeeded.\n",
                diagnostics: [nullable],
              }
            : {
                succeeded: false,
                output:
                  errors.length === 0
                    ? "The build did not finish within 600000 ms, so it was stopped."
                    : "/abs/out/MyApp/Program.cs(3,9): error CS1002: ; expected\nBuild FAILED.",
                diagnostics: [nullable, ...errors],
              },
      run,
      outcome,
      reasons:
        outcome !== "partial"
          ? []
          : run !== null && run.status !== "skipped"
            ? [{ kind: "run-failed" }]
            : [{ kind: "build-failed", errors }],
      siblings: true,
      siblingProblems: [],
      offline: false,
      packages: [],
      dependencies: [
        {
          reference: {
            name: "System.Runtime",
            version: "8.0.0.0",
            culture: null,
            publicKeyToken: "b03f5f7f11d50a3a",
          },
          referencedBy: ["MyApp"],
          resolution: "framework",
          package: null,
          projectPath: null,
          copiedTo: null,
          path: null,
          reason: "System.Runtime is signed with one of Microsoft's keys …",
        },
      ],
      warnings: [],
      timings: {
        analyse: 42,
        decompile: 1_234,
        resolveDependencies: 3,
        generate: 7,
        build: outcome === "unverified" ? null : 2_500,
        run: run === null || run.status === "skipped" ? null : 120,
        total: outcome === "unverified" ? 1_283 : 3_783,
      },
    });
}

const passing: DoctorReport = {
  passed: true,
  checks: [{ id: "node", title: "Node.js", passed: true, summary: "26.10.0" }],
};

const failing: DoctorReport = {
  passed: false,
  checks: [
    { id: "node", title: "Node.js", passed: true, summary: "26.10.0" },
    {
      id: "dotnet-sdk",
      title: ".NET SDK",
      passed: false,
      summary: "Only .NET SDK 7.0.410 is installed; Xray needs 8 or later.",
      fix: "Install the .NET SDK 8 or later from https://dot.net.",
    },
  ],
};

describe("xray inspect", () => {
  it("prints the metadata summary of a Managed Assembly and exits 0", async () => {
    expect(await run(["inspect", "MyApp.dll"])).toEqual({
      code: ExitCode.ok,
      stdout: [
        "File              /abs/MyApp.dll",
        "Assembly          MyApp, Version=2.0.0.0, Culture=neutral, PublicKeyToken=null",
        "Target framework  net8.0 (.NETCoreApp,Version=v8.0)",
        "Architecture      AnyCPU (runs as 64-bit on a 64-bit OS, otherwise 32-bit)",
        "Entry point       MyApp.Program.Main",
        "Output kind       Console",
        "Types             3",
        "Methods           12",
        "Resources         1",
        "PDB               none beside it",
        "Obfuscation       clean: no sign of it found",
        "References        System.Runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
        "",
      ].join("\n"),
      stderr: "",
      doctorRuns: 0,
      inspected: ["MyApp.dll"],
      reconstructed: [],
    });
  });

  it.each([
    [["inspect", "--json", "MyApp.dll"]],
    [["inspect", "MyApp.dll", "--json"]],
  ])(
    "prints the summary as JSON with a schema version for %j",
    async (argv) => {
      const result = await run(argv);

      expect(result).toMatchObject({
        code: ExitCode.ok,
        stderr: "",
        inspected: ["MyApp.dll"],
      });
      expect(result.stdout).toBe(
        `${JSON.stringify({ schemaVersion: 1, ...summary }, null, 2)}\n`,
      );
    },
  );

  it.each([
    [
      "native-executable",
      '"hello.exe" is a Native Executable (x64 machine code).\nIt has no CLI header.',
    ],
    ["not-pe", '"notes.txt" is not a PE file.'],
  ] as const)(
    "rejects a %s with its explanation and a distinct exit code",
    async (kind, explanation) => {
      const result = await run(
        ["inspect", "input"],
        passing,
        rejectedAs(kind, explanation),
      );

      expect(result).toMatchObject({
        code: ExitCode.rejected,
        stdout: "",
        stderr: `${explanation}\n`,
      });
      expect([ExitCode.ok, ExitCode.failed, ExitCode.usage]).not.toContain(
        result.code,
      );
    },
  );

  it("rejects input that is not a Managed Assembly the same way with --json", async () => {
    const explanation = '"hello.exe" is a Native Executable.';

    expect(
      await run(
        ["inspect", "--json", "hello.exe"],
        passing,
        rejectedAs("native-executable", explanation),
      ),
    ).toMatchObject({
      code: ExitCode.rejected,
      stdout: "",
      stderr: `${explanation}\n`,
    });
  });

  it("reports a file it cannot read, and exits 1", async () => {
    const result = await run(["inspect", "missing.dll"], passing, () =>
      Promise.reject(
        new InputError("not-found", "There is no file at /abs/missing.dll."),
      ),
    );

    expect(result).toMatchObject({
      code: ExitCode.failed,
      stdout: "",
      stderr: "There is no file at /abs/missing.dll.\n",
    });
  });

  it.each([
    [["inspect"], '"xray inspect" takes one Assembly, but was given none.'],
    [
      ["inspect", "a.dll", "b.dll"],
      '"xray inspect" takes one Assembly, but was given a.dll b.dll.',
    ],
    [
      ["inspect", "--json"],
      '"xray inspect" takes one Assembly, but was given none.',
    ],
    [["inspect", "--json=yes", "a.dll"], "--json"],
  ])("reports a usage error for %j", async (argv, message) => {
    const result = await run(argv);

    expect(result).toMatchObject({
      code: ExitCode.usage,
      stdout: "",
      inspected: [],
    });
    expect(result.stderr).toContain(message);
  });
});

describe("xray reconstruct", () => {
  const fullReport = [
    "Recovered Solution  /abs/out",
    "Solution            MyApp.sln",
    "Project             MyApp/MyApp.csproj",
    "Target framework    net8.0",
    "Output type         Exe",
    "Types               3, each decompiled to a file of its own",
    "Resources           none",
    "PDB                 none beside the Assembly",
    "Obfuscation         clean: no sign of it found",
    "Dependencies        1 reference: 1 framework",
    "NuGet packages      none needed",
    "Sibling Assemblies  none found beside it",
    "Copied binaries     none",
    "Build               succeeded with 1 warning",
    "Time                3.8 s: analyse 42 ms, decompile 1.2 s, resolve dependencies 3 ms, generate 7 ms, build 2.5 s",
    "Outcome             Full Reconstruction",
    "Report              xray-report.json",
    "",
  ].join("\n");

  it.each([
    [["reconstruct", "MyApp.dll", "-o", "out"]],
    [["reconstruct", "-o", "out", "MyApp.dll"]],
    [["reconstruct", "MyApp.dll", "--output", "out"]],
    [["reconstruct", "MyApp.dll", "--output=out"]],
  ])("reports a Full Reconstruction and exits 0 for %j", async (argv) => {
    expect(await run(argv)).toEqual({
      code: ExitCode.ok,
      stdout: fullReport,
      stderr: "",
      doctorRuns: 0,
      inspected: [],
      reconstructed: [
        {
          path: "MyApp.dll",
          outputDirectory: "out",
          force: false,
          build: true,
          run: false,
          siblings: true,
          offline: false,
        },
      ],
    });
  });

  /** Tells the CLI of `events`, then reconstructs as `then` does. */
  function progressing(
    events: readonly ProgressEvent[],
    then: (path: string) => Promise<Reconstruction> = reconstructed("full"),
  ): (
    path: string,
    options: ReconstructCommandOptions,
  ) => Promise<Reconstruction> {
    return (path, { onProgress }) => {
      events.forEach(onProgress);
      return then(path);
    };
  }

  const decompiling: ProgressEvent[] = [
    { kind: "stage-started", stage: "decompile", elapsedMs: 40 },
    {
      kind: "stage-progress",
      stage: "decompile",
      elapsedMs: 290,
      done: 1,
      total: 3,
      current: "MyApp.Models.Point",
    },
    {
      kind: "stage-finished",
      stage: "decompile",
      elapsedMs: 1_240,
      durationMs: 1_200,
    },
    {
      kind: "stage-skipped",
      stage: "resolve-dependencies",
      elapsedMs: 1_241,
      reason: "Not yet.",
    },
  ];

  it("shows each stage's progress on stderr, as plain lines when it is not a terminal", async () => {
    expect(
      await run(
        ["reconstruct", "MyApp.dll", "-o", "out"],
        passing,
        managed,
        progressing(decompiling),
      ),
    ).toMatchObject({
      code: ExitCode.ok,
      stdout: fullReport,
      stderr: [
        "[2/6] Decompile…",
        "[2/6] Decompile: done in 1.2 s",
        "[3/6] Resolve dependencies: skipped. Not yet.",
        "",
      ].join("\n"),
    });
  });

  it("shows each stage's progress on one line, rewritten in place, on a terminal", async () => {
    expect(
      await run(
        ["reconstruct", "MyApp.dll", "-o", "out"],
        passing,
        managed,
        progressing(decompiling),
        80,
      ),
    ).toMatchObject({
      code: ExitCode.ok,
      stdout: fullReport,
      stderr: [
        "\r\x1b[2K[2/6] Decompile…",
        "\r\x1b[2K[2/6] Decompile: 1 of 3 types (MyApp.Models.Point), 250 ms so far",
        "\r\x1b[2K[2/6] Decompile: done in 1.2 s\n",
        "\r\x1b[2K[3/6] Resolve dependencies: skipped. Not yet.\n",
      ].join(""),
    });
  });

  it("shows which stage failed, then why", async () => {
    const message = "The Xray engine exited unexpectedly (exit code 134).";

    expect(
      await run(
        ["reconstruct", "MyApp.dll", "-o", "out"],
        passing,
        managed,
        progressing(
          [
            { kind: "stage-started", stage: "decompile", elapsedMs: 40 },
            {
              kind: "stage-failed",
              stage: "decompile",
              elapsedMs: 90,
              durationMs: 50,
              message,
            },
          ],
          () => Promise.reject(new Error(message)),
        ),
      ),
    ).toMatchObject({
      code: ExitCode.failed,
      stdout: "",
      stderr: `[2/6] Decompile…\n[2/6] Decompile: failed after 50 ms\n${message}\n`,
    });
  });

  it("passes --force on", async () => {
    expect(
      (await run(["reconstruct", "MyApp.dll", "-o", "out", "--force"]))
        .reconstructed,
    ).toEqual([
      {
        path: "MyApp.dll",
        outputDirectory: "out",
        force: true,
        build: true,
        run: false,
        siblings: true,
        offline: false,
      },
    ]);
  });

  it("passes --no-siblings on, and says Sibling Assemblies were not reconstructed", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out", "--no-siblings"],
      passing,
      managed,
      async (path, options) => {
        const reconstruction = await reconstructed("full")(path);
        return reconstruction.accepted
          ? { ...reconstruction, siblings: options.siblings }
          : reconstruction;
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: fullReport.replace(
        "Sibling Assemblies  none found beside it",
        "Sibling Assemblies  not reconstructed (--no-siblings)",
      ),
      reconstructed: [
        {
          path: "MyApp.dll",
          outputDirectory: "out",
          force: false,
          build: true,
          run: false,
          siblings: false,
          offline: false,
        },
      ],
    });
  });

  it("passes --offline on, and says only the global-packages cache was looked in", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out", "--offline"],
      passing,
      managed,
      async (path, options) => {
        const reconstruction = await reconstructed("full")(path);
        return reconstruction.accepted
          ? { ...reconstruction, offline: options.offline }
          : reconstruction;
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: fullReport.replace(
        "NuGet packages      none needed",
        "NuGet packages      none needed (--offline: only the global-packages cache was looked in)",
      ),
      reconstructed: [
        {
          path: "MyApp.dll",
          outputDirectory: "out",
          force: false,
          build: true,
          run: false,
          siblings: true,
          offline: true,
        },
      ],
    });
  });

  it("counts how each reference was resolved, and lists each binary copied into Dependencies, and where it was found", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const copied = (name: string) => ({
          reference: {
            name,
            version: "2.3.1.0",
            culture: null,
            publicKeyToken: "51ca75d1f3633191",
          },
          referencedBy: ["MyApp"],
          resolution: "copied-binary" as const,
          package: null,
          projectPath: null,
          copiedTo: `Dependencies/${name}.dll`,
          path: `/abs/${name}.dll`,
          reason: "It is a third party's.",
        });
        return {
          ...reconstruction,
          dependencies: [
            copied("Kestrelwood.Checksums"),
            ...reconstruction.dependencies,
            copied("Kestrelwood.Fonts"),
          ],
        };
      },
    );

    expect(result.code).toBe(ExitCode.ok);
    expect(result.stdout).toBe(
      fullReport
        .replace(
          "Dependencies        1 reference: 1 framework\n",
          "Dependencies        3 references: 1 framework, 2 copied binaries\n",
        )
        .replace(
          "Copied binaries     none\n",
          [
            "Copied binaries     2, each referenced with a HintPath:",
            "                    Dependencies/Kestrelwood.Checksums.dll, from /abs/Kestrelwood.Checksums.dll",
            "                    Dependencies/Kestrelwood.Fonts.dll, from /abs/Kestrelwood.Fonts.dll",
            "",
          ].join("\n"),
        ),
    );
  });

  it("names each Unresolved Dependency, who makes it and why nothing satisfies it, as why it is Partial, before the build errors, and exits 4, even unbuilt", async () => {
    const greetings = {
      reference: {
        name: "Greetings",
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      referencedBy: ["MyApp", "Pricing"],
      resolution: "unresolved" as const,
      package: null,
      projectPath: null,
      copiedTo: null,
      path: null,
      reason:
        "No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
    };
    const unresolvedIn =
      (outcome: "partial" | "unverified") =>
      async (path: string): Promise<Reconstruction> => {
        const reconstruction = await reconstructed(outcome)(path);
        return reconstruction.accepted
          ? {
              ...reconstruction,
              outcome: "partial",
              reasons: [
                { kind: "unresolved-dependencies", dependencies: [greetings] },
                ...reconstruction.reasons,
              ],
              dependencies: [greetings, ...reconstruction.dependencies],
            }
          : reconstruction;
      };
    const unresolved = [
      "Partial, because nothing satisfies this reference, an Unresolved Dependency:",
      "  Greetings 1.0.0.0, referenced by MyApp, Pricing. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
    ].join("\n");

    const built = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      unresolvedIn("partial"),
    );
    const unbuilt = await run(
      ["reconstruct", "MyApp.dll", "-o", "out", "--no-build"],
      passing,
      managed,
      unresolvedIn("unverified"),
    );

    expect(built.code).toBe(ExitCode.partial);
    expect(built.stdout).toContain(
      "Dependencies        2 references: 1 framework, 1 unresolved\n",
    );
    expect(built.stdout).toContain(
      `\n\n${unresolved}\n\nPartial, because the Recovered Solution did not build:\n`,
    );
    expect(unbuilt.code).toBe(ExitCode.partial);
    expect(unbuilt.stdout).toContain(
      "Outcome             Partial Reconstruction\n",
    );
    expect(unbuilt.stdout.endsWith(`\n\n${unresolved}\n`)).toBe(true);
  });

  it("lists each NuGet package referenced, where it was found, and why one was chosen of several", async () => {
    const reference = (name: string, version: string, token: string) => ({
      name,
      version,
      culture: null,
      publicKeyToken: token,
    });
    const candidate = (
      id: string,
      version: string,
      source: "global-packages" | "nuget.org",
    ) => ({
      id,
      version,
      source,
      file: `lib/netstandard2.0/${id}.dll`,
      matchesCopyBeside: false,
    });
    const why =
      "2 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.3, 13.0.1. 13.0.3 is chosen, as it is the highest.";
    const newtonsoft = candidate(
      "Newtonsoft.Json",
      "13.0.3",
      "global-packages",
    );
    const serilog = candidate("Serilog", "3.1.1", "nuget.org");
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        return reconstruction.accepted
          ? {
              ...reconstruction,
              packages: [
                {
                  reference: reference(
                    "Newtonsoft.Json",
                    "13.0.0.0",
                    "30ad4fe6b2a6aeed",
                  ),
                  referencedBy: ["MyApp"],
                  package: newtonsoft,
                  candidates: [
                    newtonsoft,
                    candidate("Newtonsoft.Json", "13.0.1", "global-packages"),
                  ],
                  searched: ["global-packages"],
                  reason: why,
                },
                {
                  reference: reference(
                    "Serilog",
                    "2.0.0.0",
                    "24c2f752a8e58a10",
                  ),
                  referencedBy: ["MyApp"],
                  package: serilog,
                  candidates: [serilog],
                  searched: ["global-packages", "nuget.org"],
                  reason: "Serilog 3.1.1, on nuget.org, holds …",
                },
              ],
            }
          : reconstruction;
      },
    );

    expect(result.code).toBe(ExitCode.ok);
    expect(result.stdout).toBe(
      fullReport
        .replace(
          "NuGet packages      none needed\n",
          [
            "NuGet packages      2, each a PackageReference:",
            "                    Newtonsoft.Json 13.0.3, from the global-packages cache",
            "                    Serilog 3.1.1, from nuget.org",
            "",
          ].join("\n"),
        )
        .replace(/\n$/, `\n\nChosen among several NuGet packages:\n  ${why}\n`),
    );
  });

  it("counts WPF resources recovered as XAML among a project's resources, warning on stderr where they were not", async () => {
    const message =
      "The WPF resources of MyApp.dll were not recovered as XAML: MyApp.g.resources's BAML was not decompiled.";
    const result = await run(
      ["reconstruct", "app", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const [main] = reconstruction.solution.projects;
        return {
          ...reconstruction,
          solution: {
            ...reconstruction.solution,
            projects: [
              {
                ...(main as RecoveredProject),
                resources: [
                  {
                    name: "MyApp.g.resources",
                    culture: null,
                    public: true,
                    recoveredAs: "xaml",
                    path: null,
                    reason: null,
                  },
                  {
                    name: "MyApp.Strings.resources",
                    culture: null,
                    public: true,
                    recoveredAs: "resx",
                    path: "MyApp/Strings.resx",
                    reason: null,
                  },
                ],
              },
            ],
          },
          warnings: [
            {
              kind: "xaml-not-recovered",
              assemblyPath: "/abs/MyApp.dll",
              message,
            },
          ],
        };
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: expect.stringContaining(
        "Resources           2, each under its own name: 1 recovered as XAML, 1 written as .resx\n",
      ) as unknown,
      stderr: `Warning: ${message}\n`,
    });
  });

  it("counts what became of each project's resources, one project to a line, warning on stderr of one not recovered", async () => {
    const message =
      "Inventory.Big.bin, a resource of Inventory.dll, was not recovered. It is not embedded in the Assembly, but in the file Big.bin, which Xray does not recover, so the rebuilt Assembly has no resource of that name.";
    const result = await run(
      ["reconstruct", "app", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const [main] = reconstruction.solution.projects;
        return {
          ...reconstruction,
          solution: {
            ...reconstruction.solution,
            projects: [
              main as RecoveredProject,
              {
                ...(main as RecoveredProject),
                assemblyPath: "/abs/Inventory.dll",
                assemblyName: "Inventory",
                projectPath: "Inventory/Inventory.csproj",
                resources: [
                  {
                    name: "Inventory.logo.png",
                    culture: null,
                    public: true,
                    recoveredAs: "file",
                    path: "Inventory/logo.png",
                    reason: null,
                  },
                  {
                    name: "Inventory.Big.bin",
                    culture: null,
                    public: true,
                    recoveredAs: "not-recovered",
                    path: null,
                    reason:
                      "It is not embedded in the Assembly, but in the file Big.bin, which Xray does not recover, so the rebuilt Assembly has no resource of that name.",
                  },
                  {
                    name: "Inventory.Strings.fr.resources",
                    culture: "fr",
                    public: true,
                    recoveredAs: "resx",
                    path: "Inventory/Strings.fr.resx",
                    reason: null,
                  },
                ],
              },
            ],
          },
          warnings: [
            {
              kind: "resource-not-recovered",
              assemblyPath: "/abs/Inventory.dll",
              message,
            },
          ],
        };
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: expect.stringContaining(
        [
          "Resources           MyApp/MyApp.csproj: none",
          "                    Inventory/Inventory.csproj: 3, each under its own name: 1 written as .resx, 1 embedded as it is, 1 not recovered; 1 satellite assembly (fr)",
          "",
        ].join("\n"),
      ) as unknown,
      stderr: `Warning: ${message}\n`,
    });
  });

  it("says how many files the types were decompiled to, and which PDB was used, warning on stderr of one that was ignored", async () => {
    const ignored = {
      status: "mismatched",
      path: "/abs/Inventory.pdb",
      format: "portable",
      reason: "Inventory.pdb, a portable PDB, is not Inventory.dll's own: …",
    } as const;
    const message =
      "Ignored the PDB beside Inventory.dll, /abs/Inventory.pdb. Inventory.pdb, a portable PDB, is not Inventory.dll's own: … So Inventory's local variables are named, and its source files laid out, as without a PDB.";
    const result = await run(
      ["reconstruct", "app", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const [main] = reconstruction.solution.projects;
        return {
          ...reconstruction,
          solution: {
            ...reconstruction.solution,
            sourceFileCount: 2,
            projects: [
              {
                ...(main as RecoveredProject),
                sourceFileCount: 2,
                pdb: {
                  status: "matching",
                  path: "/abs/MyApp.pdb",
                  format: "portable",
                },
              },
              {
                ...(main as RecoveredProject),
                assemblyPath: "/abs/Inventory.dll",
                assemblyName: "Inventory",
                projectPath: "Inventory/Inventory.csproj",
                pdb: ignored,
              },
            ],
          },
          warnings: [
            {
              kind: "pdb-ignored",
              assemblyPath: "/abs/Inventory.dll",
              pdbPath: "/abs/Inventory.pdb",
              message,
            },
          ],
        };
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: expect.stringContaining(
        [
          "Types               3, decompiled to 2 files",
          "Resources           none",
          "PDB                 MyApp/MyApp.csproj: /abs/MyApp.pdb, used for local names and source layout",
          "                    Inventory/Inventory.csproj: /abs/Inventory.pdb, ignored, as it is not the Assembly's own",
          "",
        ].join("\n"),
      ) as unknown,
      stderr: `Warning: ${message}\n`,
    });
  });

  it("says which Assembly is likely obfuscated, and that it was reconstructed as it is, warning of it on stderr", async () => {
    const obfuscation = {
      status: "obfuscated",
      indicators: [
        {
          kind: "mangled-identifiers",
          evidence: ["A", "a"],
          message: "79 of its 81 names (97%) are one or two characters long, …",
        },
        {
          kind: "encrypted-strings",
          evidence: ["S"],
          message: "Its strings are hidden: …",
        },
      ],
    } as const;
    const message =
      "Inventory.dll is likely obfuscated. 79 of its 81 names (97%) are one or two characters long, … Its strings are hidden: … It was reconstructed as it is, not deobfuscated: Inventory's names and strings are the obfuscator's.";
    const result = await run(
      ["reconstruct", "app", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const [main] = reconstruction.solution.projects;
        return {
          ...reconstruction,
          solution: {
            ...reconstruction.solution,
            projects: [
              main as RecoveredProject,
              {
                ...(main as RecoveredProject),
                assemblyPath: "/abs/Inventory.dll",
                assemblyName: "Inventory",
                projectPath: "Inventory/Inventory.csproj",
                obfuscation,
              },
            ],
          },
          warnings: [
            {
              kind: "obfuscated",
              assemblyPath: "/abs/Inventory.dll",
              message,
            } as const,
          ],
        };
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: expect.stringContaining(
        [
          "Obfuscation         MyApp/MyApp.csproj: clean: no sign of it found",
          "                    Inventory/Inventory.csproj: likely obfuscated (mangled names, hidden strings): reconstructed as it is, not deobfuscated",
          "Dependencies  ",
        ].join("\n"),
      ) as unknown,
      stderr: `Warning: ${message}\n`,
    });
  });

  it("lists the project of each Sibling Assembly, and what was worked around in them", async () => {
    const problems = [
      "2 Assemblies beside the input are named Inventory: /abs/Inventory.dll, /abs/Inventory.exe. Only /abs/Inventory.dll is reconstructed, as the runtime would load it.",
      "Pricing references Inventory references Pricing, a cycle projects cannot have. The reference from Inventory to Pricing is left out, so Inventory does not build.",
    ];
    const result = await run(
      ["reconstruct", "app", "-o", "out"],
      passing,
      managed,
      async (path) => {
        const reconstruction = await reconstructed("full")(path);
        if (!reconstruction.accepted) {
          return reconstruction;
        }
        const library = (name: string, typeCount: number) => ({
          assemblyPath: `/abs/${name}.dll`,
          assemblyName: name,
          projectPath: `${name}/${name}.csproj`,
          targetFramework: "net8.0",
          outputType: "Library" as const,
          typeCount,
          sourceFileCount: typeCount,
          pdb: { status: "none" } as const,
          obfuscation: { status: "clean", indicators: [] } as const,
          projectReferences: [],
          packageReferences: [],
          binaryReferences: [],
          resources: [],
        });
        return {
          ...reconstruction,
          solution: {
            ...reconstruction.solution,
            projects: [
              ...reconstruction.solution.projects,
              library("Inventory", 1),
              library("Pricing", 12),
            ],
          },
          siblingProblems: [
            {
              kind: "duplicate-assembly-name",
              name: "Inventory",
              paths: ["/abs/Inventory.dll", "/abs/Inventory.exe"],
              chosen: "/abs/Inventory.dll",
              message: problems[0] as string,
            },
            {
              kind: "cyclic-reference",
              cycle: ["Pricing", "Inventory", "Pricing"],
              omitted: { from: "Inventory", to: "Pricing" },
              message: problems[1] as string,
            },
          ],
        };
      },
    );

    expect(result).toMatchObject({
      code: ExitCode.ok,
      stdout: [
        fullReport
          .replace(
            "PDB                 none beside the Assembly\n",
            [
              "PDB                 MyApp/MyApp.csproj: none beside the Assembly",
              "                    Inventory/Inventory.csproj: none beside the Assembly",
              "                    Pricing/Pricing.csproj: none beside the Assembly",
              "",
            ].join("\n"),
          )
          .replace(
            "Obfuscation         clean: no sign of it found\n",
            [
              "Obfuscation         MyApp/MyApp.csproj: clean: no sign of it found",
              "                    Inventory/Inventory.csproj: clean: no sign of it found",
              "                    Pricing/Pricing.csproj: clean: no sign of it found",
              "",
            ].join("\n"),
          )
          .replace(
            "Sibling Assemblies  none found beside it\n",
            [
              "Sibling Assemblies  2, each a project of its own:",
              "                    Inventory/Inventory.csproj (1 type)",
              "                    Pricing/Pricing.csproj (12 types)",
              "",
            ].join("\n"),
          )
          .trimEnd(),
        "",
        "Worked around in the Sibling Assemblies:",
        ...problems.map((problem) => `  ${problem}`),
        "",
      ].join("\n"),
    });
  });

  it("reports a Partial Reconstruction with each build error at its file and line, and exits 4", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      reconstructed("partial", [missingSemicolon, unknownName, restoreFailed]),
    );

    expect(result).toMatchObject({
      code: ExitCode.partial,
      stdout: [
        ...fullReport
          .replace(
            "Build               succeeded with 1 warning",
            "Build               failed with 3 errors and 1 warning",
          )
          .replace(
            "Outcome             Full Reconstruction",
            "Outcome             Partial Reconstruction",
          )
          .split("\n")
          .slice(0, -1),
        "",
        "Partial, because the Recovered Solution did not build:",
        "  MyApp/Program.cs:3:9: error CS1002: ; expected",
        "  MyApp/Program.cs:7:21: error CS0103: The name 'Greeter' does not exist in the current context",
        "  error MSB4025: The project file could not be loaded.",
        "",
      ].join("\n"),
      // The diagnostics say it all, so the build's own output is not repeated.
      stderr: "",
    });
    expect(result.code).toBe(4);
    expect([
      ExitCode.ok,
      ExitCode.failed,
      ExitCode.usage,
      ExitCode.rejected,
    ]).not.toContain(result.code);
  });

  it("says one error, not one errors", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      reconstructed("partial"),
    );

    expect(result.stdout).toContain(
      "Build               failed with 1 error and 1 warning\n",
    );
  });

  it("lists only the first 10 build errors, pointing to the report for the rest", async () => {
    const errors = Array.from({ length: 13 }, (_, index): BuildDiagnostic => ({
      ...unknownName,
      line: index + 1,
    }));

    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      reconstructed("partial", errors),
    );

    expect(result.code).toBe(ExitCode.partial);
    expect(result.stdout).toContain(
      "Build               failed with 13 errors and 1 warning\n",
    );
    const listed = result.stdout.slice(
      result.stdout.indexOf("Partial, because"),
    );
    expect(listed).toBe(
      [
        "Partial, because the Recovered Solution did not build:",
        ...errors
          .slice(0, 10)
          .map(
            ({ line }) =>
              `  MyApp/Program.cs:${line}:21: error CS0103: The name 'Greeter' does not exist in the current context`,
          ),
        "  … and 3 more errors, listed in xray-report.json",
        "",
      ].join("\n"),
    );
  });

  it("shows the build's own output for a Partial Reconstruction whose build reported no error", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out"],
      passing,
      managed,
      reconstructed("partial", []),
    );

    expect(result).toMatchObject({
      code: ExitCode.partial,
      stderr: "The build did not finish within 600000 ms, so it was stopped.\n",
    });
    expect(result.stdout).toContain(
      "Build               failed with 1 warning\n",
    );
    expect(result.stdout).toContain(
      "Partial, because the Recovered Solution did not build, though `dotnet build` reported no error. Its output follows on stderr.\n",
    );
  });

  it("passes --no-build on, says verification was skipped, and exits 0", async () => {
    const result = await run(
      ["reconstruct", "MyApp.dll", "-o", "out", "--no-build"],
      passing,
      managed,
      reconstructed("unverified"),
    );

    expect(result).toEqual({
      code: ExitCode.ok,
      stdout: fullReport
        .replace(
          "Build               succeeded with 1 warning",
          "Build               skipped (--no-build), so the Recovered Solution was not verified",
        )
        .replace(
          "Time                3.8 s: analyse 42 ms, decompile 1.2 s, resolve dependencies 3 ms, generate 7 ms, build 2.5 s",
          "Time                1.3 s: analyse 42 ms, decompile 1.2 s, resolve dependencies 3 ms, generate 7 ms",
        )
        .replace(
          "Outcome             Full Reconstruction",
          "Outcome             Unverified: not built, so neither Full nor Partial",
        ),
      stderr: "",
      doctorRuns: 0,
      inspected: [],
      reconstructed: [
        {
          path: "MyApp.dll",
          outputDirectory: "out",
          force: false,
          build: false,
          run: false,
          siblings: true,
          offline: false,
        },
      ],
    });
  });

  describe("with --run", () => {
    const exited: ProgramRun = {
      status: "exited",
      reason: null,
      program: "MyApp/bin/Debug/net8.0/MyApp.dll",
      exitCode: 1,
      stdout: "",
      stderr: "Usage: MyApp <name>\n",
    };

    it("warns that it executes recovered code, passes --run on, and shows the exit code", async () => {
      const result = await run(
        ["reconstruct", "MyApp.dll", "-o", "out", "--run"],
        passing,
        managed,
        reconstructed("full", [], exited),
      );

      expect(result).toEqual({
        code: ExitCode.ok,
        stdout: fullReport
          .replace(
            "Build               succeeded with 1 warning\n",
            "Build               succeeded with 1 warning\nRun                 exited with code 1\n",
          )
          .replace("build 2.5 s", "build 2.5 s, run 120 ms"),
        stderr: RUN_WARNING,
        doctorRuns: 0,
        inspected: [],
        reconstructed: [
          {
            path: "MyApp.dll",
            outputDirectory: "out",
            force: false,
            build: true,
            run: true,
            siblings: true,
            offline: false,
          },
        ],
      });
      expect(RUN_WARNING).toBe(
        "Warning: --run executes recovered code. Once the Recovered Solution builds, its program runs on this machine, as you.\n",
      );
    });

    it("warns before anything else on stderr, the progress included", async () => {
      const { stderr } = await run(
        ["reconstruct", "MyApp.dll", "-o", "out", "--run"],
        passing,
        managed,
        progressing(decompiling, reconstructed("full", [], exited)),
      );

      expect(stderr.startsWith(`${RUN_WARNING}[2/6] Decompile…\n`)).toBe(true);
    });

    it("shows why the program was skipped", async () => {
      const reason =
        "It is a WinForms program, and WinForms runs only on Windows, not on Linux.";
      const { code, stdout } = await run(
        ["reconstruct", "MyApp.dll", "-o", "out", "--run"],
        passing,
        managed,
        reconstructed("full", [], {
          status: "skipped",
          reason,
          program: null,
          exitCode: null,
          stdout: null,
          stderr: null,
        }),
      );

      expect(code).toBe(ExitCode.ok);
      expect(stdout).toContain(`\nRun                 skipped. ${reason}\n`);
      expect(stdout).toContain(
        "Time                3.8 s: analyse 42 ms, decompile 1.2 s, resolve dependencies 3 ms, generate 7 ms, build 2.5 s\n",
      );
    });

    it("shows a GUI program that launched", async () => {
      const { stdout } = await run(
        ["reconstruct", "MyApp.dll", "-o", "out", "--run"],
        passing,
        managed,
        reconstructed("full", [], {
          ...exited,
          status: "launched",
          exitCode: null,
        }),
      );

      expect(stdout).toContain(
        "\nRun                 launched, and was closed while still running\n",
      );
    });

    it.each([
      [
        "crashed",
        "crashed",
        "It was ended by SIGABRT, as .NET ends a program that throws an unhandled exception.",
      ],
      [
        "timed-out",
        "timed out",
        "It did not exit within 60000 ms, so it was stopped.",
      ],
      [
        "failed-to-start",
        "failed to start",
        "There is no program at MyApp/bin/Debug/net8.0/MyApp.dll, where `dotnet build` should have put it.",
      ],
    ] as const)(
      "reports a program that %s as a Partial Reconstruction, and exits 4",
      async (status, said, reason) => {
        const result = await run(
          ["reconstruct", "MyApp.dll", "-o", "out", "--run"],
          passing,
          managed,
          reconstructed("partial", [], {
            ...exited,
            status,
            reason,
            exitCode: null,
          }),
        );

        expect(result).toMatchObject({
          code: ExitCode.partial,
          stderr: RUN_WARNING,
        });
        expect(result.stdout).toContain(
          `\nRun                 ${said}. ${reason}\n`,
        );
        expect(result.stdout).toContain(
          "\nOutcome             Partial Reconstruction\n",
        );
        expect(result.stdout).toMatch(
          new RegExp(
            `\n\nPartial, because the rebuilt program ${said}\\. What it wrote is in xray-report\\.json, as run\\.stdout and run\\.stderr\\.\n$`,
          ),
        );
      },
    );

    it("does not warn without --run", async () => {
      const { stderr } = await run(["reconstruct", "MyApp.dll", "-o", "out"]);

      expect(stderr).toBe("");
    });
  });

  it("rejects input that is not a Managed Assembly with its explanation, and exits 3", async () => {
    const explanation = '"hello.exe" is a Native Executable.';

    expect(
      await run(
        ["reconstruct", "hello.exe", "-o", "out"],
        passing,
        managed,
        rejectedAs("native-executable", explanation),
      ),
    ).toMatchObject({
      code: ExitCode.rejected,
      stdout: "",
      stderr: `${explanation}\n`,
    });
  });

  it("explains an output directory it will not write to, and exits 1", async () => {
    const message =
      "/abs/out is not empty. Choose an empty or new folder, or pass --force to replace what is in it.";

    expect(
      await run(
        ["reconstruct", "MyApp.dll", "-o", "out"],
        passing,
        managed,
        () =>
          Promise.reject(new ReconstructionError("output-not-empty", message)),
      ),
    ).toMatchObject({
      code: ExitCode.failed,
      stdout: "",
      stderr: `${message}\n`,
    });
  });

  it.each([
    [
      ["reconstruct", "-o", "out"],
      '"xray reconstruct" takes one Assembly or folder, but was given none.',
    ],
    [
      ["reconstruct", "a.dll", "b.dll", "-o", "out"],
      '"xray reconstruct" takes one Assembly or folder, but was given a.dll b.dll.',
    ],
    [
      ["reconstruct", "a.dll"],
      '"xray reconstruct" needs -o <dir>: the folder to write the Recovered Solution to.',
    ],
    [
      ["reconstruct", "a.dll", "-o", ""],
      '"xray reconstruct" needs -o <dir>: the folder to write the Recovered Solution to.',
    ],
    [["reconstruct", "a.dll", "-o"], "-o"],
    [
      ["reconstruct", "a.dll", "-o", "out", "--json"],
      '"xray reconstruct" does not take --json.',
    ],
    [
      ["inspect", "a.dll", "-o", "out"],
      '"xray inspect" does not take --output.',
    ],
    [["inspect", "a.dll", "--force"], '"xray inspect" does not take --force.'],
    [["doctor", "--force"], '"xray doctor" does not take --force.'],
    [
      ["inspect", "a.dll", "--no-build"],
      '"xray inspect" does not take --no-build.',
    ],
    [["doctor", "--no-build"], '"xray doctor" does not take --no-build.'],
    [["inspect", "a.dll", "--run"], '"xray inspect" does not take --run.'],
    [["doctor", "--run"], '"xray doctor" does not take --run.'],
    [
      ["inspect", "a.dll", "--no-siblings"],
      '"xray inspect" does not take --no-siblings.',
    ],
    [["doctor", "--no-siblings"], '"xray doctor" does not take --no-siblings.'],
    [
      ["reconstruct", "a.dll", "-o", "out", "--no-siblings=yes"],
      "--no-siblings",
    ],
    [
      ["inspect", "a.dll", "--offline"],
      '"xray inspect" does not take --offline.',
    ],
    [["doctor", "--offline"], '"xray doctor" does not take --offline.'],
    [["reconstruct", "a.dll", "-o", "out", "--offline=yes"], "--offline"],
    [
      ["reconstruct", "a.dll", "-o", "out", "--run", "--no-build"],
      "--run runs the program the Recovered Solution builds to, so it cannot be given with --no-build.",
    ],
  ])("reports a usage error for %j", async (argv, message) => {
    const result = await run(argv);

    expect(result).toMatchObject({
      code: ExitCode.usage,
      stdout: "",
      inspected: [],
      reconstructed: [],
    });
    expect(result.stderr).toContain(message);
  });
});

interface UiRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** What happened, in order. */
  readonly events: readonly string[];
}

/**
 * Runs `xray` with fakes for `xray ui`: a server that starts as `startWith`
 * says, or at once, a browser that opens as `launch` says, and a Ctrl+C as soon as Xray
 * waits for one.
 */
async function runUi(
  argv: string[],
  startWith?: (port: number) => Promise<XrayServer>,
  launch: BrowserLaunch = "opened",
): Promise<UiRun> {
  let stdout = "";
  let stderr = "";
  const events: string[] = [];
  const fail = () => Promise.reject(new Error("Not expected."));
  const fakeServer = (port: number): XrayServer => ({
    url: `http://127.0.0.1:${port}/`,
    port,
    workspace: "/tmp/xray-ui-a1b2c3",
    close: () => {
      events.push("server closed");
      return Promise.resolve();
    },
  });
  const commands: Commands = {
    inspect: fail,
    reconstruct: fail,
    doctor: fail,
    ui: (port) => {
      events.push(`server started on ${port}`);
      return startWith?.(port) ?? Promise.resolve(fakeServer(port));
    },
    openBrowser: (url) => {
      events.push(`browser opened at ${url}`);
      return Promise.resolve(launch);
    },
    listenForStop: () => {
      events.push("listening for Ctrl+C");
      return {
        get stopped() {
          events.push("Ctrl+C");
          return Promise.resolve("SIGINT" as const);
        },
        dispose: () => events.push("stopped listening"),
      };
    },
  };
  const code = await main(
    argv,
    {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    },
    commands,
  );
  return { code, stdout, stderr, events };
}

describe("xray ui", () => {
  it("starts the server, opens the browser at it, then on Ctrl+C stops it and exits 0", async () => {
    expect(await runUi(["ui"])).toEqual({
      code: ExitCode.ok,
      stdout: [
        `Xray is running at http://127.0.0.1:${DEFAULT_PORT}/`,
        "Only this machine can reach it. Workspace: /tmp/xray-ui-a1b2c3",
        "Press Ctrl+C to stop Xray and delete its Workspace.",
        "Stopping Xray...",
        "Xray has stopped, and its Workspace is deleted.",
        "",
      ].join("\n"),
      stderr: "",
      events: [
        "listening for Ctrl+C",
        `server started on ${DEFAULT_PORT}`,
        `browser opened at http://127.0.0.1:${DEFAULT_PORT}/`,
        "Ctrl+C",
        "server closed",
        "stopped listening",
      ],
    });
  });

  it.each([
    ["8080", 8080],
    ["0", 0],
    ["65535", 65535],
  ])("listens on --port %s", async (port, expected) => {
    const result = await runUi(["ui", "--port", port]);

    expect(result.code).toBe(ExitCode.ok);
    expect(result.events).toContain(`server started on ${expected}`);
  });

  it.each(["abc", "65536", "1.5", "", "-1", "0x50"])(
    "rejects --port=%s",
    async (port) => {
      const result = await runUi(["ui", `--port=${port}`]);

      expect(result).toMatchObject({
        code: ExitCode.usage,
        stdout: "",
        events: [],
      });
      expect(result.stderr).toContain(
        `--port takes a port number from 0 to 65535, but was given "${port}".`,
      );
    },
  );

  it("reports a busy port with the suggestion it is given, and exits 1", async () => {
    const result = await runUi(["ui", "--port", "8080"], () =>
      Promise.reject(
        new ServerError(
          "port-in-use",
          "Port 8080 on 127.0.0.1 is already in use. Try another, such as: xray ui --port 8081",
        ),
      ),
    );

    expect(result).toEqual({
      code: ExitCode.failed,
      stdout: "",
      stderr:
        "Port 8080 on 127.0.0.1 is already in use. Try another, such as: xray ui --port 8081\n",
      events: [
        "listening for Ctrl+C",
        "server started on 8080",
        "stopped listening",
      ],
    });
  });

  it("says which Workspace it could not delete, and exits 1", async () => {
    const result = await runUi(["ui"], (port) =>
      Promise.resolve({
        url: `http://127.0.0.1:${port}/`,
        port,
        workspace: "/tmp/xray-ui-a1b2c3",
        close: () =>
          Promise.reject(new Error("EBUSY: resource busy or locked")),
      }),
    );

    expect(result.code).toBe(ExitCode.failed);
    expect(result.stdout).not.toContain("Xray has stopped");
    expect(result.stderr).toBe(
      "Could not delete Xray's Workspace, /tmp/xray-ui-a1b2c3: EBUSY: resource busy or locked\n",
    );
    expect(result.events.at(-1)).toBe("stopped listening");
  });

  it("says to open the address by hand if no browser could be opened", async () => {
    const result = await runUi(["ui"], undefined, "failed");

    expect(result.code).toBe(ExitCode.ok);
    expect(result.stderr).toBe(
      `Could not open a browser. Open http://127.0.0.1:${DEFAULT_PORT}/ in one yourself.\n`,
    );
  });

  it("says nothing more when told not to open a browser", async () => {
    const result = await runUi(["ui"], undefined, "skipped");

    expect(result.code).toBe(ExitCode.ok);
    expect(result.stderr).toBe("");
  });

  it("rejects arguments it does not take", async () => {
    const result = await runUi(["ui", "MyApp.exe"]);

    expect(result).toMatchObject({ code: ExitCode.usage, events: [] });
    expect(result.stderr).toContain(
      '"xray ui" takes no arguments, but was given: MyApp.exe',
    );
  });

  it.each([
    [["ui", "--json"], '"xray ui" does not take --json.'],
    [["ui", "-o", "out"], '"xray ui" does not take --output.'],
    [["ui", "--run"], '"xray ui" does not take --run.'],
    [["ui", "--no-siblings"], '"xray ui" does not take --no-siblings.'],
    [["ui", "--offline"], '"xray ui" does not take --offline.'],
    [["doctor", "--port", "8080"], '"xray doctor" does not take --port.'],
    [
      ["reconstruct", "MyApp.exe", "-o", "out", "--port", "8080"],
      '"xray reconstruct" does not take --port.',
    ],
  ])("rejects %j", async (argv, message) => {
    const result = await runUi(argv);

    expect(result).toMatchObject({ code: ExitCode.usage, events: [] });
    expect(result.stderr).toContain(message);
  });
});

describe("exit codes", () => {
  it("are distinct", () => {
    const codes = Object.values(ExitCode);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("are the documented ones", () => {
    expect(ExitCode).toEqual({
      ok: 0,
      failed: 1,
      usage: 2,
      rejected: 3,
      partial: 4,
    });
  });

  it("are each listed in the usage", () => {
    for (const code of Object.values(ExitCode)) {
      expect(USAGE).toMatch(new RegExp(`^  ${code}    \\S`, "m"));
    }
  });
});

describe("xray doctor", () => {
  it("prints the report and exits 0 when every check passes", async () => {
    expect(await run(["doctor"])).toEqual({
      code: ExitCode.ok,
      stdout: "PASS  Node.js  26.10.0\n\nAll 1 checks passed.\n",
      stderr: "",
      doctorRuns: 1,
      inspected: [],
      reconstructed: [],
    });
  });

  it("prints the report and exits non-zero when any check fails", async () => {
    const result = await run(["doctor"], failing);

    expect(result.code).toBe(ExitCode.failed);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain(
      "FAIL  .NET SDK  Only .NET SDK 7.0.410 is installed; Xray needs 8 or later.",
    );
    expect(result.stdout).toContain(
      "Fix: Install the .NET SDK 8 or later from https://dot.net.",
    );
  });

  it("does not take --json", async () => {
    expect(await run(["doctor", "--json"])).toMatchObject({
      code: ExitCode.usage,
      stdout: "",
      stderr: expect.stringContaining(
        '"xray doctor" does not take --json.',
      ) as unknown,
      doctorRuns: 0,
    });
  });

  it("rejects arguments it does not take", async () => {
    expect(await run(["doctor", "MyApp.exe"])).toMatchObject({
      code: ExitCode.usage,
      stderr: expect.stringContaining(
        '"xray doctor" takes no arguments, but was given: MyApp.exe',
      ) as unknown,
      doctorRuns: 0,
    });
  });
});

describe("xray", () => {
  it.each([
    [["--help"]],
    [["-h"]],
    [["help"]],
    [["doctor", "--help"]],
    [["inspect", "--help"]],
    [["reconstruct", "--help"]],
    [["ui", "--help"]],
  ])("prints usage for %j", async (argv) => {
    expect(await run(argv)).toEqual({
      code: ExitCode.ok,
      stdout: USAGE,
      stderr: "",
      doctorRuns: 0,
      inspected: [],
      reconstructed: [],
    });
  });

  it.each([
    [[], "No command given."],
    [["frobnicate"], 'Unknown command "frobnicate".'],
    [["doctor", "--fix"], "Unknown option '--fix'"],
  ])("reports a usage error for %j", async (argv, message) => {
    const result = await run(argv);

    expect(result).toMatchObject({ code: ExitCode.usage, stdout: "" });
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain(USAGE);
  });
});
