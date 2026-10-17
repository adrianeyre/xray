import { describe, expect, it } from "vitest";

import {
  asEngineInspection,
  inferTargetFramework,
  OBFUSCATOR_ATTRIBUTES,
  summarizeAssembly,
  targetFrameworkMoniker,
  targetFrameworkSupport,
  type AssemblyIdentity,
  type EngineInspection,
} from "./assembly-summary.js";

function reference(name: string, version = "4.0.0.0"): AssemblyIdentity {
  return { name, version, culture: null, publicKeyToken: "b77a5c561934e089" };
}

/** A .NET 8 AnyCPU console program, as the engine reads it. */
const consoleApp: EngineInspection = {
  assembly: {
    name: "App",
    version: "1.0.0.0",
    culture: null,
    publicKeyToken: null,
  },
  references: [reference("System.Runtime", "8.0.0.0")],
  targetFramework: ".NETCoreApp,Version=v8.0",
  targetPlatform: null,
  runtimeVersion: "v4.0.30319",
  machine: "I386",
  pe32Plus: false,
  corFlags: { ilOnly: true, requires32Bit: false, prefers32Bit: false },
  subsystem: "windows-cui",
  entryPoint: { type: "App.Program", method: "Main" },
  typeCount: 1,
  methodCount: 1,
  resourceCount: 0,
  obfuscation: {
    attributes: ["System.Runtime.Versioning.TargetFrameworkAttribute"],
    names: {
      count: 40,
      unprintable: 0,
      short: 2,
      unprintableExamples: [],
      shortExamples: ["X", "Y"],
    },
    strings: { literals: 12, decoderCalls: 0, decoderTypes: [] },
  },
};

type Evidence = EngineInspection["obfuscation"];

/** What the engine counted of {@link consoleApp}, with `changes` to its names and strings. */
function evidence(changes: {
  readonly attributes?: Evidence["attributes"];
  readonly names?: Partial<Evidence["names"]>;
  readonly strings?: Partial<Evidence["strings"]>;
}): Evidence {
  const { obfuscation } = consoleApp;
  return {
    attributes: changes.attributes ?? obfuscation.attributes,
    names: { ...obfuscation.names, ...changes.names },
    strings: { ...obfuscation.strings, ...changes.strings },
  };
}

function summarize(changes: Partial<EngineInspection>) {
  return summarizeAssembly("/app.exe", { ...consoleApp, ...changes });
}

describe("targetFrameworkMoniker", () => {
  it.each([
    [".NETCoreApp,Version=v8.0", null, "net8.0"],
    [".NETCoreApp,Version=v10.0", null, "net10.0"],
    [".NETCoreApp,Version=v5.0", null, "net5.0"],
    [".NETCoreApp,Version=v3.1", null, "netcoreapp3.1"],
    [".NETCoreApp,Version=v2.1", null, "netcoreapp2.1"],
    [".NETCoreApp,Version=v8.0", "Windows7.0", "net8.0-windows7.0"],
    [".NETCoreApp,Version=v9.0", "Android", "net9.0-android"],
    [".NETFramework,Version=v4.8.1", null, "net481"],
    [".NETFramework,Version=v4.7.2", null, "net472"],
    [".NETFramework,Version=v4.5", null, "net45"],
    [".NETFramework,Version=v4.0", null, "net40"],
    [".NETFramework,Version=v4.0,Profile=Client", null, "net40-client"],
    [".NETFramework,Version=v3.5", null, "net35"],
    [".NETStandard,Version=v2.0", null, "netstandard2.0"],
    [".NETStandard,Version=v2.1", null, "netstandard2.1"],
    [".NETFramework, Version=v4.6.1", null, "net461"],
  ])("names %s (platform %s) %s", (frameworkName, platform, moniker) => {
    expect(targetFrameworkMoniker(frameworkName, platform)).toBe(moniker);
  });

  it.each([
    [null],
    [""],
    ["Silverlight,Version=v5.0"],
    [".NETPortable,Version=v4.5,Profile=Profile259"],
    [".NETFramework,Version=v4.0,Profile=Full"],
    [".NETCoreApp"],
    [".NETCoreApp,Version=8"],
    [".NETCoreApp,Version=v8"],
    [".NETCoreApp,Version=v8.0,junk"],
  ])("cannot name %j", (frameworkName) => {
    expect(targetFrameworkMoniker(frameworkName, null)).toBeNull();
  });

  it("cannot name a platform it cannot read", () => {
    expect(
      targetFrameworkMoniker(".NETCoreApp,Version=v8.0", "Windows 7"),
    ).toBeNull();
  });

  it("ignores a platform before .NET 5, which had none", () => {
    expect(
      targetFrameworkMoniker(".NETCoreApp,Version=v3.1", "Windows7.0"),
    ).toBe("netcoreapp3.1");
  });
});

