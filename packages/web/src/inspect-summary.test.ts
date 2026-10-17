import { describe, expect, it } from "vitest";

import type { InspectJson } from "./events.js";
import { inspectFacts, inspectJsonText } from "./inspect-summary.js";
import { ARITHMETIC } from "./test-inspection.js";

/** A strong-named .NET Framework 3.5 library for x86, from before TargetFrameworkAttribute. */
const LEGACY: InspectJson = {
  ...ARITHMETIC,
  path: "C:\\Apps\\Legacy.dll",
  assembly: {
    name: "Legacy",
    version: "2.1.0.0",
    culture: "fr-FR",
    publicKeyToken: "0123456789abcdef",
  },
  targetFramework: {
    moniker: "net35",
    frameworkName: null,
    runtimeVersion: "v2.0.50727",
    inferredFrom: "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
    support: "best-effort",
  },
  architecture: {
    platformTarget: "x86",
    prefer32Bit: false,
    bitness: "32-bit",
    machine: "I386",
  },
  entryPoint: null,
  outputKind: "library",
  references: [],
};

function facts(inspection: InspectJson): Record<string, string> {
  return Object.fromEntries(inspectFacts(inspection));
}

describe("the inspect summary", () => {
  it("shows every value of the xray inspect --json document but its schema version and references, which are listed apart", () => {
    const shown = inspectFacts(ARITHMETIC);
    const { schemaVersion, references, ...summarized } = ARITHMETIC;

    expect(schemaVersion).toBe(1);
    expect(references).toHaveLength(2);
    expect(shown.map(([label]) => label)).toHaveLength(
      new Set(shown.map(([label]) => label)).size,
    );
    const values = Object.values(summarized).flatMap((value) =>
      value !== null && typeof value === "object"
        ? Object.values(value)
        : [value],
    );
    // Enumerations are shown by name: console as Console, windows-cui as windows cui.
    const plain = (text: string) => text.toLowerCase().replaceAll("-", " ");
    for (const value of values) {
      if (typeof value === "string" || typeof value === "number") {
        expect(
          shown.some(([, text]) => plain(text).includes(plain(String(value)))),
          String(value),
        ).toBe(true);
      }
    }
  });

  it("says what a null in the document means, and names a library, a culture and a key", () => {
    expect(facts(LEGACY)).toMatchObject({
      Culture: "fr-FR",
      "Public key token": "0123456789abcdef",
      "Target framework": "net35",
      "Framework name": "none: no TargetFrameworkAttribute",
      "Runtime version": "v2.0.50727",
      "Told from": "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
      Support:
        "best effort: not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later",
      "Platform target": "x86",
      Bitness: "32-bit",
      "Entry point": "none: a library",
      "Output kind": "Library",
    });
    expect(
      facts({
        ...LEGACY,
        targetFramework: {
          ...LEGACY.targetFramework,
          moniker: null,
          inferredFrom: null,
          support: "none",
        },
        architecture: {
          platformTarget: null,
          prefer32Bit: false,
          bitness: "64-bit",
          machine: "LoongArch64",
        },
      }),
    ).toMatchObject({
      "Target framework": "unknown",
      "Told from": "nothing: it records no TargetFrameworkAttribute",
      Support: "none: no project can target it",
      "Platform target": "unknown",
      Machine: "LoongArch64",
    });
    expect(
      facts({
        ...ARITHMETIC,
        architecture: { ...ARITHMETIC.architecture, prefer32Bit: true },
        outputKind: "wpf",
      }),
    ).toMatchObject({ "Prefer 32-bit": "yes", "Output kind": "WPF" });
  });

  it.each([
    [{ status: "none" }, "none beside it"],
    [
      { status: "matching", path: "/app/Arithmetic.pdb", format: "windows" },
      "/app/Arithmetic.pdb (Windows), its own: used for local names and source layout",
    ],
    [
      {
        status: "unreadable",
        path: "/app/Arithmetic.pdb",
        format: null,
        reason:
          "Arithmetic.pdb is not a PDB: it is neither a portable nor a Windows one.",
      },
      "/app/Arithmetic.pdb, ignored: Arithmetic.pdb is not a PDB: it is neither a portable nor a Windows one.",
    ],
  ])("shows the PDB beside it, as xray inspect does: %j", (pdb, text) => {
    expect(facts({ ...ARITHMETIC, pdb })).toMatchObject({ PDB: text });
  });

  it("says, as xray inspect does, that an Assembly is likely obfuscated, so reconstructed as it is, and each sign why", () => {
    expect(
      facts({
        ...ARITHMETIC,
        obfuscation: {
          status: "obfuscated",
          indicators: [
            {
              kind: "mangled-identifiers",
              evidence: [],
              message:
                "79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer.",
            },
            {
              kind: "encrypted-strings",
              evidence: [],
              message: "Its strings are hidden: …",
            },
          ],
        },
      }),
    ).toMatchObject({
      Obfuscation:
        "likely obfuscated, so reconstructed as it is, not deobfuscated: 79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer. Its strings are hidden: …",
    });
    expect(facts(ARITHMETIC)).toMatchObject({
      Obfuscation: "clean: no sign of it found",
    });
  });

  it("shows a value added to an enumeration since as it is, as the schema says to treat it as other", () => {
    expect(
      facts({
        ...ARITHMETIC,
        outputKind: "maui",
        pdb: { status: "found" },
        obfuscation: { status: "suspected", indicators: [] },
      }),
    ).toMatchObject({
      "Output kind": "maui",
      PDB: "found",
      Obfuscation: "suspected",
    });
  });

  it("gives the document as xray inspect --json prints it, but for its last line break", () => {
    expect(`${inspectJsonText(ARITHMETIC)}\n`).toBe(
      `${JSON.stringify(ARITHMETIC, null, 2)}\n`,
    );
    expect(inspectJsonText(ARITHMETIC).split("\n").slice(0, 3)).toEqual([
      "{",
      '  "schemaVersion": 1,',
      '  "path": "/fixtures/arithmetic/Arithmetic.dll",',
    ]);
  });
});
