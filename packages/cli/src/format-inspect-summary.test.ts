import type { AssemblySummary } from "@xray/core";
import { describe, expect, it } from "vitest";

import { formatInspectSummary } from "./format-inspect-summary.js";

/** A strong-named .NET Framework WinForms program. */
const winForms: AssemblySummary = {
  path: "C:\\Apps\\Ledger.exe",
  assembly: {
    name: "Ledger",
    version: "3.1.0.0",
    culture: null,
    publicKeyToken: "0123456789abcdef",
  },
  targetFramework: {
    moniker: "net472",
    frameworkName: ".NETFramework,Version=v4.7.2",
    runtimeVersion: "v4.0.30319",
    inferredFrom: null,
    support: "full",
  },
  architecture: {
    platformTarget: "x86",
    prefer32Bit: false,
    bitness: "32-bit",
    machine: "I386",
  },
  entryPoint: { type: "Ledger.Program+Startup", method: "Main" },
  outputKind: "winforms",
  references: [
    {
      name: "mscorlib",
      version: "4.0.0.0",
      culture: null,
      publicKeyToken: "b77a5c561934e089",
    },
    {
      name: "System.Windows.Forms",
      version: "4.0.0.0",
      culture: null,
      publicKeyToken: "b77a5c561934e089",
    },
  ],
  counts: { types: 42, methods: 317, resources: 5 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};

function line(summary: AssemblySummary, label: string): string | undefined {
  return formatInspectSummary(summary)
    .split("\n")
    .find((text) => text.startsWith(`${label} `));
}

describe("formatInspectSummary", () => {
  it("prints one aligned line per field, references continuing beneath", () => {
    expect(formatInspectSummary(winForms)).toBe(
      [
        "File              C:\\Apps\\Ledger.exe",
        "Assembly          Ledger, Version=3.1.0.0, Culture=neutral, PublicKeyToken=0123456789abcdef",
        "Target framework  net472 (.NETFramework,Version=v4.7.2)",
        "Architecture      x86 (32-bit)",
        "Entry point       Ledger.Program+Startup.Main",
        "Output kind       WinForms",
        "Types             42",
        "Methods           317",
        "Resources         5",
        "PDB               none beside it",
        "Obfuscation       clean: no sign of it found",
        "References        mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089",
        "                  System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089",
        "",
      ].join("\n"),
    );
  });

  it.each([
    [
      {
        status: "matching",
        path: "C:\\Apps\\Ledger.pdb",
        format: "windows",
      },
      "PDB               C:\\Apps\\Ledger.pdb (Windows), its own: used for local names and source layout",
    ],
    [
      {
        status: "mismatched",
        path: "C:\\Apps\\Ledger.pdb",
        format: "portable",
        reason: "Ledger.pdb, a portable PDB, is not Ledger.exe's own: …",
      },
      "PDB               C:\\Apps\\Ledger.pdb (portable), ignored: Ledger.pdb, a portable PDB, is not Ledger.exe's own: …",
    ],
    [
      {
        status: "unreadable",
        path: "C:\\Apps\\Ledger.pdb",
        format: null,
        reason:
          "Ledger.pdb is not a PDB: it is neither a portable nor a Windows one.",
      },
      "PDB               C:\\Apps\\Ledger.pdb, ignored: Ledger.pdb is not a PDB: it is neither a portable nor a Windows one.",
    ],
  ] as const)("says whether the PDB beside it is its own: %j", (pdb, text) => {
    expect(line({ ...winForms, pdb }, "PDB")).toBe(text);
  });

  it("says it is likely obfuscated, so would be reconstructed as it is, and each sign why, a line each", () => {
    const obfuscated: AssemblySummary = {
      ...winForms,
      obfuscation: {
        status: "obfuscated",
        indicators: [
          {
            kind: "obfuscator-attribute",
            evidence: ["ConfusedByAttribute"],
            message:
              "It bears ConfusedByAttribute, the attribute ConfuserEx marks what it has obfuscated with.",
          },
          {
            kind: "encrypted-strings",
            evidence: ["S"],
            message:
              "Its strings are hidden: 23 calls fetch them from string decoders, which decode them from bytes (in S), against 0 literals.",
          },
        ],
      },
    };

    expect(formatInspectSummary(obfuscated)).toContain(
      [
        "PDB               none beside it",
        "Obfuscation       likely obfuscated, so reconstructed as it is, not deobfuscated:",
        "                  It bears ConfusedByAttribute, the attribute ConfuserEx marks what it has obfuscated with.",
        "                  Its strings are hidden: 23 calls fetch them from string decoders, which decode them from bytes (in S), against 0 literals.",
        "References        mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089",
      ].join("\n"),
    );
  });

  it("says a library has no entry point", () => {
    const library: AssemblySummary = {
      ...winForms,
      entryPoint: null,
      outputKind: "library",
    };

    expect(line(library, "Entry point")).toBe("Entry point       none");
    expect(line(library, "Output kind")).toBe("Output kind       Library");
  });

  it("says an Assembly references nothing", () => {
    expect(line({ ...winForms, references: [] }, "References")).toBe(
      "References        none",
    );
  });

  it("names a culture other than neutral", () => {
    const satellite: AssemblySummary = {
      ...winForms,
      assembly: {
        ...winForms.assembly,
        name: "Ledger.resources",
        culture: "fr-FR",
      },
    };

    expect(line(satellite, "Assembly")).toBe(
      "Assembly          Ledger.resources, Version=3.1.0.0, Culture=fr-FR, PublicKeyToken=0123456789abcdef",
    );
  });

  it.each([
    [
      { moniker: null, frameworkName: "Silverlight,Version=v5.0" },
      "Silverlight,Version=v5.0",
    ],
    [
      { moniker: null, frameworkName: null },
      "unknown (no TargetFrameworkAttribute; CLR v4.0.30319)",
    ],
  ])("prints a target framework without a moniker: %j", (framework, text) => {
    const summary: AssemblySummary = {
      ...winForms,
      targetFramework: { ...winForms.targetFramework, ...framework },
    };

    expect(line(summary, "Target framework")).toBe(`Target framework  ${text}`);
  });

  it.each([
    [
      {
        moniker: "net35",
        frameworkName: null,
        runtimeVersion: "v2.0.50727",
        inferredFrom: "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
        support: "best-effort",
      },
      "net35 (no TargetFrameworkAttribute; told from CLR v2.0.50727 and its reference to System.Core 3.5.0.0), supported on a best-effort basis",
    ],
    [
      {
        moniker: "netstandard2.0",
        frameworkName: ".NETStandard,Version=v2.0",
        support: "best-effort",
      },
      "netstandard2.0 (.NETStandard,Version=v2.0), supported on a best-effort basis",
    ],
  ] as const)(
    "prints a target framework supported on a best-effort basis, and how it was told: %j",
    (framework, text) => {
      const summary: AssemblySummary = {
        ...winForms,
        targetFramework: { ...winForms.targetFramework, ...framework },
      };

      expect(line(summary, "Target framework")).toBe(
        `Target framework  ${text}`,
      );
    },
  );

  it.each([
    [
      { platformTarget: "AnyCPU", prefer32Bit: true, bitness: "any" },
      "AnyCPU, 32-bit preferred (runs as 32-bit wherever the OS can)",
    ],
    [
      { platformTarget: "ARM64", prefer32Bit: false, bitness: "64-bit" },
      "ARM64 (64-bit)",
    ],
    [
      {
        platformTarget: null,
        prefer32Bit: false,
        bitness: "64-bit",
        machine: "64797",
      },
      "unknown (64-bit, PE machine type 64797)",
    ],
  ] as const)("prints the architecture %j", (architecture, text) => {
    const summary: AssemblySummary = {
      ...winForms,
      architecture: { ...winForms.architecture, ...architecture },
    };

    expect(line(summary, "Architecture")).toBe(`Architecture      ${text}`);
  });

  it.each([
    ["console", "Console"],
    ["wpf", "WPF"],
    ["windows", "Windows GUI, neither WinForms nor WPF"],
  ] as const)("names the output kind %s", (outputKind, text) => {
    expect(line({ ...winForms, outputKind }, "Output kind")).toBe(
      `Output kind       ${text}`,
    );
  });
});