describe("inferTargetFramework", () => {
  const mscorlib = reference("mscorlib", "2.0.0.0");

  it.each([
    [[mscorlib, reference("System.Core", "3.5.0.0")], "System.Core 3.5.0.0"],
    [
      [mscorlib, reference("System.Xml.Linq", "3.5.0.0")],
      "System.Xml.Linq 3.5.0.0",
    ],
    [
      [
        mscorlib,
        {
          name: "WindowsBase",
          version: "3.0.0.0",
          culture: null,
          publicKeyToken: "31bf3856ad364e35",
        },
      ],
      "WindowsBase 3.0.0.0",
    ],
  ])("tells net35 from CLR 2.0 and a reference to %j", (references, why) => {
    expect(inferTargetFramework("v2.0.50727", references)).toEqual({
      moniker: "net35",
      inferredFrom: `CLR v2.0.50727 and its reference to ${why}`,
    });
  });

  it.each([
    [[mscorlib, reference("System", "2.0.0.0")]],
    [[]],
    // Another's assembly at 3.5 is not the framework's.
    [
      [
        mscorlib,
        {
          name: "Vendor.Grid",
          version: "3.5.0.0",
          culture: null,
          publicKeyToken: "0123456789abcdef",
        },
      ],
    ],
    [
      [
        mscorlib,
        { ...reference("Vendor.Grid", "3.5.0.0"), publicKeyToken: null },
      ],
    ],
  ])("tells net20 from CLR 2.0 and only references like %j", (references) => {
    expect(inferTargetFramework("v2.0.50727", references)).toEqual({
      moniker: "net20",
      inferredFrom:
        "CLR v2.0.50727, and no reference to an assembly of .NET Framework 3.0 or 3.5",
    });
  });

  it.each([["v1.1.4322"], ["v1.0.3705"], ["v4.0.30319"], ["Silverlight"]])(
    "tells nothing from CLR %s",
    (runtimeVersion) => {
      expect(
        inferTargetFramework(runtimeVersion, [
          reference("System.Core", "3.5.0.0"),
        ]),
      ).toBeNull();
    },
  );
});

describe("targetFrameworkSupport", () => {
  it.each([
    ["net40"],
    ["net40-client"],
    ["net45"],
    ["net48"],
    ["net481"],
    ["netcoreapp3.1"],
    ["net5.0"],
    ["net8.0"],
    ["net8.0-windows7.0"],
    ["net10.0"],
  ])("fully supports %s, as FR-8 does", (moniker) => {
    expect(targetFrameworkSupport(moniker)).toBe("full");
  });

  it.each([
    ["net20"],
    ["net35"],
    ["netstandard1.3"],
    ["netstandard2.0"],
    ["netstandard2.1"],
    ["netcoreapp2.1"],
    ["netcoreapp3.0"],
  ])("supports %s as best it can", (moniker) => {
    expect(targetFrameworkSupport(moniker)).toBe("best-effort");
  });

  it("supports no framework without a moniker", () => {
    expect(targetFrameworkSupport(null)).toBe("none");
  });
});

