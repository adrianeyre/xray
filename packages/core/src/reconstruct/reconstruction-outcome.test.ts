import { describe, expect, it } from "vitest";

import type { BuildDiagnostic } from "./build-diagnostics.js";
import { classifyOutcome } from "./reconstruction-outcome.js";
import type { Dependency } from "./sibling-assemblies.js";

const error: BuildDiagnostic = {
  severity: "error",
  code: "CS0246",
  message: "The type or namespace name 'Greetings' could not be found",
  file: "App/Program.cs",
  line: 2,
  column: 7,
};

const warning: BuildDiagnostic = {
  severity: "warning",
  code: "CS8600",
  message:
    "Converting null literal or possible null value to non-nullable type.",
  file: "App/Program.cs",
  line: 9,
  column: 21,
};

/** A reference to `name`, resolved so. */
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
    referencedBy: ["App"],
    resolution,
    package: null,
    projectPath: null,
    copiedTo: null,
    path: null,
    reason: `${name} is ${resolution}.`,
  };
}

describe("classifyOutcome", () => {
  it("is Full when the Recovered Solution built, warnings or not", () => {
    expect(
      classifyOutcome({ succeeded: true, output: "", diagnostics: [warning] }),
    ).toEqual({ outcome: "full", reasons: [] });
  });

  it("is Partial when it did not build, giving its errors as the reason", () => {
    expect(
      classifyOutcome({
        succeeded: false,
        output: "",
        diagnostics: [warning, error],
      }),
    ).toEqual({
      outcome: "partial",
      reasons: [{ kind: "build-failed", errors: [error] }],
    });
  });

  it("is Partial when it did not build without reporting an error", () => {
    expect(
      classifyOutcome({
        succeeded: false,
        output: "The build did not finish within 600000 ms, so it was stopped.",
        diagnostics: [],
      }),
    ).toEqual({
      outcome: "partial",
      reasons: [{ kind: "build-failed", errors: [] }],
    });
  });

  it("is unverified, neither Full nor Partial, when it was not built", () => {
    expect(classifyOutcome(null)).toEqual({
      outcome: "unverified",
      reasons: [],
    });
  });
});

describe("classifyOutcome, when the program was asked to run", () => {
  const built = { succeeded: true, output: "", diagnostics: [] };
  const ran = {
    status: "exited",
    reason: null,
    program: "App/bin/Debug/net8.0/App.dll",
    exitCode: 0,
    stdout: "",
    stderr: "",
  } as const;

  it.each([
    ["exited with 0", ran],
    [
      "exited with 1, an exit code only a Round-trip can judge",
      { ...ran, exitCode: 1 },
    ],
    [
      "launched, as a GUI program",
      { ...ran, status: "launched", exitCode: null },
    ],
    [
      "skipped, as it cannot run here",
      {
        status: "skipped",
        reason:
          "It is a WinForms program, and WinForms runs only on Windows, not on Linux.",
        program: null,
        exitCode: null,
        stdout: null,
        stderr: null,
      },
    ],
  ] as const)("is Full when it %s", (_, run) => {
    expect(classifyOutcome(built, run)).toEqual({
      outcome: "full",
      reasons: [],
    });
  });

  it.each(["crashed", "timed-out", "failed-to-start"] as const)(
    "is Partial when it %s",
    (status) => {
      expect(
        classifyOutcome(built, {
          ...ran,
          status,
          reason: "It was ended by SIGABRT.",
          exitCode: null,
        }),
      ).toEqual({ outcome: "partial", reasons: [{ kind: "run-failed" }] });
    },
  );

  it("gives only the build's failure when it did not build, as there was nothing to run", () => {
    expect(
      classifyOutcome(
        { succeeded: false, output: "", diagnostics: [error] },
        {
          status: "skipped",
          reason:
            "The Recovered Solution did not build, so there is no rebuilt program to run.",
          program: null,
          exitCode: null,
          stdout: null,
          stderr: null,
        },
      ),
    ).toEqual({
      outcome: "partial",
      reasons: [{ kind: "build-failed", errors: [error] }],
    });
  });

  it("is Partial with any Unresolved Dependency, naming each, before the build's failure", () => {
    const greetings = dependency("Greetings", "unresolved");
    const ledger = dependency("Ledger", "unresolved");

    expect(
      classifyOutcome(
        { succeeded: false, output: "", diagnostics: [error] },
        null,
        [
          dependency("System.Runtime", "framework"),
          greetings,
          dependency("Barcodes", "copied-binary"),
          ledger,
        ],
      ),
    ).toEqual({
      outcome: "partial",
      reasons: [
        { kind: "unresolved-dependencies", dependencies: [greetings, ledger] },
        { kind: "build-failed", errors: [error] },
      ],
    });
  });

  it("is Partial with an Unresolved Dependency even when it built, or was not built", () => {
    const greetings = dependency("Greetings", "unresolved");
    const reasons = [
      { kind: "unresolved-dependencies", dependencies: [greetings] },
    ];

    expect(
      classifyOutcome({ succeeded: true, output: "", diagnostics: [] }, null, [
        greetings,
      ]),
    ).toEqual({ outcome: "partial", reasons });
    expect(classifyOutcome(null, null, [greetings])).toEqual({
      outcome: "partial",
      reasons,
    });
  });

  it("is Full, or unverified, when every reference was satisfied", () => {
    const satisfied = [
      dependency("System.Runtime", "framework"),
      dependency("Newtonsoft.Json", "nuget-package"),
      dependency("Inventory", "sibling-assembly"),
      dependency("Barcodes", "copied-binary"),
    ];

    expect(
      classifyOutcome(
        { succeeded: true, output: "", diagnostics: [] },
        null,
        satisfied,
      ),
    ).toEqual({ outcome: "full", reasons: [] });
    expect(classifyOutcome(null, null, satisfied)).toEqual({
      outcome: "unverified",
      reasons: [],
    });
  });
});
