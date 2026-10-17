import { describe, expect, it } from "vitest";

import type { BuildDiagnostic, ReportSummary } from "./events.js";
import {
  buildResult,
  dependencyResult,
  dependencyRows,
  formatDiagnostic,
  obfuscationResult,
  pdbResult,
  resourcesResult,
  reportDiagnostics,
  reportTimings,
  siblingResult,
  typesResult,
} from "./report.js";

const report: ReportSummary = {
  outcome: "partial",
  reasons: [],
  solution: {
    solutionPath: "MissingReference.sln",
    projectPath: "MissingReference/MissingReference.csproj",
    targetFramework: "net8.0",
    outputType: "Exe",
    typeCount: 1,
    sourceFileCount: 1,
    files: [
      "MissingReference.sln",
      "MissingReference/MissingReference.csproj",
      "MissingReference/Program.cs",
      "xray-report.json",
    ],
    projects: [
      {
        assemblyName: "MissingReference",
        projectPath: "MissingReference/MissingReference.csproj",
        typeCount: 1,
        pdb: { status: "none" },
        obfuscation: { status: "clean", indicators: [] },
        projectReferences: [],
        resources: [],
      },
    ],
  },
  inputs: { options: { siblings: true } },
  dependencies: [
    {
      reference: {
        name: "Greetings",
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      referencedBy: ["MissingReference"],
      resolution: "unresolved",
      package: null,
      projectPath: null,
      copiedTo: null,
      reason:
        "No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
    },
    {
      reference: {
        name: "System.Runtime",
        version: "8.0.0.0",
        culture: null,
        publicKeyToken: "b03f5f7f11d50a3a",
      },
      referencedBy: ["MissingReference"],
      resolution: "framework",
      package: null,
      projectPath: null,
      copiedTo: null,
      reason: "System.Runtime is signed with one of Microsoft's keys …",
    },
  ],
  warnings: [],
  siblingProblems: [],
  build: { succeeded: false, diagnostics: [] },
  timings: {
    analyse: 80,
    decompile: 600,
    resolveDependencies: 9,
    generate: 2,
    build: 1_500,
    run: null,
    total: 2_182,
  },
};

const usingGreetings: BuildDiagnostic = {
  severity: "error",
  code: "CS0246",
  message:
    "The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
  file: "MissingReference/Program.cs",
  line: 2,
  column: 7,
};

describe("reportDiagnostics", () => {
  it("leads each diagnostic about a file of the Recovered Solution to its file, line and column", () => {
    expect(
      reportDiagnostics({
        ...report,
        build: { succeeded: false, diagnostics: [usingGreetings] },
      }),
    ).toEqual([
      {
        diagnostic: usingGreetings,
        target: { path: "MissingReference/Program.cs", line: 2, column: 7 },
      },
    ]);
  });

  it("leads one that gives no line to the top of its file", () => {
    const restore: BuildDiagnostic = {
      severity: "warning",
      code: "NU1603",
      message: "A package was resolved to a version it did not ask for.",
      file: "MissingReference/MissingReference.csproj",
    };

    expect(
      reportDiagnostics({
        ...report,
        build: { succeeded: true, diagnostics: [restore] },
      }),
    ).toEqual([
      {
        diagnostic: restore,
        target: {
          path: "MissingReference/MissingReference.csproj",
          line: null,
          column: null,
        },
      },
    ]);
  });

  it("leads nowhere one that names no file, or one outside the Recovered Solution, or one it did not write", () => {
    const outside: BuildDiagnostic[] = [
      {
        severity: "error",
        code: "MSB1009",
        message: "Project file does not exist.",
      },
      {
        severity: "error",
        code: "MSB4018",
        message: "The task failed unexpectedly.",
        file: "/usr/share/dotnet/sdk/8.0.100/Sdks/Microsoft.NET.Sdk/targets/Microsoft.NET.Sdk.targets",
        line: 266,
        column: 5,
      },
      {
        severity: "error",
        code: "CS2001",
        message: "Source file could not be found.",
        file: "MissingReference/obj/Debug/net8.0/MissingReference.AssemblyInfo.cs",
        line: 1,
      },
    ];

    expect(
      reportDiagnostics({
        ...report,
        build: { succeeded: false, diagnostics: outside },
      }).map(({ target }) => target),
    ).toEqual([null, null, null]);
  });

  it("puts the errors first, then the warnings, each in the order printed", () => {
    const warning = (code: string): BuildDiagnostic => ({
      severity: "warning",
      code,
      message: code,
    });
    const error = (code: string): BuildDiagnostic => ({
      severity: "error",
      code,
      message: code,
    });

    expect(
      reportDiagnostics({
        ...report,
        build: {
          succeeded: false,
          diagnostics: [warning("W1"), error("E1"), warning("W2"), error("E2")],
        },
      }).map(({ diagnostic }) => diagnostic.code),
    ).toEqual(["E1", "E2", "W1", "W2"]);
  });

  it("has none when the Recovered Solution was not built", () => {
    expect(reportDiagnostics({ ...report, build: null })).toEqual([]);
  });
});

describe("formatDiagnostic", () => {
  it("gives a diagnostic as the CLI does: file:line:column: severity code: message", () => {
    expect(formatDiagnostic(usingGreetings)).toBe(
      "MissingReference/Program.cs:2:7: error CS0246: The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
    );
    expect(
      formatDiagnostic({ severity: "warning", code: "", message: "Odd." }),
    ).toBe("warning: Odd.");
  });
});

describe("buildResult", () => {
  it("says how it built, and with how many errors and warnings", () => {
    expect(buildResult({ succeeded: true, diagnostics: [] })).toBe("succeeded");
    expect(
      buildResult({
        succeeded: true,
        diagnostics: [{ severity: "warning", code: "CS0168", message: "" }],
      }),
    ).toBe("succeeded with 1 warning");
    expect(
      buildResult({
        succeeded: false,
        diagnostics: [
          usingGreetings,
          usingGreetings,
          { severity: "warning", code: "CS0168", message: "" },
          { severity: "warning", code: "CS0168", message: "" },
        ],
      }),
    ).toBe("failed with 2 errors and 2 warnings");
    expect(buildResult(null)).toBe(
      "not built, so the Recovered Solution was not verified",
    );
  });
});

describe("reportTimings", () => {
  it("gives each stage's time, in the order they run, then the total, saying which did not run", () => {
    expect(reportTimings(report.timings)).toEqual([
      ["Analyse", "80 ms"],
      ["Decompile", "600 ms"],
      ["Resolve dependencies", "9 ms"],
      ["Generate solution", "2 ms"],
      ["Build", "1.5 s"],
      ["Run the rebuilt program", "not run"],
      ["Total", "2.2 s"],
    ]);
    expect(
      reportTimings({
        ...report.timings,
        resolveDependencies: null,
        build: null,
        run: 42,
      }).filter(([stage]) =>
        ["Resolve dependencies", "Build", "Run the rebuilt program"].includes(
          stage,
        ),
      ),
    ).toEqual([
      ["Resolve dependencies", "skipped"],
      ["Build", "not built"],
      ["Run the rebuilt program", "42 ms"],
    ]);
  });
});

describe("obfuscationResult", () => {
  const withObfuscation = (
    obfuscation: ReportSummary["solution"]["projects"][number]["obfuscation"],
  ): ReportSummary => ({
    ...report,
    solution: {
      ...report.solution,
      projects: [
        {
          ...(report.solution
            .projects[0] as ReportSummary["solution"]["projects"][number]),
          obfuscation,
        },
      ],
    },
  });

  it("says, as the CLI does, whether the input Assembly is likely obfuscated, by which signs, and that it was reconstructed as it is", () => {
    expect(obfuscationResult(report)).toBe("clean: no sign of it found");
    expect(
      obfuscationResult(
        withObfuscation({
          status: "obfuscated",
          indicators: [
            { kind: "obfuscator-attribute", evidence: [], message: "…" },
            { kind: "mangled-identifiers", evidence: [], message: "…" },
            { kind: "encrypted-strings", evidence: [], message: "…" },
          ],
        }),
      ),
    ).toBe(
      "likely obfuscated (an obfuscator's attribute, mangled names, hidden strings): reconstructed as it is, not deobfuscated",
    );
  });

  it("shows a status or sign added since as it is", () => {
    expect(
      obfuscationResult(
        withObfuscation({
          status: "obfuscated",
          indicators: [{ kind: "packed", evidence: [], message: "…" }],
        }),
      ),
    ).toBe(
      "likely obfuscated (packed): reconstructed as it is, not deobfuscated",
    );
    expect(
      obfuscationResult(
        withObfuscation({ status: "suspected", indicators: [] }),
      ),
    ).toBe("suspected");
  });
});

describe("resourcesResult", () => {
  const withResources = (
    resources: ReportSummary["solution"]["projects"][number]["resources"],
  ): ReportSummary => ({
    ...report,
    solution: {
      ...report.solution,
      projects: report.solution.projects.map((project) => ({
        ...project,
        resources,
      })),
    },
  });

  it("says the input Assembly has none", () => {
    expect(resourcesResult(report)).toBe("none");
  });

  it("counts what became of the input Assembly's resources, as the CLI does, with its satellite assemblies' cultures", () => {
    expect(
      resourcesResult(
        withResources([
          { name: "A.Strings.resources", culture: null, recoveredAs: "resx" },
          { name: "A.logo.png", culture: null, recoveredAs: "file" },
          { name: "A.Big.bin", culture: null, recoveredAs: "not-recovered" },
          {
            name: "A.Strings.fr.resources",
            culture: "fr",
            recoveredAs: "resx",
          },
          {
            name: "A.Strings.de.resources",
            culture: "de",
            recoveredAs: "resx",
          },
        ]),
      ),
    ).toBe(
      "5, each under its own name: 3 written as .resx, 1 embedded as it is, 1 not recovered; 2 satellite assemblies (fr, de)",
    );
    expect(
      resourcesResult(
        withResources([
          { name: "a", culture: null, recoveredAs: "file" },
          { name: "b", culture: "fr", recoveredAs: "file" },
        ]),
      ),
    ).toBe(
      "2, each under its own name: 2 embedded as they are; 1 satellite assembly (fr)",
    );
  });

  it("counts WPF resources recovered as XAML", () => {
    expect(
      resourcesResult(
        withResources([
          { name: "A.g.resources", culture: null, recoveredAs: "xaml" },
          { name: "A.Strings.resources", culture: null, recoveredAs: "resx" },
        ]),
      ),
    ).toBe(
      "2, each under its own name: 1 recovered as XAML, 1 written as .resx",
    );
  });
});

describe("siblingResult", () => {
  const library = (name: string) => ({
    assemblyName: name,
    projectPath: `${name}/${name}.csproj`,
    typeCount: 3,
    pdb: { status: "none" },
    obfuscation: { status: "clean", indicators: [] },
    projectReferences: [],
    resources: [],
  });

  it("says how many types were decompiled, and to how many files where that is fewer", () => {
    expect(typesResult(report.solution)).toBe(
      "1, each decompiled to a file of its own",
    );
    expect(
      typesResult({ ...report.solution, typeCount: 11, sourceFileCount: 6 }),
    ).toBe("11, decompiled to 6 files");
  });

  it.each([
    [{ status: "none" }, "none beside the Assembly"],
    [
      { status: "matching", path: "/app/App.pdb", format: "portable" },
      "/app/App.pdb, used for local names and source layout",
    ],
    [
      {
        status: "mismatched",
        path: "/app/App.pdb",
        format: "portable",
        reason: "…",
      },
      "/app/App.pdb, ignored, as it is not the Assembly's own",
    ],
  ])(
    "says whether the input Assembly was decompiled with its PDB: %j",
    (pdb, text) => {
      expect(
        pdbResult({
          ...report,
          solution: {
            ...report.solution,
            projects: [{ ...library("App"), pdb }],
          },
        }),
      ).toBe(text);
    },
  );

  it("says how many Sibling Assemblies became projects, that none were found, or that they were turned off", () => {
    expect(siblingResult(report)).toBe("none found beside it");
    expect(
      siblingResult({
        ...report,
        solution: {
          ...report.solution,
          projects: [
            ...report.solution.projects,
            library("Inventory"),
            library("Pricing"),
          ],
        },
      }),
    ).toBe("2, each a project of its own");
    expect(
      siblingResult({ ...report, inputs: { options: { siblings: false } } }),
    ).toBe("not reconstructed (turned off)");
  });
});

describe("dependencyRows", () => {
  const identity = (name: string, publicKeyToken: string | null = null) => ({
    name,
    version: "1.0.0.0",
    culture: null,
    publicKeyToken,
  });
  const none = { package: null, projectPath: null, copiedTo: null };

  it("gives every reference, in the report's order, with how it was resolved, what satisfies it, who makes it, and why", () => {
    const rows = dependencyRows({
      ...report,
      dependencies: [
        ...report.dependencies,
        {
          ...none,
          reference: identity("Newtonsoft.Json", "30ad4fe6b2a6aeed"),
          referencedBy: ["App", "Pricing"],
          resolution: "nuget-package",
          package: { id: "Newtonsoft.Json", version: "13.0.3" },
          reason: "Newtonsoft.Json 13.0.3 holds it.",
        },
        {
          ...none,
          reference: identity("Pricing"),
          referencedBy: ["App"],
          resolution: "sibling-assembly",
          projectPath: "Pricing/Pricing.csproj",
          reason: "It is the application's own.",
        },
        {
          ...none,
          reference: identity("Kestrelwood.Checksums", "51ca75d1f3633191"),
          referencedBy: ["App"],
          resolution: "copied-binary",
          copiedTo: "Dependencies/Kestrelwood.Checksums.dll",
          reason: "It is a third party's.",
        },
        {
          ...none,
          reference: identity("Plugins"),
          referencedBy: ["App"],
          resolution: "loaded-at-run-time",
          reason: "A resolution this web app does not know.",
        },
      ],
    });

    expect(
      rows.map((row) => [
        row.name,
        row.identity,
        row.resolvedAs,
        row.satisfiedBy,
        row.referencedBy,
      ]),
    ).toEqual([
      ["Greetings", "1.0.0.0", "Unresolved", null, "MissingReference"],
      [
        "System.Runtime",
        "8.0.0.0, b03f5f7f11d50a3a",
        "Framework",
        null,
        "MissingReference",
      ],
      [
        "Newtonsoft.Json",
        "1.0.0.0, 30ad4fe6b2a6aeed",
        "NuGet package",
        "Newtonsoft.Json 13.0.3",
        "App, Pricing",
      ],
      [
        "Pricing",
        "1.0.0.0",
        "Sibling Assembly",
        "Pricing/Pricing.csproj",
        "App",
      ],
      [
        "Kestrelwood.Checksums",
        "1.0.0.0, 51ca75d1f3633191",
        "Copied binary",
        "Dependencies/Kestrelwood.Checksums.dll",
        "App",
      ],
      ["Plugins", "1.0.0.0", "loaded-at-run-time", null, "App"],
    ]);
    expect(rows[0]).toMatchObject({
      resolution: "unresolved",
      reason:
        "No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
    });
  });
});

describe("dependencyResult", () => {
  it("counts the references, and how many were resolved each way, in the order Dependency Resolution tries them", () => {
    expect(dependencyResult(report)).toBe(
      "2 references: 1 framework, 1 unresolved",
    );
    const [unresolved, runtime] = report.dependencies as [
      ReportSummary["dependencies"][number],
      ReportSummary["dependencies"][number],
    ];
    expect(
      dependencyResult({
        ...report,
        dependencies: [
          { ...unresolved, resolution: "copied-binary" },
          { ...unresolved, resolution: "copied-binary" },
          runtime,
          { ...runtime, resolution: "loaded-at-run-time" },
        ],
      }),
    ).toBe(
      "4 references: 1 framework, 2 copied binaries, 1 loaded-at-run-time",
    );
    expect(dependencyResult({ ...report, dependencies: [runtime] })).toBe(
      "1 reference: 1 framework",
    );
  });
});
