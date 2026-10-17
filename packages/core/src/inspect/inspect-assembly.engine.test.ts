import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildFixture,
  listFixtures,
  NATIVE_EXECUTABLE_FIXTURE,
} from "@xray/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inspectAssembly } from "./inspect-assembly.js";

// These run the real engine, built by the global setup (../engine/build-engine.ts),
// on real files: a built Fixture, the committed native Fixture, and files of our own.

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "xray-inspect-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const RUNTIME_REFERENCE = {
  version: "8.0.0.0",
  culture: null,
  // Microsoft's key for the .NET reference assemblies.
  publicKeyToken: "b03f5f7f11d50a3a",
};

describe("inspectAssembly (against the real engine)", () => {
  it(
    "summarizes the arithmetic Fixture as its project and source describe it",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");

      const inspection = await inspectAssembly(assemblyPath);

      expect(inspection).toMatchObject({
        accepted: true,
        classification: { kind: "managed-assembly" },
      });
      expect(inspection.accepted && inspection.summary).toEqual({
        path: assemblyPath,
        // Arithmetic.csproj sets no AssemblyName, Version or signing key.
        assembly: {
          name: "Arithmetic",
          version: "1.0.0.0",
          culture: null,
          publicKeyToken: null,
        },
        // <TargetFramework>net8.0</TargetFramework>
        targetFramework: {
          moniker: "net8.0",
          frameworkName: ".NETCoreApp,Version=v8.0",
          runtimeVersion: "v4.0.30319",
          inferredFrom: null,
          support: "full",
        },
        // No PlatformTarget, so the SDK's AnyCPU.
        architecture: {
          platformTarget: "AnyCPU",
          prefer32Bit: false,
          bitness: "any",
          machine: "I386",
        },
        // Program.cs: `namespace Arithmetic; internal static class Program { static int Main(string[] args) … }`
        entryPoint: { type: "Arithmetic.Program", method: "Main" },
        // <OutputType>Exe</OutputType>
        outputKind: "console",
        // Console lives in System.Console; everything else it uses in System.Runtime.
        references: [
          { name: "System.Console", ...RUNTIME_REFERENCE },
          { name: "System.Runtime", ...RUNTIME_REFERENCE },
        ],
        // One type, Program: Main, Int32s, Int64s, Doubles, Decimals and the
        // four Parse methods. No embedded resources.
        counts: { types: 1, methods: 9, resources: 0 },
        // Built with the portable PDB the SDK writes by default, beside it.
        pdb: {
          status: "matching",
          path: join(dirname(assemblyPath), "Arithmetic.pdb"),
          format: "portable",
        },
        obfuscation: { status: "clean", indicators: [] },
      });
    },
    5 * 60_000,
  );

  it.each([
    ["none", null],
    ["another build's", "copied-binary"],
  ])(
    "says whether %s PDB beside the arithmetic Fixture is its own",
    async (_, other) => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const folder = await mkdtemp(join(scratch, "pdb-"));
      const copy = join(folder, "Arithmetic.dll");
      await copyFile(assemblyPath, copy);
      if (other !== null) {
        // Another Fixture's PDB, named as the arithmetic Fixture's would be.
        const built = await buildFixture(other);
        await copyFile(
          built.assemblyPath.replace(/\.dll$/, ".pdb"),
          join(folder, "Arithmetic.pdb"),
        );
      }

      const inspection = await inspectAssembly(copy);

      expect(inspection.accepted && inspection.summary.pdb).toEqual(
        other === null
          ? { status: "none" }
          : {
              status: "mismatched",
              path: join(folder, "Arithmetic.pdb"),
              format: "portable",
              reason:
                "Arithmetic.pdb, a portable PDB, is not Arithmetic.dll's own: its ID is not the one Arithmetic.dll records, so it is another build's.",
            },
      );
    },
    5 * 60_000,
  );

  it(
    "flags the obfuscated Fixture as obfuscated, by the names Obfuscar gave it and the strings it hid",
    async () => {
      const { assemblyPath } = await buildFixture("obfuscated");

      const inspection = await inspectAssembly(assemblyPath);

      if (!inspection.accepted) {
        expect.unreachable();
      }
      const { obfuscation } = inspection.summary;
      expect(obfuscation.status).toBe("obfuscated");
      // Obfuscar marks its output with no attribute of its own.
      expect(obfuscation.indicators.map(({ kind }) => kind)).toEqual([
        "mangled-identifiers",
        "encrypted-strings",
      ]);
      const [names, strings] = obfuscation.indicators;
      // Every type, method, field, property and event renamed A, a, B…,
      // but the two names of its string decoders' type: a GUID, and the field
      // holding their bytes.
      expect(names).toMatchObject({
        kind: "mangled-identifiers",
        evidence: ["A", "a", "B", "b", "C"],
      });
      const [, short, counted, percent] =
        /^(\d+) of its (\d+) names \((\d+)%\) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer\.$/.exec(
          names?.message ?? "",
        ) ?? expect.unreachable(names?.message);
      expect(Number(counted)).toBeGreaterThanOrEqual(50);
      expect(Number(short)).toBeLessThan(Number(counted));
      expect(Number(percent)).toBeGreaterThanOrEqual(90);
      // Every string it uses, each fetched by a call decoding it from bytes,
      // from one type Obfuscar added: none left as a literal.
      expect(strings).toMatchObject({
        kind: "encrypted-strings",
        evidence: [
          expect.stringMatching(
            /^<PrivateImplementationDetails>\{[0-9A-F-]{36}\}\.[0-9A-F-]{36}$/,
          ),
        ],
      });
      const [, calls] =
        /^Its strings are hidden: (\d+) calls fetch them from string decoders, which decode them from bytes \(in <PrivateImplementationDetails>\{.+\}\..+\), against 0 literals\.$/.exec(
          strings?.message ?? "",
        ) ?? expect.unreachable(strings?.message);
      expect(Number(calls)).toBeGreaterThanOrEqual(15);
      // Built without a PDB, which would name what Obfuscar renamed.
      expect(inspection.summary.pdb).toEqual({ status: "none" });
    },
    5 * 60_000,
  );

  it(
    "finds no sign of obfuscation in any Assembly any other Fixture builds: its own, its Sibling Assemblies', its NuGet packages' and its copied binaries'",
    async () => {
      const fixtures = (await listFixtures()).filter(
        (name) => name !== "obfuscated",
      );
      const flagged: string[] = [];
      let inspected = 0;
      for (const name of fixtures) {
        const { outputDirectory } = await buildFixture(name);
        for (const file of await readdir(outputDirectory)) {
          if (!/\.(dll|exe)$/i.test(file)) {
            continue;
          }
          const inspection = await inspectAssembly(join(outputDirectory, file));
          if (!inspection.accepted) {
            continue;
          }
          inspected++;
          const { obfuscation } = inspection.summary;
          if (obfuscation.status !== "clean") {
            flagged.push(
              `${name}/${file}: ${obfuscation.indicators.map(({ message }) => message).join(" ")}`,
            );
          }
        }
      }

      expect(flagged).toEqual([]);
      // Each Fixture's own, and those built beside them, Newtonsoft.Json and Serilog among them.
      expect(inspected).toBeGreaterThan(fixtures.length);
    },
    10 * 60_000,
  );

  it("does not inspect the native Fixture, but says why", async () => {
    const inspection = await inspectAssembly(NATIVE_EXECUTABLE_FIXTURE);

    expect(inspection).toEqual({
      accepted: false,
      classification: expect.objectContaining({
        kind: "native-executable",
        accepted: false,
      }) as unknown,
    });
  });

  it("does not inspect a text file", async () => {
    const path = join(scratch, "notes.txt");
    await writeFile(path, "Not an Assembly, just some text.\n");

    expect(await inspectAssembly(path)).toMatchObject({
      accepted: false,
      classification: { kind: "not-pe" },
    });
  });

  it("reports a missing file", async () => {
    const path = join(scratch, "no-such-file.dll");

    await expect(inspectAssembly(path)).rejects.toMatchObject({
      name: "InputError",
      code: "not-found",
    });
  });
});