describe("summarizeAssembly", () => {
  it("keeps what the engine read, finds no PDB when none was checked, and no sign of obfuscation in ordinary code", () => {
    expect(summarizeAssembly("/app.exe", consoleApp)).toEqual({
      path: "/app.exe",
      assembly: consoleApp.assembly,
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
      references: consoleApp.references,
      counts: { types: 1, methods: 1, resources: 0 },
      pdb: { status: "none" },
      obfuscation: { status: "clean", indicators: [] },
    });
  });

  it("says the PDB beside it is its own, and in which format, when the engine finds it is", () => {
    expect(
      summarizeAssembly(
        "/abs/App.dll",
        { ...consoleApp, pdb: { format: "windows", mismatch: null } },
        "/abs/App.pdb",
      ).pdb,
    ).toEqual({ status: "matching", path: "/abs/App.pdb", format: "windows" });
  });

  it.each([
    [
      { format: "portable", mismatch: "other-build" },
      "mismatched",
      "App.pdb, a portable PDB, is not App.dll's own: its ID is not the one App.dll records, so it is another build's.",
    ],
    [
      { format: "windows", mismatch: "unrecorded" },
      "mismatched",
      "App.pdb, a Windows PDB, is not App.dll's own: App.dll records no PDB, as it was built without debug information.",
    ],
    [
      { format: null, mismatch: "unreadable" },
      "unreadable",
      "App.pdb is not a PDB: it is neither a portable nor a Windows one.",
    ],
    [
      { format: "portable", mismatch: "unreadable" },
      "unreadable",
      "App.pdb could not be read as a portable PDB.",
    ],
  ] as const)(
    "says why the PDB beside it is not used when the engine finds %j",
    (check, status, reason) => {
      expect(
        summarizeAssembly(
          "/abs/App.dll",
          { ...consoleApp, pdb: check },
          "/abs/App.pdb",
        ).pdb,
      ).toEqual({ status, path: "/abs/App.pdb", format: check.format, reason });
    },
  );

  it("finds no PDB when there is none beside it to check", () => {
    expect(summarizeAssembly("/abs/App.dll", consoleApp, null).pdb).toEqual({
      status: "none",
    });
  });

  it("keeps the CLR version when there is no TargetFrameworkAttribute, and tells no framework from a later CLR's", () => {
    expect(
      summarize({ targetFramework: null, runtimeVersion: "v4.0.30319" })
        .targetFramework,
    ).toEqual({
      moniker: null,
      frameworkName: null,
      runtimeVersion: "v4.0.30319",
      inferredFrom: null,
      support: "none",
    });
  });

  it("tells net35 from CLR 2.0 and a reference to .NET Framework 3.5, as no TargetFrameworkAttribute can", () => {
    expect(
      summarize({
        targetFramework: null,
        runtimeVersion: "v2.0.50727",
        references: [
          reference("mscorlib", "2.0.0.0"),
          reference("System.Core", "3.5.0.0"),
        ],
      }).targetFramework,
    ).toEqual({
      moniker: "net35",
      frameworkName: null,
      runtimeVersion: "v2.0.50727",
      inferredFrom: "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
      support: "best-effort",
    });
  });

  it("ignores a TargetFrameworkAttribute's absence when it has one", () => {
    expect(
      summarize({
        targetFramework: ".NETFramework,Version=v4.0",
        references: [reference("mscorlib", "4.0.0.0")],
      }).targetFramework,
    ).toEqual({
      moniker: "net40",
      frameworkName: ".NETFramework,Version=v4.0",
      runtimeVersion: "v4.0.30319",
      inferredFrom: null,
      support: "full",
    });
  });

  describe("architecture", () => {
    it.each([
      [
        "AnyCPU",
        "I386",
        { ilOnly: true, requires32Bit: false, prefers32Bit: false },
        false,
        { platformTarget: "AnyCPU", prefer32Bit: false, bitness: "any" },
      ],
      [
        "AnyCPU, 32-bit preferred",
        "I386",
        { ilOnly: true, requires32Bit: true, prefers32Bit: true },
        false,
        { platformTarget: "AnyCPU", prefer32Bit: true, bitness: "any" },
      ],
      [
        "x86",
        "I386",
        { ilOnly: true, requires32Bit: true, prefers32Bit: false },
        false,
        { platformTarget: "x86", prefer32Bit: false, bitness: "32-bit" },
      ],
      [
        "x86 with machine code beside its IL",
        "I386",
        { ilOnly: false, requires32Bit: false, prefers32Bit: false },
        false,
        { platformTarget: "x86", prefer32Bit: false, bitness: "32-bit" },
      ],
      [
        "x64",
        "Amd64",
        { ilOnly: true, requires32Bit: false, prefers32Bit: false },
        true,
        { platformTarget: "x64", prefer32Bit: false, bitness: "64-bit" },
      ],
      [
        "ARM64",
        "Arm64",
        { ilOnly: true, requires32Bit: false, prefers32Bit: false },
        true,
        { platformTarget: "ARM64", prefer32Bit: false, bitness: "64-bit" },
      ],
      [
        "ARM",
        "ArmThumb2",
        { ilOnly: true, requires32Bit: false, prefers32Bit: false },
        false,
        { platformTarget: "ARM", prefer32Bit: false, bitness: "32-bit" },
      ],
      [
        "an unknown 64-bit machine",
        "64797",
        { ilOnly: false, requires32Bit: false, prefers32Bit: false },
        true,
        { platformTarget: null, prefer32Bit: false, bitness: "64-bit" },
      ],
      [
        "an unknown 32-bit machine",
        "4660",
        { ilOnly: true, requires32Bit: false, prefers32Bit: false },
        false,
        { platformTarget: null, prefer32Bit: false, bitness: "32-bit" },
      ],
    ] as const)("is %s", (_, machine, corFlags, pe32Plus, expected) => {
      expect(summarize({ machine, corFlags, pe32Plus }).architecture).toEqual({
        ...expected,
        machine,
      });
    });
  });

  describe("output kind", () => {
    const gui = { subsystem: "windows-gui" } as const;

    it.each([
      ["library", { entryPoint: null }],
      [
        "library",
        {
          ...gui,
          entryPoint: null,
          references: [reference("PresentationFramework")],
        },
      ],
      ["console", {}],
      ["console", { references: [reference("System.Windows.Forms")] }],
      ["winforms", { ...gui, references: [reference("System.Windows.Forms")] }],
      ["wpf", { ...gui, references: [reference("PresentationFramework")] }],
      [
        "wpf",
        {
          ...gui,
          references: [
            reference("System.Windows.Forms"),
            reference("PresentationFramework"),
          ],
        },
      ],
      ["windows", gui],
    ] as const)("is %s for %j", (kind, changes) => {
      expect(summarize(changes).outputKind).toBe(kind);
    });
  });

  it("sorts references by name, regardless of case", () => {
    const names = summarize({
      references: [
        reference("System.Runtime"),
        reference("mscorlib"),
        reference("System.Console"),
        reference("Newtonsoft.Json"),
      ],
    }).references.map((r) => r.name);

    expect(names).toEqual([
      "mscorlib",
      "Newtonsoft.Json",
      "System.Console",
      "System.Runtime",
    ]);
  });

  describe("obfuscation", () => {
    it.each([
      ["ConfusedByAttribute", "ConfuserEx"],
      ["DotfuscatorAttribute", "Dotfuscator"],
      ["SmartAssembly.Attributes.PoweredByAttribute", "SmartAssembly"],
    ])("flags an Assembly bearing %s, %s's mark", (attribute, obfuscator) => {
      const { obfuscation } = summarize({
        obfuscation: evidence({
          attributes: [
            "System.Runtime.Versioning.TargetFrameworkAttribute",
            attribute,
          ],
        }),
      });

      expect(obfuscation).toEqual({
        status: "obfuscated",
        indicators: [
          {
            kind: "obfuscator-attribute",
            evidence: [attribute],
            message: `It bears ${attribute}, the attribute ${obfuscator} marks what it has obfuscated with.`,
          },
        ],
      });
    });

    it("knows each obfuscator's attribute by its full name", () => {
      expect(OBFUSCATOR_ATTRIBUTES.size).toBeGreaterThanOrEqual(10);
      for (const [attribute, obfuscator] of OBFUSCATOR_ATTRIBUTES) {
        expect(attribute).toMatch(/^[\w.]+$/);
        expect(obfuscator).not.toBe("");
      }
    });

    it.each([
      ["System.Reflection.ObfuscationAttribute"],
      ["System.Reflection.ObfuscateAssemblyAttribute"],
      ["Other.ConfusedByAttribute"],
    ])("does not flag an Assembly bearing %s", (attribute) => {
      expect(
        summarize({ obfuscation: evidence({ attributes: [attribute] }) })
          .obfuscation,
      ).toEqual({ status: "clean", indicators: [] });
    });

    it("flags an Assembly with any name no source file shows, saying how many and showing the first few escaped", () => {
      const { obfuscation } = summarize({
        obfuscation: evidence({
          names: {
            count: 300,
            unprintable: 1,
            unprintableExamples: ["\u200B\u202Ea"],
          },
        }),
      });

      expect(obfuscation).toEqual({
        status: "obfuscated",
        indicators: [
          {
            kind: "mangled-identifiers",
            evidence: ["\u200B\u202Ea"],
            message:
              "1 of its 300 names holds characters no source file shows, such as \\u200B\\u202Ea: names an obfuscator gives, not a programmer.",
          },
        ],
      });
    });

    it.each([
      [10, 5, true],
      [81, 79, true],
      [81, 40, false],
      [9, 9, false],
      [40, 2, false],
    ])(
      "with %i names, %i of them short, %s flags short names",
      (count, short, flagged) => {
        const { obfuscation } = summarize({
          obfuscation: evidence({
            names: { count, short, shortExamples: ["A", "a", "B", "b", "C"] },
          }),
        });

        expect(obfuscation.status).toBe(flagged ? "obfuscated" : "clean");
        expect(obfuscation.indicators.map(({ kind }) => kind)).toEqual(
          flagged ? ["mangled-identifiers"] : [],
        );
      },
    );

    it("says how many names are short, and which, as an obfuscator renames them", () => {
      const [indicator] = summarize({
        obfuscation: evidence({
          names: {
            count: 81,
            short: 79,
            shortExamples: ["A", "a", "B", "b", "C"],
          },
        }),
      }).obfuscation.indicators;

      expect(indicator?.message).toBe(
        "79 of its 81 names (97%) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer.",
      );
    });

    it("gives one sign for names both unprintable and short", () => {
      const [indicator, ...others] = summarize({
        obfuscation: evidence({
          names: {
            count: 20,
            unprintable: 20,
            short: 20,
            unprintableExamples: ["\u0001"],
            shortExamples: ["\u0001"],
          },
        }),
      }).obfuscation.indicators;

      expect(others).toEqual([]);
      expect(indicator).toMatchObject({
        kind: "mangled-identifiers",
        evidence: ["\u0001"],
        message:
          "20 of its 20 names hold characters no source file shows, such as \\u0001; and 20 of its 20 names (100%) are one or two characters long: names an obfuscator gives, not a programmer.",
      });
    });

    it.each([
      [0, 23, true],
      [5, 5, true],
      [6, 5, false],
      [0, 0, false],
      [1992, 6, false],
    ])(
      "with %i literals and %i calls to string decoders, %s flags hidden strings",
      (literals, decoderCalls, flagged) => {
        const { obfuscation } = summarize({
          obfuscation: evidence({
            strings: {
              literals,
              decoderCalls,
              decoderTypes: decoderCalls === 0 ? [] : ["Secrets.Strings"],
            },
          }),
        });

        expect(obfuscation.status).toBe(flagged ? "obfuscated" : "clean");
        expect(obfuscation.indicators).toEqual(
          flagged
            ? [
                {
                  kind: "encrypted-strings",
                  evidence: ["Secrets.Strings"],
                  message: `Its strings are hidden: ${decoderCalls} calls fetch them from string decoders, which decode them from bytes (in Secrets.Strings), against ${literals} literal${literals === 1 ? "" : "s"}.`,
                },
              ]
            : [],
        );
      },
    );

    it("gives every sign it finds, attributes first", () => {
      const { obfuscation } = summarize({
        obfuscation: evidence({
          attributes: ["ConfusedByAttribute"],
          names: { count: 10, short: 10 },
          strings: { literals: 0, decoderCalls: 1, decoderTypes: ["S"] },
        }),
      });

      expect(obfuscation.indicators.map(({ kind }) => kind)).toEqual([
        "obfuscator-attribute",
        "mangled-identifiers",
        "encrypted-strings",
      ]);
    });
  });

  it("copies nothing the engine sends beyond what it describes", () => {
    const summary = summarize({
      assembly: { ...consoleApp.assembly, extra: 1 } as AssemblyIdentity,
      references: [
        { ...reference("System.Runtime"), extra: 2 } as AssemblyIdentity,
      ],
      entryPoint: {
        type: "App.Program",
        method: "Main",
        extra: 3,
      } as EngineInspection["entryPoint"],
    });

    expect(JSON.stringify(summary)).not.toContain("extra");
  });
});

