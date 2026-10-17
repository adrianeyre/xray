import { describe, expect, it } from "vitest";

import type { AssemblySummary } from "../inspect/assembly-summary.js";
import type { BuildDiagnostic } from "./build-diagnostics.js";
import type { RecoveredProject } from "./reconstruct.js";
import {
  toXrayReport,
  XRAY_REPORT_SCHEMA_VERSION,
  type AcceptedReconstruction,
} from "./xray-report.js";

const summary: AssemblySummary = {
  path: "/abs/App.dll",
  assembly: {
    name: "App",
    version: "1.2.3.4",
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
  entryPoint: { type: "App.Program", method: "Main" },
  outputKind: "console",
  references: [],
  counts: { types: 2, methods: 3, resources: 0 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};

const error: BuildDiagnostic = {
  severity: "error",
  code: "CS0246",
  message: "The type or namespace name 'Greetings' could not be found",
  file: "App/Program.cs",
  line: 2,
  column: 7,
  project: "App/App.csproj",
};

const warning: BuildDiagnostic = {
  severity: "warning",
  code: "CS8600",
  message:
    "Converting null literal or possible null value to non-nullable type.",
  file: "App/Program.cs",
  line: 9,
  column: 21,
  project: "App/App.csproj",
};

const solution = {
  directory: "/abs/out",
  solutionPath: "App.sln",
  projectPath: "App/App.csproj",
  targetFramework: "net8.0",
  outputType: "Exe",
  reportPath: "xray-report.json",
  files: [
    "App.sln",
    "App/App.csproj",
    "App/Properties/AssemblyInfo.cs",
    "App/Program.cs",
    "xray-report.json",
  ],
  typeCount: 2,
  sourceFileCount: 2,
  projects: [
    {
      assemblyPath: "/abs/App.dll",
      assemblyName: "App",
      projectPath: "App/App.csproj",
      targetFramework: "net8.0",
      outputType: "Exe",
      typeCount: 2,
      sourceFileCount: 2,
      pdb: { status: "none" },
      obfuscation: { status: "clean", indicators: [] },
      projectReferences: [],
      packageReferences: [],
      binaryReferences: [],
      resources: [],
    },
  ],
} as const;

const partial: AcceptedReconstruction = {
  accepted: true,
  classification: {
    path: "/abs/App.dll",
    kind: "managed-assembly",
    accepted: true,
    explanation: '"App.dll" is a Managed Assembly.',
  },
  summary,
  solution,
  build: {
    succeeded: false,
    output: "Program.cs(2,7): error CS0246: …\nBuild FAILED.\n",
    diagnostics: [warning, error],
  },
  run: null,
  outcome: "partial",
  reasons: [{ kind: "build-failed", errors: [error] }],
  siblings: true,
  siblingProblems: [],
  offline: false,
  packages: [],
  dependencies: [],
  warnings: [],
  timings: {
    analyse: 40,
    decompile: 300,
    resolveDependencies: 20,
    generate: 5,
    build: 2_000,
    run: null,
    total: 2_350,
  },
};

describe("toXrayReport", () => {
  it("reports a Partial Reconstruction: inputs, inspect summary, obfuscation, solution, build, timings and outcome", () => {
    const report = toXrayReport(partial);

    expect(report).toEqual({
      schemaVersion: XRAY_REPORT_SCHEMA_VERSION,
      outcome: "partial",
      reasons: [{ kind: "build-failed", errors: [error] }],
      inputs: {
        path: "/abs/App.dll",
        options: { build: true, run: false, siblings: true, offline: false },
      },
      inspect: summary,
      obfuscated: false,
      dependencies: [],
      siblingProblems: [],
      packages: [],
      warnings: [],
      solution: {
        solutionPath: "App.sln",
        projectPath: "App/App.csproj",
        targetFramework: "net8.0",
        outputType: "Exe",
        typeCount: 2,
        sourceFileCount: 2,
        projects: solution.projects,
        files: solution.files,
      },
      build: {
        succeeded: false,
        diagnostics: [warning, error],
        output: "Program.cs(2,7): error CS0246: …\nBuild FAILED.\n",
      },
      run: null,
      timings: {
        analyse: 40,
        decompile: 300,
        resolveDependencies: 20,
        generate: 5,
        build: 2_000,
        run: null,
        total: 2_350,
      },
    });
    expect(XRAY_REPORT_SCHEMA_VERSION).toBe(1);
  });

  it("reports each PDB beside an Assembly, and warns of each that was ignored", () => {
    const pdb = {
      status: "mismatched",
      path: "/abs/App.pdb",
      format: "portable",
      reason:
        "App.pdb, a portable PDB, is not App.dll's own: its ID is not the one App.dll records, so it is another build's.",
    } as const;
    const warning = {
      kind: "pdb-ignored",
      assemblyPath: "/abs/App.dll",
      pdbPath: "/abs/App.pdb",
      message: "Ignored the PDB beside App.dll, /abs/App.pdb. …",
    } as const;

    const report = toXrayReport({
      ...partial,
      summary: { ...summary, pdb },
      solution: {
        ...solution,
        projects: [{ ...(solution.projects[0] as RecoveredProject), pdb }],
      },
      warnings: [warning],
    });

    expect(report.inspect.pdb).toEqual(pdb);
    expect(report.solution.projects[0]?.pdb).toEqual(pdb);
    expect(report.warnings).toEqual([warning]);
  });

  it("flags an obfuscated Assembly, in its summary, its project and a warning, as it does a clean one in neither", () => {
    const obfuscation = {
      status: "obfuscated",
      indicators: [
        {
          kind: "encrypted-strings",
          evidence: ["<PrivateImplementationDetails>{0}.Strings"],
          message: "Its strings are hidden: …",
        },
      ],
    } as const;
    const warning = {
      kind: "obfuscated",
      assemblyPath: "/abs/App.dll",
      message: "App.dll is likely obfuscated. …",
    } as const;

    const report = toXrayReport({
      ...partial,
      summary: { ...summary, obfuscation },
      solution: {
        ...solution,
        projects: [
          { ...(solution.projects[0] as RecoveredProject), obfuscation },
        ],
      },
      warnings: [warning],
    });

    expect(report.obfuscated).toBe(true);
    expect(report.inspect.obfuscation).toEqual(obfuscation);
    expect(report.solution.projects[0]?.obfuscation).toEqual(obfuscation);
    // No pdbPath: it is about no PDB.
    expect(report.warnings).toEqual([warning]);
    expect(toXrayReport(partial).obfuscated).toBe(false);
  });

  it("reports a Full Reconstruction", () => {
    const report = toXrayReport({
      ...partial,
      build: { succeeded: true, output: "Build succeeded.\n", diagnostics: [] },
      outcome: "full",
      reasons: [],
    });

    expect(report).toMatchObject({
      outcome: "full",
      reasons: [],
      build: { succeeded: true, diagnostics: [] },
    });
  });

  it("reports an unverified Reconstruction, which was not built", () => {
    const report = toXrayReport({
      ...partial,
      build: null,
      outcome: "unverified",
      reasons: [],
      timings: { ...partial.timings, build: null },
    });

    expect(report).toMatchObject({
      outcome: "unverified",
      inputs: { options: { build: false, run: false } },
      build: null,
      timings: { build: null },
    });
  });

  it("reports what the rebuilt program did when it was asked to run", () => {
    const run = {
      status: "exited",
      reason: null,
      program: "App/bin/Debug/net8.0/App.dll",
      exitCode: 1,
      stdout: "",
      stderr: "Usage: App <name>\n",
    } as const;

    const report = toXrayReport({
      ...partial,
      build: { succeeded: true, output: "Build succeeded.\n", diagnostics: [] },
      run,
      outcome: "full",
      reasons: [],
      timings: { ...partial.timings, run: 80, total: 2_430 },
    });

    expect(report).toMatchObject({
      outcome: "full",
      inputs: { options: { build: true, run: true } },
      run,
      timings: { run: 80 },
    });
    expect(Object.keys(report)).toEqual([
      "schemaVersion",
      "outcome",
      "reasons",
      "inputs",
      "inspect",
      "obfuscated",
      "dependencies",
      "siblingProblems",
      "packages",
      "warnings",
      "solution",
      "build",
      "run",
      "timings",
    ]);
  });

  it("reports a program that was asked to run but could not run here", () => {
    const run = {
      status: "skipped",
      reason:
        "It is a WinForms program, and WinForms runs only on Windows, not on Linux.",
      program: null,
      exitCode: null,
      stdout: null,
      stderr: null,
    } as const;

    expect(
      toXrayReport({
        ...partial,
        build: { succeeded: true, output: "", diagnostics: [] },
        run,
        outcome: "full",
        reasons: [],
      }),
    ).toMatchObject({
      inputs: { options: { run: true } },
      run,
      timings: { run: null },
    });
  });

  it("reports each Sibling Assembly's project, what each references, and what was worked around", () => {
    const projects = [
      {
        ...solution.projects[0],
        projectReferences: ["Inventory/Inventory.csproj"],
      },
      {
        assemblyPath: "/abs/Inventory.dll",
        assemblyName: "Inventory",
        projectPath: "Inventory/Inventory.csproj",
        targetFramework: "net8.0",
        outputType: "Library",
        typeCount: 4,
        sourceFileCount: 3,
        pdb: {
          status: "matching",
          path: "/abs/Inventory.pdb",
          format: "portable",
        },
        obfuscation: { status: "clean", indicators: [] },
        projectReferences: [],
        packageReferences: [],
        binaryReferences: [],
        resources: [],
      },
    ] as const;
    const siblingProblems = [
      {
        kind: "duplicate-assembly-name",
        name: "Inventory",
        paths: ["/abs/Inventory.dll", "/abs/Inventory.exe"],
        chosen: "/abs/Inventory.dll",
        message: "2 Assemblies beside the input are named Inventory: …",
      },
    ] as const;

    const report = toXrayReport({
      ...partial,
      solution: { ...solution, projects },
      siblingProblems,
    });

    expect(report.solution.projects).toEqual(projects);
    expect(report.siblingProblems).toEqual(siblingProblems);
  });

  it("reports that Sibling Assemblies were not reconstructed (--no-siblings)", () => {
    const report = toXrayReport({ ...partial, siblings: false });

    expect(report).toMatchObject({
      inputs: { options: { siblings: false } },
      timings: { resolveDependencies: 20 },
    });
  });

  it("reports each reference looked up as a NuGet package, the package chosen and why, each project's PackageReferences, and --offline", () => {
    const chosen = {
      id: "Newtonsoft.Json",
      version: "13.0.3",
      source: "global-packages",
      file: "lib/net6.0/Newtonsoft.Json.dll",
      matchesCopyBeside: true,
    } as const;
    const packages = [
      {
        reference: {
          name: "Newtonsoft.Json",
          version: "13.0.0.0",
          culture: null,
          publicKeyToken: "30ad4fe6b2a6aeed",
        },
        referencedBy: ["App"],
        package: chosen,
        candidates: [
          chosen,
          { ...chosen, version: "13.0.1", matchesCopyBeside: false },
        ],
        searched: ["global-packages"],
        reason:
          "2 versions of Newtonsoft.Json in the global-packages cache hold …",
      },
      {
        reference: {
          name: "Greetings",
          version: "1.0.0.0",
          culture: null,
          publicKeyToken: null,
        },
        referencedBy: ["App"],
        package: null,
        candidates: [],
        searched: [],
        reason: "Greetings is not strong-named, …",
      },
    ] as const;
    const projects = [
      {
        ...solution.projects[0],
        packageReferences: [{ id: "Newtonsoft.Json", version: "13.0.3" }],
      },
    ] as const;

    const report = toXrayReport({
      ...partial,
      offline: true,
      packages,
      solution: { ...solution, projects },
    });

    expect(report.inputs.options.offline).toBe(true);
    expect(report.packages).toEqual(packages);
    expect(report.solution.projects[0]?.packageReferences).toEqual([
      { id: "Newtonsoft.Json", version: "13.0.3" },
    ]);
  });

  it("reports how Dependency Resolution satisfied each reference, the binaries each project references, and each Unresolved Dependency as a reason", () => {
    const identity = (name: string, publicKeyToken: string | null = null) => ({
      name,
      version: "1.0.0.0",
      culture: null,
      publicKeyToken,
    });
    const none = {
      package: null,
      projectPath: null,
      copiedTo: null,
      path: null,
    };
    const unresolved = {
      ...none,
      reference: identity("Greetings"),
      referencedBy: ["App"],
      resolution: "unresolved",
      reason: "No Managed Assembly named Greetings is beside the input …",
    } as const;
    const dependencies = [
      {
        ...none,
        reference: identity("System.Runtime", "b03f5f7f11d50a3a"),
        referencedBy: ["App"],
        resolution: "framework",
        reason: "System.Runtime is signed with one of Microsoft's keys …",
      },
      {
        ...none,
        reference: identity("Kestrelwood.Checksums", "51ca75d1f3633191"),
        referencedBy: ["App"],
        resolution: "copied-binary",
        copiedTo: "Dependencies/Kestrelwood.Checksums.dll",
        path: "/abs/Kestrelwood.Checksums.dll",
        reason: "/abs/Kestrelwood.Checksums.dll, beside the input, is …",
      },
      unresolved,
    ] as const;
    const reasons = [
      { kind: "unresolved-dependencies", dependencies: [unresolved] },
      { kind: "build-failed", errors: [error] },
    ] as const;
    const projects = [
      {
        ...solution.projects[0],
        binaryReferences: ["Dependencies/Kestrelwood.Checksums.dll"],
      },
    ] as const;

    const report = toXrayReport({
      ...partial,
      reasons,
      dependencies,
      solution: { ...solution, projects },
    });

    expect(report.dependencies).toEqual(dependencies);
    expect(report.reasons).toEqual(reasons);
    expect(report.solution.projects[0]?.binaryReferences).toEqual([
      "Dependencies/Kestrelwood.Checksums.dll",
    ]);
    expect(Object.keys(report.dependencies[0] ?? {})).toEqual([
      "reference",
      "referencedBy",
      "resolution",
      "package",
      "projectPath",
      "copiedTo",
      "path",
      "reason",
    ]);
  });

  it("does not carry where the Recovered Solution is, so it stays true when the folder is moved or zipped", () => {
    expect(JSON.stringify(toXrayReport(partial))).not.toContain("/abs/out");
  });
});