describe("asEngineInspection", () => {
  const answer = consoleApp as unknown as Record<string, unknown>;

  it("accepts a well-formed answer", () => {
    expect(asEngineInspection(answer)).toBe(answer);
  });

  it.each([
    ["no PDB checked", null],
    ["its own PDB", { format: "portable", mismatch: null }],
    ["another build's PDB", { format: "windows", mismatch: "other-build" }],
    ["no PDB at all", { format: null, mismatch: "unreadable" }],
  ])("accepts an answer with %s", (_, pdb) => {
    expect(asEngineInspection({ ...answer, pdb })).toBeDefined();
  });

  it.each([
    ["no assembly", { assembly: undefined }],
    [
      "a reference without a version",
      { references: [{ name: "x", culture: null, publicKeyToken: null }] },
    ],
    ["references that are not a list", { references: {} }],
    ["a numeric target framework", { targetFramework: 8 }],
    ["no runtime version", { runtimeVersion: undefined }],
    ["a numeric machine", { machine: 332 }],
    ["no CorFlags", { corFlags: undefined }],
    [
      "CorFlags missing one",
      { corFlags: { ilOnly: true, requires32Bit: false } },
    ],
    ["no subsystem", { subsystem: undefined }],
    [
      "an entry point without a method",
      { entryPoint: { type: "App.Program" } },
    ],
    ["a negative count", { typeCount: -1 }],
    ["a fractional count", { methodCount: 1.5 }],
    ["a missing count", { resourceCount: undefined }],
    [
      "a PDB of a format it does not know",
      { pdb: { format: "mdb", mismatch: null } },
    ],
    ["a PDB check without its mismatch", { pdb: { format: "portable" } }],
    ["a PDB check that is not an object", { pdb: "portable" }],
    ["no obfuscation evidence", { obfuscation: undefined }],
    [
      "attributes that are not strings",
      { obfuscation: { ...consoleApp.obfuscation, attributes: [1] } },
    ],
    [
      "names without a count of short ones",
      {
        obfuscation: {
          ...consoleApp.obfuscation,
          names: { ...consoleApp.obfuscation.names, short: undefined },
        },
      },
    ],
    [
      "a negative count of literals",
      {
        obfuscation: {
          ...consoleApp.obfuscation,
          strings: { ...consoleApp.obfuscation.strings, literals: -1 },
        },
      },
    ],
    [
      "decoder types that are not a list",
      {
        obfuscation: {
          ...consoleApp.obfuscation,
          strings: { ...consoleApp.obfuscation.strings, decoderTypes: "S" },
        },
      },
    ],
  ])("rejects an answer with %s", (_, changes) => {
    expect(asEngineInspection({ ...answer, ...changes })).toBeUndefined();
  });
});
