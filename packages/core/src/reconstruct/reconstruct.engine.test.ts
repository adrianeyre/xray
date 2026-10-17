import { existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  buildFixture,
  FIXTURES_DIRECTORY,
  formatRoundTrip,
  NATIVE_EXECUTABLE_FIXTURE,
  restoreFixture,
  roundTrip,
  runAssembly,
  runsOn,
  type Reconstruct,
} from "@xray/fixtures";
import { afterEach, describe, expect, it } from "vitest";

import { startEngine } from "../engine/engine-client.js";
import { inspectAssembly } from "../inspect/inspect-assembly.js";
import { defaultGlobalPackagesFolder } from "./package-sources.js";
import type { ProgressEvent } from "./progress.js";
import { reconstruct } from "./reconstruct.js";
import type { XrayReport } from "./xray-report.js";

// These run the real engine, built by the global setup (../engine/build-engine.ts),
// and the real `dotnet build`, on the real Fixtures.

const ROUND_TRIP_TIMEOUT_MS = 5 * 60_000;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
  temporary.push(folder);
  return folder;
}

/** The `xray-report.json` written into `folder`. */
async function reportIn(folder: string): Promise<unknown> {
  return JSON.parse(await readFile(join(folder, "xray-report.json"), "utf8"));
}

/** Core's Reconstruction, as the Round-trip harness runs it; anything short of Full fails. */
const xray: Reconstruct = async (assemblyPath, outputDirectory) => {
  const reconstruction = await reconstruct(assemblyPath, outputDirectory);
  if (!reconstruction.accepted) {
    throw new Error(reconstruction.classification.explanation);
  }
  if (reconstruction.outcome !== "full") {
    throw new Error(
      `Partial Reconstruction: the Recovered Solution did not build.\n${reconstruction.build?.output ?? ""}`,
    );
  }
};

/**
 * A copy of the build output holding the Assembly at `assemblyPath`, but not
 * its PDB, as an Assembly is often given: reconstructed from it, the
 * decompiler names its locals, and its files are laid out by namespace.
 */
async function withoutPdb(assemblyPath: string): Promise<string> {
  const copy = await scratch();
  const built = dirname(assemblyPath);
  for (const entry of await readdir(built, { withFileTypes: true })) {
    if (entry.isFile() && !/\.pdb$/i.test(entry.name)) {
      await copyFile(join(built, entry.name), join(copy, entry.name));
    }
  }
  return join(copy, basename(assemblyPath));
}

/** As {@link xray}, of the Assembly without its PDB beside it. */
const xrayWithoutPdb: Reconstruct = async (assemblyPath, outputDirectory) =>
  xray(await withoutPdb(assemblyPath), outputDirectory);

describe("reconstruct (against the real engine)", () => {
  it(
    "makes a Full Reconstruction of the arithmetic Fixture, which passes the Round-trip",
    async () => {
      const result = await roundTrip("arithmetic", xray);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "makes a Full Reconstruction of the netcoreapp3.1 Fixture, which passes the Round-trip",
    async () => {
      const result = await roundTrip("netcoreapp31-console", xray);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "makes a Full Reconstruction of the unsafe-nullable Fixture, which passes the Round-trip",
    async () => {
      const result = await roundTrip("unsafe-nullable", xray);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // The ladder's next rungs (PRD §10), each a construct decompiled code must
  // keep exactly: control flow, classes and structs, generics, closures and
  // LINQ, async/await, then records and pattern matching, with the newer
  // language features beside them. Each is built with a PDB, which names its
  // locals and lays its files out (FR-4); each must pass without it too, as
  // the decompiler names and lays them out.
  const ladder = [
    "control-flow",
    "classes-structs",
    "generics",
    "closures-linq",
    "async-await",
    "records-patterns",
    "newer-features",
  ];
  it.each(ladder)(
    "makes a Full Reconstruction of the %s Fixture, which passes the Round-trip",
    async (fixture) => {
      const result = await roundTrip(fixture, xray);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.each(ladder)(
    "makes a Full Reconstruction of the %s Fixture without its PDB, which passes the Round-trip",
    async (fixture) => {
      const result = await roundTrip(fixture, xrayWithoutPdb);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // The compiler turns lambdas into closure classes and async methods and
  // iterators into state machines; each must come back as the C# it was,
  // even with no PDB to say what its locals were called.
  it.each([
    [
      "closures-linq",
      [
        "Func<int, int> result = (int value) => value + amount;",
        "var obj = (int value, int by = 3) => value * by;",
        "from word in words",
        "join team in Teams on person.Team equals team.Name into teams",
        // A query the continuation follows is parenthesized, or it takes the
        // continuation as its own (CS1931).
        "select Part(t)) into g",
        "select n + 1) into g",
        "yield return start + i;",
        "yield break;",
        "IEnumerable<int> Range()",
        "Expression<Func<int, int, int>> expression = (int a, int b) => a * b + (a - b) % 3;",
      ],
    ],
    [
      "async-await",
      [
        "private static async Task<int> Main(string[] args)",
        "public static async ValueTask<int> SquareAsync(int value)",
        "Func<int, Task<int>> addLater = async (int value) =>",
        "async Task<string> DescribeAsync(int value)",
        "await context.Later().ConfigureAwait(continueOnCapturedContext: false);",
        "public static async IAsyncEnumerable<int> EvensAsync(int[] values, List<string> log, [EnumeratorCancellation] CancellationToken token = default(CancellationToken))",
        "await foreach (int item5 in TicksAsync(context, 2).ConfigureAwait(continueOnCapturedContext: false))",
        "await using Resource first = new Resource(name, log);",
      ],
    ],
  ])(
    "decompiles the %s Fixture's closures, iterators and async methods back to C#, not the classes the compiler made of them, without its PDB",
    async (fixture, expected) => {
      const { assemblyPath } = await buildFixture(fixture);
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        await withoutPdb(assemblyPath),
        output,
        { build: false },
      );

      if (!reconstruction.accepted) {
        throw new Error(reconstruction.classification.explanation);
      }
      const sources = reconstruction.solution.files.filter((file) =>
        file.endsWith(".cs"),
      );
      const code = (
        await Promise.all(
          sources.map((file) => readFile(join(output, file), "utf8")),
        )
      ).join("\n");
      for (const line of expected) {
        expect(code).toContain(line);
      }
      // No state machine, closure class or anything else the compiler names
      // <…>, which would be declared escaped, as _003C…
      expect(code).not.toMatch(
        /IAsyncStateMachine|StateMachine\(|MoveNext\(\)|<>1__state|_003C|DisplayClass/,
      );
      expect(sources.some((file) => /AnonymousDelegate|_003C/.test(file))).toBe(
        false,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // Records, primary constructors and file-scoped types must come back as
  // such, compiled as C# 12, the language they need; a copy, a throw
  // expression and an unmatched switch expression must come back as C# can
  // write them, not as the compiler's members and helpers; even with no PDB
  // to say what its locals were called, or which file each type was in.
  it.each([
    [
      "records-patterns",
      [
        "public record struct Point(int X, int Y)",
        "public readonly record struct Money(decimal Amount, string Currency)",
        "public abstract record Person(string Name)",
        "public sealed record Manager(string Name, int Level, int Reports) : Employee(Name, Level);",
        "public string Host\n\t{\n\t\tget\n\t\t{\n\t\t\treturn host;\n\t\t}\n\t\tinit",
        'employee with\n\t\t{\n\t\t\tTags = new string[1] { "remote" }\n\t\t};',
        "employee2 == employee2 with { }",
        "public override int GetHashCode()\n\t{\n\t\treturn 0;\n\t}",
        "throw new SwitchExpressionException(suit);",
      ],
      [],
    ],
    [
      "newer-features",
      [
        "public class Counter(string name, int start = 1)",
        "public sealed class Labelled(string label, int start, int end) : Interval(start, end)",
        "public struct Tally(int count)",
        "public sealed class Temperature(double celsius)",
        'private readonly double kelvin = ((celsius < -273.15) ? throw new ArgumentOutOfRangeException("celsius", $"{celsius} C is below absolute zero.") : (celsius + 273.15));',
        "file static class Format",
        "file sealed class Shouter : IShout",
        'return Format.Apply("hello, " + new Shouter().Shout(name));',
      ],
      // Each file-scoped type in the file it was declared in, as its name records.
      ["NewerFeatures/Files/Greetings.cs", "NewerFeatures/Files/Farewells.cs"],
    ],
  ])(
    "decompiles the %s Fixture's records, primary constructors and file-scoped types back to C# 12, without its PDB",
    async (fixture, expected, files) => {
      const { assemblyPath } = await buildFixture(fixture);
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(
        await withoutPdb(assemblyPath),
        output,
        { build: false },
      );

      if (!reconstruction.accepted) {
        throw new Error(reconstruction.classification.explanation);
      }
      const project = await readFile(
        join(output, reconstruction.solution.projectPath),
        "utf8",
      );
      expect(project).toContain("<LangVersion>12.0</LangVersion>");
      const sources = reconstruction.solution.files.filter((file) =>
        file.endsWith(".cs"),
      );
      expect(sources).toEqual(expect.arrayContaining(files));
      const code = (
        await Promise.all(
          sources.map((file) => readFile(join(output, file), "utf8")),
        )
      ).join("\n");
      for (const line of expected) {
        expect(code).toContain(line);
      }
      // No member, helper or name of the compiler's that C# cannot write.
      expect(code).not.toMatch(
        /PrivateImplementationDetails|_003CClone|_002Ector|\.ctor|_003C\w+_003EF[0-9A-F]{64}__|_003C\w+_003EP\b/,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // The regex source generator implements each [GeneratedRegex] method as the
  // Fixture is built, and again as its Recovered Solution is: each must come
  // back as the partial declaration it was, without what the generator wrote
  // of it, which it refuses (SYSLIB1043), with its PDB and without.
  describe("the generated-regex Fixture", () => {
    it(
      "makes a Full Reconstruction of it, which passes the Round-trip",
      async () => {
        const result = await roundTrip("generated-regex", xray);

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.runs.length).toBeGreaterThan(0);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "makes a Full Reconstruction of it without its PDB, which passes the Round-trip",
      async () => {
        const result = await roundTrip("generated-regex", xrayWithoutPdb);

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.runs.length).toBeGreaterThan(0);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it.each([
      // Laid out by the PDB, which records the file Patterns was declared in,
      // though none of its code is in it.
      ["with its PDB", "Lexicon/Text/Expressions.cs", false],
      ["without its PDB", "Lexicon/Text/Patterns.cs", true],
    ])(
      "declares each [GeneratedRegex] method partial, for the generator to implement again, %s",
      async (_, patterns, withoutItsPdb) => {
        const { assemblyPath } = await buildFixture("generated-regex");
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(
          withoutItsPdb ? await withoutPdb(assemblyPath) : assemblyPath,
          output,
          { build: false },
        );

        if (!reconstruction.accepted) {
          throw new Error(reconstruction.classification.explanation);
        }
        const sources = reconstruction.solution.files
          .filter((file) => file.endsWith(".cs"))
          .sort();
        expect(sources).toEqual(
          [
            "Lexicon/Document.cs",
            "Lexicon/Program.cs",
            "Lexicon/Properties/AssemblyInfo.cs",
            "Lexicon/Text/Masker.cs",
            "Lexicon/Token.cs",
            patterns,
          ].sort(),
        );
        const code = (
          await Promise.all(
            sources.map((file) => readFile(join(output, file), "utf8")),
          )
        ).join("\n");
        for (const line of [
          "internal static partial class Program",
          '\t[GeneratedRegex("^[a-z]+$")]\n\tprivate static partial Regex Command();',
          "internal static partial class Patterns",
          '\t[GeneratedRegex("-?\\\\d+", RegexOptions.CultureInvariant, 1000, "en-US")]\n\tpublic static partial Regex Number();',
          '\t[GeneratedRegex("hel+o", RegexOptions.IgnoreCase | RegexOptions.NonBacktracking)]\n\tpublic static partial Regex Greeting();',
          '\t[GeneratedRegex("^i$", RegexOptions.IgnoreCase, "tr-TR")]\n\tpublic static partial Regex TurkishI();',
          "internal sealed partial class Masker(char mask)",
          "\tprivate partial Regex Vowels();",
          "internal readonly partial record struct Token(string Text)",
          "internal partial class Document<T>(T title)",
          "\tinternal static partial class Splitter",
          "\t\tprivate static partial Regex Separator();",
        ]) {
          expect(code).toContain(line);
        }
        // Nothing the generator wrote: no Regex of its own, nor its Utilities.
        expect(code).not.toMatch(
          /\[GeneratedCode\(|RegularExpressions\.Generated|RegexRunner|Utilities|_[0-9]+\.Instance\b|_003CRegexGenerator_g_003E/,
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  it(
    "recovers the unsafe-nullable Fixture's project properties, rebuilding an Assembly with the same name, version and attributes",
    async () => {
      const { assemblyPath } = await buildFixture("unsafe-nullable");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      // Unsafe code would not compile without AllowUnsafeBlocks (CS0227), and
      // an attribute declared twice would not either (CS0579): it builds
      // without a single warning.
      expect(reconstruction).toMatchObject({
        accepted: true,
        solution: {
          solutionPath: "Xray.UnsafeNullable.sln",
          projectPath: "Xray.UnsafeNullable/Xray.UnsafeNullable.csproj",
        },
        build: { succeeded: true, diagnostics: [] },
        outcome: "full",
      });
      if (!reconstruction.accepted) {
        throw new Error(reconstruction.classification.explanation);
      }
      // Laid out as the Fixture's source is, as its PDB records: Entry is
      // declared in Text/Directory.cs.
      expect(reconstruction.solution.files.toSorted()).toEqual([
        "Xray.UnsafeNullable.sln",
        "Xray.UnsafeNullable/Block.cs",
        "Xray.UnsafeNullable/Program.cs",
        "Xray.UnsafeNullable/Properties/AssemblyInfo.cs",
        "Xray.UnsafeNullable/Text/Directory.cs",
        "Xray.UnsafeNullable/Text/Nullability.cs",
        "Xray.UnsafeNullable/Xray.UnsafeNullable.csproj",
        "xray-report.json",
      ]);
      const project = await readFile(
        join(output, reconstruction.solution.projectPath),
        "utf8",
      );
      expect(project).toContain(
        "<AssemblyName>Xray.UnsafeNullable</AssemblyName>",
      );
      expect(project).toContain(
        "<RootNamespace>Fixtures.Pointers</RootNamespace>",
      );
      expect(project).toContain("<AllowUnsafeBlocks>true</AllowUnsafeBlocks>");
      expect(project).toContain("<Nullable>annotations</Nullable>");

      const rebuilt = join(
        output,
        "Xray.UnsafeNullable",
        "bin",
        "Debug",
        "net8.0",
        basename(assemblyPath),
      );
      expect(await inspectAssembly(rebuilt)).toMatchObject({
        accepted: true,
        summary: { assembly: reconstruction.summary.assembly },
      });
      // Each prints its full name, then every assembly and module attribute.
      const [original, recovered] = await Promise.all(
        [assemblyPath, rebuilt].map((path) => runAssembly(path, ["assembly"])),
      );
      expect(original?.stdout).toContain(
        "Xray.UnsafeNullable, Version=2.3.4.5, Culture=neutral, PublicKeyToken=null",
      );
      expect(original?.stdout).toContain(
        "[module: System.Security.UnverifiableCodeAttribute()]",
      );
      expect(recovered).toEqual(original);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // A .NET Framework program runs only on Windows; elsewhere, the next test
  // shows its Recovered Solution builds, for the same framework.
  it.runIf(runsOn("net48"))(
    "makes a Full Reconstruction of the net48 Fixture, which passes the Round-trip",
    async () => {
      const result = await roundTrip("net48-console", xray);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.each([
    ["net48-console", "net48", ".NETFramework,Version=v4.8"],
    ["netcoreapp31-console", "netcoreapp3.1", ".NETCoreApp,Version=v3.1"],
  ])(
    "keeps the %s Fixture's target framework, %s, exactly, in the project and in what it builds",
    async (fixture, moniker, frameworkName) => {
      const { assemblyPath, targetFramework } = await buildFixture(fixture);
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      expect(targetFramework).toBe(moniker);
      expect(reconstruction).toMatchObject({
        accepted: true,
        summary: { targetFramework: { moniker, frameworkName } },
        solution: { targetFramework: moniker },
        build: { succeeded: true },
        outcome: "full",
      });
      if (!reconstruction.accepted) {
        throw new Error(reconstruction.classification.explanation);
      }
      const project = await readFile(
        join(output, reconstruction.solution.projectPath),
        "utf8",
      );
      expect(project).toMatch(/^<Project Sdk="Microsoft\.NET\.Sdk">/);
      expect(project).toContain(
        `<TargetFramework>${moniker}</TargetFramework>`,
      );
      // .NET Framework's reference assemblies come from NuGet, on any OS.
      expect(
        project.includes(
          '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />',
        ),
      ).toBe(moniker === "net48");
      // The rebuilt Assembly records the same framework as the original.
      const name = reconstruction.summary.assembly.name;
      const rebuilt = join(
        output,
        name,
        "bin",
        "Debug",
        moniker,
        basename(assemblyPath),
      );
      expect(await inspectAssembly(rebuilt)).toMatchObject({
        accepted: true,
        summary: { targetFramework: reconstruction.summary.targetFramework },
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // Frameworks FR-8 supports on a best-effort basis: a library for each, built
  // beside a .NET 8 program that uses it, which runs it on every OS.
  const bestEffort = [
    {
      fixture: "net35-library",
      library: "Gradebook",
      moniker: "net35",
      frameworkName: null,
      inferredFrom: "CLR v2.0.50727 and its reference to System.Core 3.5.0.0",
    },
    {
      fixture: "netstandard20-library",
      library: "Measures",
      moniker: "netstandard2.0",
      frameworkName: ".NETStandard,Version=v2.0",
      inferredFrom: null,
    },
  ];

  it.each(bestEffort)(
    "makes a Full Reconstruction of the $fixture Fixture, its $moniker library a project for $moniker again, warning it is supported on a best-effort basis, which passes the Round-trip",
    async ({ fixture, library, moniker }) => {
      const workDirectory = await scratch();

      const result = await roundTrip(fixture, xray, { workDirectory });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
      const { assemblyPath } = await buildFixture(fixture);
      const libraryPath = join(dirname(assemblyPath), `${library}.dll`);
      const report = (await reportIn(
        join(workDirectory, "recovered"),
      )) as XrayReport;
      expect(report).toMatchObject({
        outcome: "full",
        solution: {
          targetFramework: "net8.0",
          projects: [
            {
              assemblyPath,
              targetFramework: "net8.0",
              projectReferences: [`${library}/${library}.csproj`],
            },
            {
              assemblyPath: libraryPath,
              projectPath: `${library}/${library}.csproj`,
              targetFramework: moniker,
              outputType: "Library",
            },
          ],
        },
        warnings: [
          {
            kind: "best-effort-target-framework",
            assemblyPath: libraryPath,
          },
        ],
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.each(bestEffort)(
    "makes a Full Reconstruction of the $fixture Fixture without its PDBs, which passes the Round-trip",
    async ({ fixture }) => {
      const result = await roundTrip(fixture, xrayWithoutPdb);

      expect(result.passed, formatRoundTrip(result)).toBe(true);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it.each(bestEffort)(
    "reconstructs $library, the $fixture Fixture's library, on its own into a project for $moniker, which builds for the same framework, and says how far it is supported",
    async ({ fixture, library, moniker, frameworkName, inferredFrom }) => {
      const { outputDirectory } = await buildFixture(fixture);
      const libraryPath = join(outputDirectory, `${library}.dll`);
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(libraryPath, output, {
        siblings: false,
      });

      const targetFramework = {
        moniker,
        frameworkName,
        inferredFrom,
        support: "best-effort",
      };
      expect(reconstruction).toMatchObject({
        accepted: true,
        summary: { targetFramework, outputKind: "library" },
        solution: {
          projectPath: `${library}/${library}.csproj`,
          targetFramework: moniker,
          outputType: "Library",
        },
        build: { succeeded: true },
        outcome: "full",
        reasons: [],
        warnings: [
          {
            kind: "best-effort-target-framework",
            assemblyPath: libraryPath,
            message: expect.stringMatching(
              new RegExp(
                `^${library}\\.dll targets ${moniker.replace(".", "\\.")}, which Xray supports only on a best-effort basis`,
              ),
            ) as unknown,
          },
        ],
      });
      if (!reconstruction.accepted) {
        throw new Error(reconstruction.classification.explanation);
      }
      const project = await readFile(
        join(output, reconstruction.solution.projectPath),
        "utf8",
      );
      expect(project).toContain(
        `<TargetFramework>${moniker}</TargetFramework>`,
      );
      // .NET Framework's reference assemblies come from NuGet, on any OS.
      expect(
        project.includes(
          '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />',
        ),
      ).toBe(moniker === "net35");
      // The rebuilt Assembly is told to be for the same framework, as the original was.
      const rebuilt = join(
        output,
        library,
        "bin",
        "Debug",
        moniker,
        `${library}.dll`,
      );
      expect(await inspectAssembly(rebuilt)).toMatchObject({
        accepted: true,
        summary: { targetFramework },
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "lays the arithmetic Fixture out as <Name>.sln and <Name>/<Name>.csproj, keeping its target framework and output type",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      expect(reconstruction).toMatchObject({
        accepted: true,
        solution: {
          directory: output,
          solutionPath: "Arithmetic.sln",
          projectPath: "Arithmetic/Arithmetic.csproj",
          targetFramework: "net8.0",
          outputType: "Exe",
          // Program, in the root namespace: Arithmetic.
          files: [
            "Arithmetic.sln",
            "Arithmetic/Arithmetic.csproj",
            "Arithmetic/Properties/AssemblyInfo.cs",
            "Arithmetic/Program.cs",
            "xray-report.json",
          ],
          typeCount: 1,
        },
        build: { succeeded: true },
        outcome: "full",
      });
      expect(await reportIn(output)).toMatchObject({
        schemaVersion: 1,
        outcome: "full",
        reasons: [],
        inputs: { path: assemblyPath, options: { build: true, run: false } },
        inspect: { path: assemblyPath, assembly: { name: "Arithmetic" } },
        obfuscated: false,
        // Each of its references is the framework's.
        dependencies: [
          {
            reference: { name: "System.Console" },
            referencedBy: ["Arithmetic"],
            resolution: "framework",
          },
          {
            reference: { name: "System.Runtime" },
            referencedBy: ["Arithmetic"],
            resolution: "framework",
          },
        ],
        solution: { solutionPath: "Arithmetic.sln", typeCount: 1 },
        build: { succeeded: true },
      });
      expect((await readdir(output)).sort()).toEqual([
        "Arithmetic",
        "Arithmetic.sln",
        "xray-report.json",
      ]);
      const project = await readFile(
        join(output, "Arithmetic", "Arithmetic.csproj"),
        "utf8",
      );
      expect(project).toMatch(/^<Project Sdk="Microsoft\.NET\.Sdk">/);
      expect(project).toContain("<OutputType>Exe</OutputType>");
      expect(project).toContain("<TargetFramework>net8.0</TargetFramework>");
      expect(
        await readFile(join(output, "Arithmetic", "Program.cs"), "utf8"),
      ).toContain("internal static class Program");
      expect(
        await readFile(
          join(output, "Arithmetic", "Properties", "AssemblyInfo.cs"),
          "utf8",
        ),
      ).toContain('[assembly: AssemblyTitle("Arithmetic")]');
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "reports the arithmetic Fixture's progress through every stage, at least once a second",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const events: ProgressEvent[] = [];
      const arrivals: number[] = [];

      const reconstruction = await reconstruct(
        assemblyPath,
        join(await scratch(), "out"),
        {
          onProgress: (event) => {
            events.push(event);
            arrivals.push(performance.now());
          },
        },
      );

      expect(reconstruction).toMatchObject({ outcome: "full" });
      expect(
        events
          .filter((event) => event.kind !== "stage-progress")
          .map((event) => `${event.kind} ${event.stage}`),
      ).toEqual([
        "stage-started analyse",
        "stage-finished analyse",
        "stage-started decompile",
        "stage-finished decompile",
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
        "stage-started generate",
        "stage-finished generate",
        "stage-started build",
        "stage-finished build",
        "stage-skipped run",
      ]);
      const gaps = arrivals.slice(1).map((at, i) => at - (arrivals[i] ?? at));
      expect(Math.max(...gaps)).toBeLessThan(1_000);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "runs the arithmetic Fixture's rebuilt program when asked, recording its exit code and output",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const output = join(await scratch(), "out");
      const events: ProgressEvent[] = [];

      const reconstruction = await reconstruct(assemblyPath, output, {
        run: true,
        onProgress: (event) => events.push(event),
      });

      // Run with no arguments, the Fixture prints its usage and exits 1: a
      // Full Reconstruction all the same, as only a Round-trip can tell
      // whether the original would have exited so too.
      const run = {
        status: "exited",
        reason: null,
        program: "Arithmetic/bin/Debug/net8.0/Arithmetic.dll",
        exitCode: 1,
        stdout: "",
        stderr: expect.stringMatching(
          /^Usage: Arithmetic <int\|long\|double\|decimal> <left> <right>\r?\n$/,
        ) as unknown,
      };
      expect(reconstruction).toMatchObject({
        build: { succeeded: true },
        run,
        outcome: "full",
        reasons: [],
      });
      expect(
        events
          .filter((event) => event.kind !== "stage-progress")
          .map((event) => `${event.kind} ${event.stage}`)
          .slice(-3),
      ).toEqual([
        "stage-finished build",
        "stage-started run",
        "stage-finished run",
      ]);
      const report = JSON.parse(
        await readFile(join(output, "xray-report.json"), "utf8"),
      ) as XrayReport;
      expect(report).toMatchObject({
        outcome: "full",
        inputs: { options: { build: true, run: true } },
        run,
        timings: { run: expect.any(Number) as unknown },
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "makes a Partial Reconstruction of the missing-reference Fixture, naming its Unresolved Dependency, and giving the build's error at its file and line",
    async () => {
      const { assemblyPath } = await buildFixture("missing-reference");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      // Greetings.dll was left out of the Fixture's build output, so the
      // Recovered Solution cannot compile against it.
      const program = join(output, "MissingReference", "Program.cs");
      const lines = (await readFile(program, "utf8")).split(/\r?\n/);
      const line = lines.indexOf("using Greetings;") + 1;
      const error = {
        severity: "error",
        code: "CS0246",
        message:
          "The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)",
        file: "MissingReference/Program.cs",
        line,
        column: "using ".length + 1,
        project: "MissingReference/MissingReference.csproj",
      };
      // Nothing beside it is Greetings, so nothing satisfies the reference.
      const greetings = {
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
        path: null,
        reason:
          "Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
      };
      const reasons = [
        { kind: "unresolved-dependencies", dependencies: [greetings] },
        { kind: "build-failed", errors: [error] },
      ];
      expect(line).toBeGreaterThan(0);
      expect(reconstruction).toMatchObject({
        accepted: true,
        build: { succeeded: false },
        outcome: "partial",
        reasons,
      });
      expect(
        reconstruction.accepted &&
          reconstruction.dependencies.map(
            ({ reference, resolution }) => `${reference.name} ${resolution}`,
          ),
      ).toEqual([
        "Greetings unresolved",
        "System.Console framework",
        "System.Runtime framework",
      ]);
      expect(await reportIn(output)).toMatchObject({
        schemaVersion: 1,
        outcome: "partial",
        reasons,
        inputs: { path: assemblyPath, options: { build: true, run: false } },
        inspect: { assembly: { name: "MissingReference" } },
        build: { succeeded: false, diagnostics: [error] },
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  // Asked for a full PDB, the SDK writes a Windows one only on Windows.
  const debugSymbolsFormat =
    process.platform === "win32" ? "windows" : "portable";

  it(
    "makes a Full Reconstruction of the debug-symbols Fixture with its PDB, which passes the Round-trip, with its original local names and file layout",
    async () => {
      const workDirectory = await scratch();

      const result = await roundTrip("debug-symbols", xray, { workDirectory });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
      const recovered = join(workDirectory, "recovered");
      const report = (await reportIn(recovered)) as XrayReport;
      const { assemblyPath } = await buildFixture("debug-symbols");
      const pdb = {
        status: "matching",
        path: join(dirname(assemblyPath), "DebugSymbols.pdb"),
        format: debugSymbolsFormat,
      };
      expect(report).toMatchObject({
        outcome: "full",
        inspect: { pdb },
        // Eleven types, in the Fixture's six source files: its partial
        // Statement is declared once, in the file most of it was. A Windows
        // PDB records no file for its two enums, which have no code, so there
        // each is in a file of its own.
        solution: {
          typeCount: 11,
          sourceFileCount: debugSymbolsFormat === "portable" ? 6 : 8,
          projects: [{ pdb }],
        },
        warnings: [],
      });
      // As the Fixture's source is laid out, not by namespace (Ledger.Banking,
      // Ledger.Reports.Columns…). A Windows PDB records no file for a type
      // with no code of its own, so there its interface and enums are laid
      // out by namespace, below the root namespace, Ledger.
      expect(report.solution.files.toSorted()).toEqual(
        [
          "DebugSymbols.sln",
          "DebugSymbols/Accounts/Account.cs",
          "DebugSymbols/Accounts/Errors/InsufficientFundsException.cs",
          ...(debugSymbolsFormat === "portable"
            ? ["DebugSymbols/Accounts/IAccountSource.cs"]
            : [
                "DebugSymbols/Banking/IAccountSource.cs",
                "DebugSymbols/Banking/TransactionKind.cs",
                "DebugSymbols/Reports/Columns/Alignment.cs",
              ]),
          "DebugSymbols/DebugSymbols.csproj",
          "DebugSymbols/Program.cs",
          "DebugSymbols/Properties/AssemblyInfo.cs",
          "DebugSymbols/Reports/Formatting.cs",
          "DebugSymbols/Reports/Statement.cs",
          "xray-report.json",
        ].toSorted(),
      );
      const read = (file: string) =>
        readFile(join(recovered, "DebugSymbols", ...file.split("/")), "utf8");
      // The locals as the Fixture's source names them.
      const program = await read("Program.cs");
      expect(program).toContain('Account account = new Account("Savings");');
      expect(program).toContain("for (int position = 0;");
      expect(program).toContain("string operation = args[position];");
      expect(program).toContain("string given = args[position + 1];");
      const account = await read("Accounts/Account.cs");
      expect(account).toContain("decimal missing = amount - Balance;");
      expect(account).toContain("Transaction recorded = new Transaction(");
      // Each file's types, together, as they were declared.
      expect(account).toContain("public sealed record Transaction(");
      expect(
        debugSymbolsFormat === "portable"
          ? account
          : await read("Banking/TransactionKind.cs"),
      ).toContain("public enum TransactionKind");
      const formatting = await read("Reports/Formatting.cs");
      expect(formatting).toContain("file static class Widths");
      expect(formatting).toContain("namespace Ledger.Reports.Columns");
      const statement = await read("Reports/Statement.cs");
      expect(statement).toContain(
        "foreach (Transaction entry in account.History)",
      );
      expect(statement).toContain("private string Totals()");
      expect(statement).toContain("decimal deposits = ");
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "ignores another build's PDB beside the debug-symbols Fixture with a warning, laying it out by namespace, and still passes the Round-trip",
    async () => {
      const workDirectory = await scratch();
      const { assemblyPath: arithmetic } = await buildFixture("arithmetic");
      let copied = "";
      // The Fixture's build, with the arithmetic Fixture's PDB in place of its own.
      const withOtherPdb: Reconstruct = async (assemblyPath, output) => {
        copied = await withoutPdb(assemblyPath);
        await copyFile(
          join(dirname(arithmetic), "Arithmetic.pdb"),
          join(dirname(copied), "DebugSymbols.pdb"),
        );
        await xray(copied, output);
      };

      const result = await roundTrip("debug-symbols", withOtherPdb, {
        workDirectory,
      });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      const report = (await reportIn(
        join(workDirectory, "recovered"),
      )) as XrayReport;
      const pdbPath = join(dirname(copied), "DebugSymbols.pdb");
      const reason =
        "DebugSymbols.pdb, a portable PDB, is not DebugSymbols.dll's own: its ID is not the one DebugSymbols.dll records, so it is another build's.";
      expect(report).toMatchObject({
        outcome: "full",
        inspect: {
          pdb: {
            status: "mismatched",
            path: pdbPath,
            format: "portable",
            reason,
          },
        },
        warnings: [
          {
            kind: "pdb-ignored",
            assemblyPath: copied,
            pdbPath,
            message: `Ignored the PDB beside DebugSymbols.dll, ${pdbPath}. ${reason} So DebugSymbols's local variables are named, and its source files laid out, as without a PDB.`,
          },
        ],
      });
      // By namespace, below the root namespace, Ledger: a file per type,
      // but for Formatter, named after the file of the file-scoped type it
      // uses, as that type's name records.
      expect(report.solution.files).toEqual(
        expect.arrayContaining([
          "DebugSymbols/Banking/Account.cs",
          "DebugSymbols/Banking/Transaction.cs",
          "DebugSymbols/Banking/TransactionKind.cs",
          "DebugSymbols/Banking/IAccountSource.cs",
          "DebugSymbols/Reports/Formatting.cs",
          "DebugSymbols/Reports/Columns/Column.cs",
        ]),
      );
      expect(report.solution).toMatchObject({
        typeCount: 11,
        sourceFileCount: 10,
      });
      const account = await readFile(
        join(
          workDirectory,
          "recovered",
          "DebugSymbols",
          "Banking",
          "Account.cs",
        ),
        "utf8",
      );
      expect(account).not.toContain("missing");
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "makes a Full Reconstruction of the multi-assembly Fixture, each Sibling Assembly a project of its own, which passes the Round-trip",
    async () => {
      const workDirectory = await scratch();

      const result = await roundTrip("multi-assembly", xray, { workDirectory });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
      const recovered = join(workDirectory, "recovered");
      const report = (await reportIn(recovered)) as XrayReport;
      const { assemblyPath } = await buildFixture("multi-assembly");
      const beside = (file: string) => join(dirname(assemblyPath), file);
      expect(report).toMatchObject({
        outcome: "full",
        inputs: { options: { siblings: true } },
        siblingProblems: [],
        solution: {
          solutionPath: "MultiAssembly.sln",
          projects: [
            {
              assemblyPath,
              assemblyName: "MultiAssembly",
              projectPath: "MultiAssembly/MultiAssembly.csproj",
              outputType: "Exe",
              projectReferences: [
                "Inventory/Inventory.csproj",
                "Pricing/Pricing.csproj",
              ],
            },
            {
              assemblyPath: beside("Inventory.dll"),
              assemblyName: "Inventory",
              projectPath: "Inventory/Inventory.csproj",
              targetFramework: "net8.0",
              outputType: "Library",
              projectReferences: [],
              // Each Sibling Assembly is decompiled with its own PDB.
              pdb: { status: "matching", path: beside("Inventory.pdb") },
            },
            {
              assemblyPath: beside("Pricing.dll"),
              assemblyName: "Pricing",
              projectPath: "Pricing/Pricing.csproj",
              targetFramework: "net8.0",
              outputType: "Library",
              projectReferences: ["Inventory/Inventory.csproj"],
              pdb: { status: "matching", path: beside("Pricing.pdb") },
            },
          ],
        },
        warnings: [],
      });
      expect(report.solution.projects).toHaveLength(3);
      // Pricing keeps its own root namespace and version, and Inventory still
      // lets Pricing see its internals.
      expect(
        await readFile(join(recovered, "Pricing", "Pricing.csproj"), "utf8"),
      ).toContain("<RootNamespace>Shop.Pricing</RootNamespace>");
      const inventory = await readFile(
        join(recovered, "Inventory", "Properties", "AssemblyInfo.cs"),
        "utf8",
      );
      expect(inventory).toContain('[assembly: InternalsVisibleTo("Pricing")]');
      expect(inventory).toContain('[assembly: AssemblyVersion("1.4.0.0")]');
      expect(
        await readFile(join(recovered, "MultiAssembly.sln"), "utf8"),
      ).toMatch(
        /"MultiAssembly\\MultiAssembly\.csproj"[\s\S]*"Inventory\\Inventory\.csproj"[\s\S]*"Pricing\\Pricing\.csproj"/,
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "copies the multi-assembly Fixture's libraries into Dependencies with siblings off (--no-siblings), referenced with a HintPath, which passes the Round-trip",
    async () => {
      const workDirectory = await scratch();

      const result = await roundTrip(
        "multi-assembly",
        async (assemblyPath, outputDirectory) => {
          const reconstruction = await reconstruct(
            assemblyPath,
            outputDirectory,
            { siblings: false },
          );
          if (!reconstruction.accepted || reconstruction.outcome !== "full") {
            throw new Error("Not a Full Reconstruction.");
          }
        },
        { workDirectory },
      );

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      const recovered = join(workDirectory, "recovered");
      const { assemblyPath } = await buildFixture("multi-assembly");
      const beside = (file: string) => join(dirname(assemblyPath), file);
      expect((await readdir(recovered)).sort()).toEqual([
        "Dependencies",
        "MultiAssembly",
        "MultiAssembly.sln",
        "xray-report.json",
      ]);
      expect(await readdir(join(recovered, "Dependencies"))).toEqual(
        expect.arrayContaining(["Inventory.dll", "Pricing.dll"]) as unknown,
      );
      // Copied byte for byte.
      expect(
        await readFile(join(recovered, "Dependencies", "Pricing.dll")),
      ).toEqual(await readFile(beside("Pricing.dll")));
      expect(await reportIn(recovered)).toMatchObject({
        outcome: "full",
        inputs: { options: { siblings: false } },
        solution: {
          projects: [
            {
              projectPath: "MultiAssembly/MultiAssembly.csproj",
              projectReferences: [],
              binaryReferences: [
                "Dependencies/Inventory.dll",
                "Dependencies/Pricing.dll",
              ],
            },
          ],
        },
        dependencies: expect.arrayContaining([
          expect.objectContaining({
            reference: expect.objectContaining({
              name: "Pricing",
            }) as unknown,
            resolution: "copied-binary",
            copiedTo: "Dependencies/Pricing.dll",
            path: beside("Pricing.dll"),
          }),
        ]) as unknown,
        // Still run, to look its references up as NuGet packages.
        timings: { resolveDependencies: expect.any(Number) as unknown },
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "makes a Full Reconstruction of the copied-binary Fixture, copying the third party's library into Dependencies rather than reconstructing it, which passes the Round-trip",
    async () => {
      const workDirectory = await scratch();

      const result = await roundTrip("copied-binary", xray, { workDirectory });

      expect(result.passed, formatRoundTrip(result)).toBe(true);
      expect(result.runs.length).toBeGreaterThan(0);
      const recovered = join(workDirectory, "recovered");
      const { assemblyPath } = await buildFixture("copied-binary");
      const vendor = join(dirname(assemblyPath), "Kestrelwood.Checksums.dll");
      const report = (await reportIn(recovered)) as XrayReport;
      expect(report).toMatchObject({
        outcome: "full",
        reasons: [],
        solution: {
          projects: [
            {
              assemblyName: "CopiedBinary",
              projectReferences: [],
              packageReferences: [],
              binaryReferences: ["Dependencies/Kestrelwood.Checksums.dll"],
            },
          ],
          files: expect.arrayContaining([
            "Dependencies/Kestrelwood.Checksums.dll",
          ]) as unknown,
        },
      });
      // Only the program is reconstructed.
      expect(report.solution.projects).toHaveLength(1);
      expect(report.dependencies).toEqual([
        {
          reference: {
            name: "Kestrelwood.Checksums",
            version: "2.3.1.0",
            culture: null,
            publicKeyToken: "51ca75d1f3633191",
          },
          referencedBy: ["CopiedBinary"],
          resolution: "copied-binary",
          package: null,
          projectPath: null,
          copiedTo: "Dependencies/Kestrelwood.Checksums.dll",
          path: vendor,
          reason: `No NuGet package was found to hold it. ${vendor}, beside the input, is strong-named with a key (public key token 51ca75d1f3633191), so it is a third party's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath.`,
        },
        expect.objectContaining({
          reference: expect.objectContaining({
            name: "System.Console",
          }) as unknown,
          resolution: "framework",
        }),
        expect.objectContaining({
          reference: expect.objectContaining({
            name: "System.Runtime",
          }) as unknown,
          resolution: "framework",
        }),
      ]);
      // Looked up as a package first; no package holds it.
      expect(report.packages).toMatchObject([
        { reference: { name: "Kestrelwood.Checksums" }, package: null },
      ]);
      expect(
        await readFile(
          join(recovered, "Dependencies", "Kestrelwood.Checksums.dll"),
        ),
      ).toEqual(await readFile(vendor));
      expect(
        await readFile(
          join(recovered, "CopiedBinary", "CopiedBinary.csproj"),
          "utf8",
        ),
      ).toContain(
        [
          '    <Reference Include="Kestrelwood.Checksums">',
          "      <HintPath>..\\Dependencies\\Kestrelwood.Checksums.dll</HintPath>",
          "    </Reference>",
        ].join("\n"),
      );
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "reports the cyclic-reference Fixture's cycle rather than crashing on it, leaving out the reference that closes it, a Partial Reconstruction",
    async () => {
      const { assemblyPath } = await buildFixture("cyclic-reference");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      const message =
        "CyclicReference references Plugin references CyclicReference, a cycle projects cannot have. The reference from Plugin to CyclicReference is left out, so Plugin does not build.";
      expect(reconstruction).toMatchObject({
        accepted: true,
        outcome: "partial",
        siblingProblems: [
          {
            kind: "cyclic-reference",
            cycle: ["CyclicReference", "Plugin", "CyclicReference"],
            omitted: { from: "Plugin", to: "CyclicReference" },
            message,
          },
        ],
        solution: {
          projects: [
            {
              projectPath: "CyclicReference/CyclicReference.csproj",
              projectReferences: ["Plugin/Plugin.csproj"],
            },
            { projectPath: "Plugin/Plugin.csproj", projectReferences: [] },
          ],
        },
      });
      // Only the project that lost its reference fails to build.
      const errors =
        reconstruction.accepted &&
        reconstruction.reasons[0]?.kind === "build-failed"
          ? reconstruction.reasons[0].errors
          : [];
      expect(errors.length).toBeGreaterThan(0);
      expect(new Set(errors.map(({ project }) => project))).toEqual(
        new Set(["Plugin/Plugin.csproj"]),
      );
      expect(await reportIn(output)).toMatchObject({
        outcome: "partial",
        siblingProblems: [{ kind: "cyclic-reference", message }],
      });
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "reconstructs the multi-assembly Fixture from its folder, reporting a library there twice, as a .dll and an .exe, and reconstructing the .dll",
    async () => {
      const { outputDirectory } = await buildFixture("multi-assembly");
      const input = join(await scratch(), "app");
      await cp(outputDirectory, input, { recursive: true });
      await copyFile(
        join(input, "Inventory.dll"),
        join(input, "Inventory.exe"),
      );
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(input, output);

      expect(reconstruction).toMatchObject({
        accepted: true,
        summary: { path: join(input, "MultiAssembly.dll") },
        outcome: "full",
        siblingProblems: [
          {
            kind: "duplicate-assembly-name",
            name: "Inventory",
            paths: [join(input, "Inventory.dll"), join(input, "Inventory.exe")],
            chosen: join(input, "Inventory.dll"),
          },
        ],
      });
      expect(
        reconstruction.accepted &&
          reconstruction.solution.projects.map(
            ({ assemblyPath }) => assemblyPath,
          ),
      ).toEqual([
        join(input, "MultiAssembly.dll"),
        join(input, "Inventory.dll"),
        join(input, "Pricing.dll"),
      ]);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  describe("the nuget-dependencies Fixture", () => {
    const newtonsoft = {
      name: "Newtonsoft.Json",
      version: "13.0.0.0",
      culture: null,
      publicKeyToken: "30ad4fe6b2a6aeed",
    };
    const serilog = {
      name: "Serilog",
      version: "2.0.0.0",
      culture: null,
      publicKeyToken: "24c2f752a8e58a10",
    };
    /** A `fetch` that must not be called, recording each time it is. */
    const forbiddenFetch = () => {
      const calls: string[] = [];
      const fetch: typeof globalThis.fetch = (input) => {
        calls.push(String(input));
        return Promise.reject(new Error("No network calls are allowed."));
      };
      return { calls, fetch };
    };

    it(
      "makes a Full Reconstruction, referencing Newtonsoft.Json and Serilog as packages from the global-packages cache, not as Sibling Assemblies, which passes the Round-trip",
      async () => {
        await restoreFixture("nuget-dependencies");
        const workDirectory = await scratch();

        const result = await roundTrip("nuget-dependencies", xray, {
          workDirectory,
        });

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.runs.length).toBeGreaterThan(0);
        const recovered = join(workDirectory, "recovered");
        const { assemblyPath } = await buildFixture("nuget-dependencies");
        const report = (await reportIn(recovered)) as XrayReport;
        const chosen = (id: string, version: string, file: string) => ({
          id,
          version,
          source: "global-packages",
          file,
          matchesCopyBeside: true,
        });
        expect(report).toMatchObject({
          outcome: "full",
          inputs: { options: { offline: false } },
          packages: [
            {
              reference: newtonsoft,
              referencedBy: ["NuGetDependencies"],
              package: chosen(
                "Newtonsoft.Json",
                "13.0.3",
                "lib/net6.0/Newtonsoft.Json.dll",
              ),
              searched: ["global-packages"],
              reason: `Newtonsoft.Json 13.0.3, in the global-packages cache, holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed as lib/net6.0/Newtonsoft.Json.dll, the very file beside the input (${join(dirname(assemblyPath), "Newtonsoft.Json.dll")}). ${join(dirname(assemblyPath), "NuGetDependencies.deps.json")} says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3.`,
            },
            {
              reference: serilog,
              referencedBy: ["NuGetDependencies"],
              package: chosen("Serilog", "3.1.1", "lib/net7.0/Serilog.dll"),
              searched: ["global-packages"],
            },
          ],
          solution: {
            projects: [
              {
                projectPath: "NuGetDependencies/NuGetDependencies.csproj",
                projectReferences: [],
                packageReferences: [
                  { id: "Newtonsoft.Json", version: "13.0.3" },
                  { id: "Serilog", version: "3.1.1" },
                ],
              },
            ],
          },
        });
        // Neither package is a Sibling Assembly, though both are beside it.
        expect(report.solution.projects).toHaveLength(1);
        expect(
          await readFile(
            join(recovered, "NuGetDependencies", "NuGetDependencies.csproj"),
            "utf8",
          ),
        ).toContain(
          [
            "  <ItemGroup>",
            "    <!-- NuGet packages, each holding an assembly the original references. -->",
            '    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
            '    <PackageReference Include="Serilog" Version="3.1.1" />',
            "  </ItemGroup>",
          ].join("\n"),
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "with offline, asks nuget.org nothing, finding the packages in the global-packages cache and building from it alone, a Full Reconstruction",
      async () => {
        await restoreFixture("nuget-dependencies");
        const { assemblyPath } = await buildFixture("nuget-dependencies");
        const output = join(await scratch(), "out");
        const { calls, fetch } = forbiddenFetch();

        const reconstruction = await reconstruct(assemblyPath, output, {
          offline: true,
          nugetOrg: { fetch },
        });

        expect(calls).toEqual([]);
        expect(reconstruction).toMatchObject({
          accepted: true,
          outcome: "full",
          offline: true,
          packages: [
            {
              package: { id: "Newtonsoft.Json", source: "global-packages" },
              searched: ["global-packages"],
            },
            {
              package: { id: "Serilog", source: "global-packages" },
              searched: ["global-packages"],
            },
          ],
        });
        const build = reconstruction.accepted ? reconstruction.build : null;
        // Restored from the cache alone, with no audit asking the feed.
        expect(build?.output).not.toMatch(/NU1900|api\.nuget\.org/);
        expect(await reportIn(output)).toMatchObject({
          inputs: { options: { offline: true } },
        });
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "with offline and an empty global-packages cache, asks nuget.org nothing, finds no package, and says nuget.org was not asked",
      async () => {
        const { assemblyPath } = await buildFixture("nuget-dependencies");
        const globalPackagesFolder = await scratch();
        const output = join(await scratch(), "out");
        const { calls, fetch } = forbiddenFetch();

        const reconstruction = await reconstruct(assemblyPath, output, {
          offline: true,
          globalPackagesFolder,
          nugetOrg: { fetch },
          siblings: false,
          build: false,
        });

        expect(calls).toEqual([]);
        expect(reconstruction).toMatchObject({
          accepted: true,
          packages: [
            {
              reference: newtonsoft,
              package: null,
              searched: ["global-packages"],
              reason: `No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. ${join(dirname(assemblyPath), "NuGetDependencies.deps.json")} says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3. There is no package named Newtonsoft.Json in the global-packages cache. nuget.org was not asked (--offline).`,
            },
            {
              reference: serilog,
              package: null,
              searched: ["global-packages"],
            },
          ],
          solution: { projects: [{ packageReferences: [] }] },
        });
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "finds the packages on nuget.org when the global-packages cache has none, downloading only the version each copy beside it names, and sending only package ids and versions",
      async () => {
        await restoreFixture("nuget-dependencies");
        const { assemblyPath } = await buildFixture("nuget-dependencies");
        const cache = defaultGlobalPackagesFolder();
        const output = join(await scratch(), "out");
        const sent: { url: string; method: string; body: unknown }[] = [];
        // nuget.org's V3 API, serving the .nupkgs the real cache holds.
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const url = String(input);
          sent.push({
            url,
            method: init?.method ?? "GET",
            body: init?.body ?? null,
          });
          if (url === "https://api.nuget.test/v3/index.json") {
            return Response.json({
              resources: [
                {
                  "@id": "https://api.nuget.test/flat/",
                  "@type": "PackageBaseAddress/3.0.0",
                },
              ],
            });
          }
          const versions =
            /^https:\/\/api\.nuget\.test\/flat\/([^/]+)\/index\.json$/.exec(
              url,
            );
          if (versions !== null) {
            return Response.json({
              versions: (
                await readdir(join(cache, versions[1] as string))
              ).sort(),
            });
          }
          const nupkg =
            /^https:\/\/api\.nuget\.test\/flat\/([^/]+)\/([^/]+)\/[^/]+\.nupkg$/.exec(
              url,
            );
          if (nupkg !== null) {
            const [, id, version] = nupkg as unknown as [
              string,
              string,
              string,
            ];
            return new Response(
              await readFile(
                join(cache, id, version, `${id}.${version}.nupkg`),
              ),
            );
          }
          return new Response(null, { status: 404 });
        };

        const reconstruction = await reconstruct(assemblyPath, output, {
          globalPackagesFolder: await scratch(),
          nugetOrg: {
            serviceIndex: "https://api.nuget.test/v3/index.json",
            fetch,
          },
          build: false,
        });

        expect(sent).toEqual(
          [
            "https://api.nuget.test/v3/index.json",
            "https://api.nuget.test/flat/newtonsoft.json/index.json",
            "https://api.nuget.test/flat/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg",
            "https://api.nuget.test/flat/serilog/index.json",
            "https://api.nuget.test/flat/serilog/3.1.1/serilog.3.1.1.nupkg",
          ].map((url) => ({ url, method: "GET", body: null })),
        );
        expect(reconstruction).toMatchObject({
          accepted: true,
          offline: false,
          packages: [
            {
              package: {
                id: "Newtonsoft.Json",
                version: "13.0.3",
                source: "nuget.org",
                matchesCopyBeside: true,
              },
              searched: ["global-packages", "nuget.org"],
            },
            {
              package: {
                id: "Serilog",
                version: "3.1.1",
                source: "nuget.org",
                matchesCopyBeside: true,
              },
              searched: ["global-packages", "nuget.org"],
            },
          ],
          solution: {
            projects: [
              {
                packageReferences: [
                  { id: "Newtonsoft.Json", version: "13.0.3" },
                  { id: "Serilog", version: "3.1.1" },
                ],
              },
            ],
          },
        });
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "chooses deterministically of several versions holding the same assembly, the one holding the very file beside the input, else the highest, and explains it in the report",
      async () => {
        await restoreFixture("nuget-dependencies");
        const { assemblyPath, outputDirectory } =
          await buildFixture("nuget-dependencies");
        const real = defaultGlobalPackagesFolder();
        // A cache holding the real 13.0.3, and a higher 13.0.9 whose
        // lib/net6.0 is another build of the same assembly, 13.0.0.0.
        const cache = await scratch();
        for (const [id, version] of [
          ["newtonsoft.json", "13.0.3"],
          ["serilog", "3.1.1"],
        ] as const) {
          await cp(join(real, id, version), join(cache, id, version), {
            recursive: true,
          });
        }
        const higher = join(cache, "newtonsoft.json", "13.0.9");
        await cp(join(real, "newtonsoft.json", "13.0.3"), higher, {
          recursive: true,
        });
        await copyFile(
          join(higher, "lib", "netstandard2.0", "Newtonsoft.Json.dll"),
          join(higher, "lib", "net6.0", "Newtonsoft.Json.dll"),
        );
        const { fetch } = forbiddenFetch();
        const options = {
          globalPackagesFolder: cache,
          nugetOrg: { fetch },
          build: false,
        } as const;

        // Beside its packages' assemblies, as built.
        const beside = await reconstruct(
          assemblyPath,
          join(await scratch(), "out"),
          options,
        );
        // Alone in a folder, with no copy beside it to compare with.
        const alone = join(await scratch(), "NuGetDependencies.dll");
        await copyFile(assemblyPath, alone);
        const without = await reconstruct(
          alone,
          join(await scratch(), "out"),
          options,
        );

        const lookups = (reconstruction: typeof beside) =>
          reconstruction.accepted ? reconstruction.packages : [];
        const [withCopy] = lookups(beside);
        const [withoutCopy] = lookups(without);
        expect(withCopy?.package?.version).toBe("13.0.3");
        expect(withCopy?.candidates.map(({ version }) => version)).toEqual([
          "13.0.3",
          "13.0.9",
        ]);
        expect(withCopy?.reason).toBe(
          `2 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.3, 13.0.9. 13.0.3 is chosen, as its lib/net6.0/Newtonsoft.Json.dll is the very file beside the input (${join(outputDirectory, "Newtonsoft.Json.dll")}). ${join(outputDirectory, "NuGetDependencies.deps.json")} says the application's Newtonsoft.Json is from Newtonsoft.Json 13.0.3.`,
        );
        expect(withoutCopy?.package?.version).toBe("13.0.9");
        expect(withoutCopy?.reason).toBe(
          "2 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.9, 13.0.3. 13.0.9 is chosen, as it is the highest: the likeliest to be what the application was built with, and the least likely to be older than another package needs.",
        );
        // The report explains the choice as the Reconstruction made it.
        const report = (await reportIn(
          beside.accepted ? beside.solution.directory : "",
        )) as XrayReport;
        expect(report.packages[0]?.reason).toBe(withCopy?.reason);
        expect(report.packages[0]?.candidates).toEqual(withCopy?.candidates);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "finds an assembly in the package its .deps.json names, though the package is named otherwise than the assembly",
      async () => {
        await restoreFixture("nuget-dependencies");
        const { outputDirectory } = await buildFixture("nuget-dependencies");
        const real = defaultGlobalPackagesFolder();
        // The app as built, but its .deps.json saying Serilog.dll came from
        // a package named Acme.Logging, which the cache holds, and holds
        // under no other name: Serilog 3.1.1's, as it is.
        const input = await scratch();
        for (const file of [
          "NuGetDependencies.dll",
          "Newtonsoft.Json.dll",
          "Serilog.dll",
        ]) {
          await copyFile(join(outputDirectory, file), join(input, file));
        }
        const deps = await readFile(
          join(outputDirectory, "NuGetDependencies.deps.json"),
          "utf8",
        );
        expect(deps).toContain('"Serilog/3.1.1"');
        await writeFile(
          join(input, "NuGetDependencies.deps.json"),
          deps.replaceAll('"Serilog/3.1.1"', '"Acme.Logging/3.1.1"'),
        );
        const cache = await scratch();
        await cp(
          join(real, "newtonsoft.json", "13.0.3"),
          join(cache, "newtonsoft.json", "13.0.3"),
          { recursive: true },
        );
        const renamed = join(cache, "acme.logging", "3.1.1");
        await cp(join(real, "serilog", "3.1.1", "lib"), join(renamed, "lib"), {
          recursive: true,
        });
        await writeFile(join(renamed, "acme.logging.3.1.1.nupkg.sha512"), "");
        const { calls, fetch } = forbiddenFetch();

        const reconstruction = await reconstruct(
          join(input, "NuGetDependencies.dll"),
          join(await scratch(), "out"),
          { globalPackagesFolder: cache, nugetOrg: { fetch }, build: false },
        );

        expect(calls).toEqual([]);
        expect(reconstruction).toMatchObject({
          accepted: true,
          packages: [
            { reference: newtonsoft, package: { id: "Newtonsoft.Json" } },
            {
              reference: serilog,
              package: {
                id: "Acme.Logging",
                version: "3.1.1",
                source: "global-packages",
                file: "lib/net7.0/Serilog.dll",
                matchesCopyBeside: true,
              },
              searched: ["global-packages"],
              reason: `Acme.Logging 3.1.1, in the global-packages cache, holds Serilog 2.0.0.0, public key token 24c2f752a8e58a10 as lib/net7.0/Serilog.dll, the very file beside the input (${join(input, "Serilog.dll")}). ${join(input, "NuGetDependencies.deps.json")} says the application's Serilog is from Acme.Logging 3.1.1.`,
            },
          ],
          dependencies: expect.arrayContaining([
            expect.objectContaining({
              reference: serilog,
              resolution: "nuget-package",
              package: { id: "Acme.Logging", version: "3.1.1" },
            }),
          ]),
          solution: {
            projects: [
              {
                packageReferences: [
                  { id: "Newtonsoft.Json", version: "13.0.3" },
                  { id: "Acme.Logging", version: "3.1.1" },
                ],
              },
            ],
          },
        });
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  it(
    "writes the arithmetic Fixture's Recovered Solution without building it when building is skipped",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output, {
        build: false,
      });

      expect(reconstruction).toMatchObject({
        accepted: true,
        build: null,
        outcome: "unverified",
        reasons: [],
      });
      expect(await reportIn(output)).toMatchObject({
        outcome: "unverified",
        inputs: { options: { build: false, run: false } },
        build: null,
        timings: { build: null },
      });
      expect((await readdir(join(output, "Arithmetic"))).sort()).toEqual([
        "Arithmetic.csproj",
        "Program.cs",
        "Properties",
      ]);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "reconstructs the obfuscated Fixture as it is, flagged as obfuscated in the report and warned of, without renaming anything back or decoding any string",
    async () => {
      const { assemblyPath } = await buildFixture("obfuscated");
      const output = join(await scratch(), "out");

      const reconstruction = await reconstruct(assemblyPath, output);

      // Every stage ran, as for any Assembly.
      expect(reconstruction).toMatchObject({
        accepted: true,
        summary: { obfuscation: { status: "obfuscated" } },
        solution: {
          solutionPath: "Obfuscated.sln",
          projectPath: "Obfuscated/Obfuscated.csproj",
        },
        build: { succeeded: false },
      });
      if (!reconstruction.accepted) {
        expect.unreachable();
      }
      const indicators = reconstruction.summary.obfuscation.indicators;
      const report = (await reportIn(output)) as XrayReport;
      expect(report.obfuscated).toBe(true);
      expect(report.inspect.obfuscation).toEqual({
        status: "obfuscated",
        indicators,
      });
      expect(report.solution.projects).toMatchObject([
        { obfuscation: { status: "obfuscated", indicators } },
      ]);
      expect(report.warnings).toEqual([
        {
          kind: "obfuscated",
          assemblyPath,
          message: `Obfuscated.dll is likely obfuscated. ${indicators.map(({ message }) => message).join(" ")} It was reconstructed as it is, not deobfuscated: Obfuscated's names and strings are the obfuscator's.`,
        },
      ]);

      // The C# has the names Obfuscar gave: no type, file or member is
      // named as its source named them, and no string is decoded.
      const sources = reconstruction.solution.files.filter((file) =>
        file.endsWith(".cs"),
      );
      const code = (
        await Promise.all(
          sources.map((file) => readFile(join(output, file), "utf8")),
        )
      ).join("\n");
      for (const name of [
        "Recipes",
        "Kitchen",
        "Cookbook",
        "ICookbook",
        "Recipe",
        "RecipeNotFoundException",
        "Ingredient",
        "Unit",
        "Grams",
        "PerServing",
        "MostServings",
        "Title",
      ]) {
        expect(code).not.toMatch(new RegExp(`\\b${name}\\b`));
        expect(sources.join("\n")).not.toContain(name);
      }
      for (const text of [
        "Usage: Obfuscated",
        "There is no recipe for",
        "Servings must be",
        "pancakes",
        "flour",
      ]) {
        expect(code).not.toContain(text);
      }
      // Its strings are fetched as Obfuscar left them: from its decoder's type, decoding bytes.
      expect(code).toContain("Encoding.UTF8.GetString(");
      expect(sources).toContainEqual(
        expect.stringMatching(/^Obfuscated\/_PrivateImplementationDetails_\{/),
      );
      // So it is Partial: C# cannot declare what Obfuscar named alike, as
      // two fields of one type both A.
      expect(reconstruction.outcome).toBe("partial");
      expect(
        reconstruction.build?.diagnostics.filter(
          ({ severity }) => severity === "error",
        ),
      ).toContainEqual(expect.objectContaining({ code: "CS0102" }));
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  describe("the microsoft-packages Fixture", () => {
    const microsofts = (name: string, version: string, key: string) => ({
      name,
      version,
      culture: null,
      publicKeyToken: key,
    });
    const versioning = microsofts(
      "NuGet.Versioning",
      "7.3.0.0",
      "31bf3856ad364e35",
    );
    const immutable = microsofts(
      "System.Collections.Immutable",
      "9.0.0.0",
      "b03f5f7f11d50a3a",
    );
    const commandLine = microsofts(
      "System.CommandLine",
      "2.0.5.0",
      "31bf3856ad364e35",
    );
    const packaged = [versioning.name, immutable.name, commandLine.name];
    /** The .NET 8 reference assemblies, wherever this machine has them. */
    const net8 = String.raw`Microsoft\.NETCore\.App\.Ref 8\.0\.\d+, the reference assemblies of \.NET 8\.0,`;

    it(
      "makes a Full Reconstruction, referencing Microsoft's packages .NET 8 does not provide as packages, and leaving what it provides to it, unlooked-up, which passes the Round-trip",
      async () => {
        await restoreFixture("microsoft-packages");
        const workDirectory = await scratch();

        const result = await roundTrip("microsoft-packages", xray, {
          workDirectory,
        });

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.runs.length).toBeGreaterThan(0);
        const recovered = join(workDirectory, "recovered");
        const report = (await reportIn(recovered)) as XrayReport;
        const fromCache = (id: string, version: string) => ({
          id,
          version,
          source: "global-packages",
          file: `lib/net8.0/${id}.dll`,
          matchesCopyBeside: true,
        });
        expect(report).toMatchObject({
          outcome: "full",
          // Only the three are looked up as packages: nothing .NET 8 provides.
          packages: [
            {
              reference: versioning,
              package: fromCache("NuGet.Versioning", "7.3.0"),
            },
            {
              reference: immutable,
              package: fromCache("System.Collections.Immutable", "9.0.0"),
            },
            {
              reference: commandLine,
              package: fromCache("System.CommandLine", "2.0.5"),
            },
          ],
          solution: {
            projects: [
              {
                projectPath: "MicrosoftPackages/MicrosoftPackages.csproj",
                projectReferences: [],
                packageReferences: [
                  { id: "NuGet.Versioning", version: "7.3.0" },
                  { id: "System.Collections.Immutable", version: "9.0.0" },
                  { id: "System.CommandLine", version: "2.0.5" },
                ],
              },
            ],
          },
        });
        expect(report.packages).toHaveLength(3);
        expect(report.solution.projects).toHaveLength(1);
        const dependencies = report.dependencies;
        expect(
          dependencies.map(({ reference, resolution }) =>
            packaged.includes(reference.name)
              ? `${reference.name}: ${resolution}`
              : resolution,
          ),
        ).toEqual(
          dependencies.map(({ reference }) =>
            packaged.includes(reference.name)
              ? `${reference.name}: nuget-package`
              : "framework",
          ),
        );
        expect(
          dependencies.find(
            ({ reference }) => reference.name === "System.Runtime",
          ),
        ).toMatchObject({
          resolution: "framework",
          reason: expect.stringMatching(
            new RegExp(
              String.raw`^System\.Runtime 8\.0\.0\.0 is signed with one of Microsoft's keys \(public key token b03f5f7f11d50a3a\), and net8\.0, the target framework of MicrosoftPackages, provides it: ${net8} holds System\.Runtime 8\.0\.0\.0\. It is left to the target framework\.$`,
            ),
          ) as unknown,
        });
        expect(
          dependencies.find(
            ({ reference }) => reference.name === immutable.name,
          )?.reason,
        ).toMatch(
          new RegExp(
            String.raw`^System\.Collections\.Immutable 9\.0\.0\.0 is signed with one of Microsoft's keys \(public key token b03f5f7f11d50a3a\), but net8\.0, the target framework of MicrosoftPackages, does not provide it: ${net8} holds System\.Collections\.Immutable only at 8\.0\.0\.0, older than 9\.0\.0\.0\. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly\. System\.Collections\.Immutable 9\.0\.0, in the global-packages cache, holds `,
          ),
        );
        expect(
          dependencies.find(
            ({ reference }) => reference.name === commandLine.name,
          )?.reason,
        ).toMatch(
          new RegExp(
            String.raw`does not provide it: ${net8} holds no assembly named System\.CommandLine\. `,
          ),
        );
        expect(
          await readFile(
            join(recovered, "MicrosoftPackages", "MicrosoftPackages.csproj"),
            "utf8",
          ),
        ).toContain(
          [
            "  <ItemGroup>",
            "    <!-- NuGet packages, each holding an assembly the original references. -->",
            '    <PackageReference Include="NuGet.Versioning" Version="7.3.0" />',
            '    <PackageReference Include="System.Collections.Immutable" Version="9.0.0" />',
            '    <PackageReference Include="System.CommandLine" Version="2.0.5" />',
            "  </ItemGroup>",
          ].join("\n"),
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "offline, with an empty global-packages cache, still tells .NET 8's own assemblies from the .NET SDK's packs, asking nuget.org nothing, and copies Microsoft's packages beside it rather than reconstruct them",
      async () => {
        const { assemblyPath, outputDirectory } =
          await buildFixture("microsoft-packages");
        const calls: string[] = [];
        const fetch: typeof globalThis.fetch = (input) => {
          calls.push(String(input));
          return Promise.reject(new Error("No network calls are allowed."));
        };

        const reconstruction = await reconstruct(
          assemblyPath,
          join(await scratch(), "out"),
          {
            offline: true,
            globalPackagesFolder: await scratch(),
            nugetOrg: { fetch },
            build: false,
          },
        );

        expect(calls).toEqual([]);
        if (!reconstruction.accepted) {
          throw new Error(reconstruction.classification.explanation);
        }
        expect(
          reconstruction.packages.map(({ reference, package: found }) => [
            reference.name,
            found,
          ]),
        ).toEqual(packaged.map((name) => [name, null]));
        expect(reconstruction.solution.projects).toHaveLength(1);
        expect(
          reconstruction.dependencies
            .filter(({ resolution }) => resolution !== "framework")
            .map(({ reference, resolution, copiedTo }) => [
              reference.name,
              resolution,
              copiedTo,
            ]),
        ).toEqual(
          packaged.map((name) => [
            name,
            "copied-binary",
            `Dependencies/${name}.dll`,
          ]),
        );
        expect(
          reconstruction.dependencies.find(
            ({ reference }) => reference.name === commandLine.name,
          )?.reason,
        ).toContain(
          `${join(outputDirectory, "System.CommandLine.dll")}, beside the input, is Microsoft's, not the application's own: it is copied, not reconstructed,`,
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  describe("the resources Fixture", () => {
    /** A copy of its build output, satellite assemblies and all, without its PDB. */
    async function resourcesWithoutPdb(assemblyPath: string): Promise<string> {
      const copy = join(await scratch(), "app");
      await cp(dirname(assemblyPath), copy, {
        recursive: true,
        filter: (source) => !/\.pdb$/i.test(source),
      });
      return join(copy, basename(assemblyPath));
    }

    /** Each resource of an Assembly's manifest, by name, and whether it is public, as the engine reads it. */
    async function manifestOf(
      path: string,
    ): Promise<{ name: string; culture: unknown; resources: string[] }> {
      const engine = await startEngine();
      try {
        const { assembly, resources } = (await engine.request("resources", {
          path,
        })) as {
          assembly: { name: string; culture: unknown };
          resources: { name: string; public: boolean }[];
        };
        return {
          name: assembly.name,
          culture: assembly.culture,
          resources: resources
            .map(
              (resource) =>
                `${resource.name} (${resource.public ? "public" : "private"})`,
            )
            .sort(),
        };
      } finally {
        await engine.stop();
      }
    }

    it.each([
      ["with its PDB", xray],
      [
        "without its PDB",
        (async (assemblyPath, outputDirectory) =>
          xray(
            await resourcesWithoutPdb(assemblyPath),
            outputDirectory,
          )) satisfies Reconstruct,
      ],
    ])(
      "makes a Full Reconstruction of it %s, which passes the Round-trip: every resource reads back the same at runtime, the satellite assemblies' too",
      async (_, reconstruction) => {
        const result = await roundTrip("resources", reconstruction);

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.runs.length).toBeGreaterThan(0);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "rebuilds an Assembly, and French and German satellite assemblies, whose manifests name every resource as the original's do, each as public or private as it was",
      async () => {
        const original = await buildFixture("resources");
        const work = await scratch();
        const result = await roundTrip("resources", xray, {
          workDirectory: work,
        });
        expect(result.passed, formatRoundTrip(result)).toBe(true);
        const [rebuilt] = (
          await readdir(join(work, "rebuilt", "bin"), {
            withFileTypes: true,
            recursive: true,
          })
        )
          .filter((entry) => entry.isFile() && entry.name === "Phrasebook.dll")
          .map((entry) => entry.parentPath);

        for (const relative of [
          "Phrasebook.dll",
          join("de", "Phrasebook.resources.dll"),
          join("fr", "Phrasebook.resources.dll"),
        ]) {
          expect(
            await manifestOf(join(rebuilt as string, relative)),
            relative,
          ).toEqual(await manifestOf(join(original.outputDirectory, relative)));
        }
        expect((await manifestOf(original.assemblyPath)).resources).toContain(
          "Phrasebook.Secret (private)",
        );
        expect(existsSync(join(rebuilt as string, "es"))).toBe(false);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "writes each .resources file of strings, byte[]s and streams as a .resx, beside its type's file where one is named after it, each satellite assembly's beside it, and embeds the rest as they are, warning of the .resources file it keeps",
      async () => {
        const { assemblyPath } = await buildFixture("resources");
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(assemblyPath, output, {
          build: false,
        });

        expect(reconstruction.accepted).toBe(true);
        if (!reconstruction.accepted) {
          return;
        }
        const [project] = reconstruction.solution.projects;
        expect(
          project?.resources.map(({ name, culture, recoveredAs, path }) => [
            name,
            culture,
            recoveredAs,
            path,
          ]),
        ).toEqual([
          [
            "Phrasebook.Images.resources",
            null,
            "resx",
            "Phrasebook/Images.resx",
          ],
          [
            "Phrasebook.Phrases.Menu.resources",
            null,
            "resx",
            "Phrasebook/Phrases/Menu.resx",
          ],
          [
            "Phrasebook.Strings.resources",
            null,
            "resx",
            "Phrasebook/Strings.resx",
          ],
          [
            "Phrasebook.Assets.flag.png",
            null,
            "file",
            "Phrasebook/Assets.flag.png",
          ],
          ["motd", null, "file", "Phrasebook/motd"],
          ["Phrasebook.Secret", null, "file", "Phrasebook/Phrasebook.Secret"],
          [
            "Phrasebook.Limits.resources",
            null,
            "file",
            "Phrasebook/Limits.resources",
          ],
          [
            "Phrasebook.Strings.de.resources",
            "de",
            "resx",
            "Phrasebook/Strings.de.resx",
          ],
          [
            "Phrasebook.Phrases.Menu.fr.resources",
            "fr",
            "resx",
            "Phrasebook/Phrases/Menu.fr.resx",
          ],
          [
            "Phrasebook.Strings.fr.resources",
            "fr",
            "resx",
            "Phrasebook/Strings.fr.resx",
          ],
          [
            "Phrasebook.Assets.notes.txt",
            "fr",
            "file",
            "Phrasebook/Assets.notes.fr.txt",
          ],
        ]);
        // Images.resx refers to the files of its byte[] and its stream.
        expect(
          await readFile(join(output, "Phrasebook", "Images", "Flag.png")),
        ).toEqual(
          await readFile(
            join(FIXTURES_DIRECTORY, "resources", "Assets", "flag.png"),
          ),
        );
        expect(
          await readFile(
            join(output, "Phrasebook", "Images", "Anthem.txt"),
            "utf8",
          ),
        ).toBe(
          await readFile(
            join(FIXTURES_DIRECTORY, "resources", "Assets", "anthem.txt"),
            "utf8",
          ),
        );
        expect(
          reconstruction.warnings.map(({ kind, message }) => [kind, message]),
        ).toEqual([
          [
            "resource-kept-as-is",
            'Phrasebook.Limits.resources, a resource of Phrasebook.dll, is embedded as it is, as Phrasebook/Limits.resources, rather than written as a .resx. Its entry "MaxPhrases" is a System.Int32, not a string, a byte[] or a stream. A .resx the .NET SDK builds holds only strings, and byte[]s and streams in files it refers to, without System.Resources.Extensions; the rebuilt Assembly holds this resource byte for byte all the same.',
          ],
        ]);
        expect(await reportIn(output)).toMatchObject({
          solution: { projects: [{ resources: project?.resources }] },
        });
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  describe("the Windows Forms Fixtures", () => {
    const fixtures = [
      ["winforms", "Greeter", "Greeter.dll", "MainForm"],
      ["net48-winforms", "Stopwatch", "Stopwatch.exe", "LapForm"],
    ] as const;

    /** Every resource of an Assembly's manifest, as the engine reads it: its name, whether it is public, and its bytes. */
    async function resourcesOf(path: string): Promise<unknown> {
      const engine = await startEngine();
      try {
        return (await engine.request("resources", { path }))["resources"];
      } finally {
        await engine.stop();
      }
    }

    it.each(
      fixtures.flatMap(([fixture]) => [
        [fixture, "with its PDB", xray],
        [fixture, "without its PDB", xrayWithoutPdb],
      ]),
    )(
      "makes a Full Reconstruction of the %s Fixture %s, which passes the Round-trip: it rebuilds on every OS, and on Windows stays alive once launched",
      async (fixture, _, reconstruction) => {
        const result = await roundTrip(fixture, reconstruction);

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.smokeTest?.outcome).toBe(
          process.platform === "win32" ? "stayed-alive" : "build-only",
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it.each(fixtures)(
      "rebuilds the %s Fixture's %s with every resource its form reads, its icon and image among them, byte for byte",
      async (fixture, _, assembly) => {
        const original = await buildFixture(fixture);
        const work = await scratch();
        const result = await roundTrip(fixture, xray, { workDirectory: work });
        expect(result.passed, formatRoundTrip(result)).toBe(true);
        const [rebuilt] = (
          await readdir(join(work, "rebuilt", "bin"), {
            withFileTypes: true,
            recursive: true,
          })
        )
          .filter((entry) => entry.isFile() && entry.name === assembly)
          .map((entry) => join(entry.parentPath, entry.name));

        const resources = await resourcesOf(original.assemblyPath);
        expect(resources).toMatchObject([
          { name: expect.stringMatching(/Form\.resources$/), entries: null },
        ]);
        expect(await resourcesOf(rebuilt as string)).toEqual(resources);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it.each(fixtures)(
      "recovers the %s Fixture's form as a Form whose InitializeComponent builds it as its designer did, its resources read back by a ComponentResourceManager, in a project using Windows Forms",
      async (fixture, name, _, form) => {
        const { assemblyPath } = await buildFixture(fixture);
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(assemblyPath, output, {
          build: false,
        });

        expect(reconstruction).toMatchObject({
          accepted: true,
          summary: { outputKind: "winforms" },
          solution: { outputType: "WinExe" },
          warnings: [{ kind: "resource-kept-as-is" }],
        });
        const code = await readFile(join(output, name, `${form}.cs`), "utf8");
        expect(code).toContain(`public class ${form} : Form\n`);
        expect(code).toContain("\tprivate void InitializeComponent()\n");
        expect(code).toContain(
          `System.ComponentModel.ComponentResourceManager resources = new System.ComponentModel.ComponentResourceManager(typeof(${name}.${form}));`,
        );
        expect(code).toContain(
          'Icon = (System.Drawing.Icon)resources.GetObject("$this.Icon");',
        );
        expect(code).toContain(
          "this.components = new System.ComponentModel.Container();",
        );
        expect(code).toContain("+= new System.EventHandler(this.");
        // A call to its base class's Dispose, not to its own.
        expect(code).toContain("\t\tbase.Dispose(disposing);\n");
        expect(
          await readFile(join(output, name, `${name}.csproj`), "utf8"),
        ).toContain("<UseWindowsForms>true</UseWindowsForms>");
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "keeps the winforms Fixture's ApplicationConfiguration as it was decompiled, for net8.0-windows7.0, which builds on any OS",
      async () => {
        const { assemblyPath } = await buildFixture("winforms");
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(assemblyPath, output);

        expect(reconstruction).toMatchObject({
          outcome: "full",
          solution: { targetFramework: "net8.0-windows7.0" },
        });
        if (!reconstruction.accepted) {
          return;
        }
        expect(reconstruction.solution.files).toContain(
          "Greeter/ApplicationConfiguration.cs",
        );
        const project = await readFile(
          join(output, "Greeter", "Greeter.csproj"),
          "utf8",
        );
        expect(project).toContain(
          "<EnableWindowsTargeting>true</EnableWindowsTargeting>",
        );
        expect(project).toContain(
          '<Target Name="KeepDecompiledApplicationConfiguration" AfterTargets="ResolveTargetingPackAssets">',
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "rebuilds the net48-winforms Fixture beside System.Resources.Extensions, which reads its form's resources, redirecting the version they name to its own",
      async () => {
        const work = await scratch();
        const result = await roundTrip("net48-winforms", xray, {
          workDirectory: work,
        });
        expect(result.passed, formatRoundTrip(result)).toBe(true);
        const [rebuilt] = (
          await readdir(join(work, "rebuilt", "bin"), {
            withFileTypes: true,
            recursive: true,
          })
        )
          .filter((entry) => entry.isFile() && entry.name === "Stopwatch.exe")
          .map((entry) => entry.parentPath);

        expect(
          existsSync(
            join(rebuilt as string, "System.Resources.Extensions.dll"),
          ),
        ).toBe(true);
        expect(
          await readFile(
            join(rebuilt as string, "Stopwatch.exe.config"),
            "utf8",
          ),
        ).toMatch(
          /<assemblyIdentity name="System\.Resources\.Extensions"[^>]*\/>\s*<bindingRedirect oldVersion="0\.0\.0\.0-8\.0\.0\.0" newVersion="8\.0\.0\.0" \/>/,
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  describe("the WPF Fixtures", () => {
    const fixtures = [
      {
        fixture: "wpf",
        name: "Tally",
        assembly: "Tally.dll",
        documents: [
          { entry: "themes/palette.baml", class: null },
          {
            entry: "controls/countbadge.baml",
            class: "Tally.Controls.CountBadge",
          },
          { entry: "mainwindow.baml", class: "Tally.MainWindow" },
          {
            entry: "app.baml",
            class: "Tally.App",
            applicationDefinition: true,
          },
        ],
        resources: ["assets/tally.png"],
      },
      {
        fixture: "net48-wpf",
        name: "Swatches",
        assembly: "Swatches.exe",
        documents: [
          { entry: "themes/styles.baml", class: null },
          { entry: "previewwindow.baml", class: "Swatches.PreviewWindow" },
          { entry: "mainwindow.baml", class: "Swatches.MainWindow" },
          {
            entry: "app.baml",
            class: "Swatches.App",
            applicationDefinition: true,
          },
          {
            entry: "controls/swatchchip.baml",
            class: "Swatches.Controls.SwatchChip",
          },
        ],
        resources: ["assets/swatches.png"],
      },
    ] as const;

    /**
     * Where WPF's reference assemblies are, which the engine needs to tell the
     * types BAML names: none on Windows, which has them; elsewhere, the
     * targeting pack of the Fixture's framework, which building it restored
     * into the global-packages folder: the Windows Desktop framework's for
     * `wpf`, .NET Framework 4.8's for `net48-wpf`.
     */
    async function wpfReferences(fixture: string): Promise<string[]> {
      if (process.platform === "win32") {
        return [];
      }
      if (fixture === "net48-wpf") {
        return [
          join(
            defaultGlobalPackagesFolder(),
            "microsoft.netframework.referenceassemblies.net48",
            "1.0.3",
            "build",
            ".NETFramework",
            "v4.8",
          ),
        ];
      }
      const packs = join(
        defaultGlobalPackagesFolder(),
        "microsoft.windowsdesktop.app.ref",
      );
      const latest = (await readdir(packs))
        .filter((version) => version.startsWith("8.0."))
        .sort((a, b) => Number(a.split(".")[2]) - Number(b.split(".")[2]))
        .at(-1);
      return [join(packs, latest as string, "ref", "net8.0")];
    }

    /**
     * The XAML the engine decompiles an Assembly's BAML to, by entry, and
     * every other entry of its WPF resources, by name, as base64.
     */
    async function wpfResourcesOf(
      fixture: string,
      name: string,
      path: string,
    ): Promise<{
      xaml: unknown;
      others: Record<string, unknown>;
    }> {
      const engine = await startEngine();
      try {
        const { xaml } = await engine.request("decompile", {
          path,
          languageVersion: "12.0",
          referenceDirectories: await wpfReferences(fixture),
        });
        const { resources } = (await engine.request("resources", {
          path,
        })) as {
          resources: {
            name: string;
            entries: { name: string; value: string }[];
          }[];
        };
        const entries =
          resources.find((resource) => resource.name === `${name}.g.resources`)
            ?.entries ?? [];
        return {
          xaml,
          others: Object.fromEntries(
            entries
              .filter((entry) => !entry.name.endsWith(".baml"))
              .map((entry) => [entry.name, entry.value]),
          ),
        };
      } finally {
        await engine.stop();
      }
    }

    it.each(
      fixtures.flatMap(({ fixture }) => [
        [fixture, "with its PDB", xray],
        [fixture, "without its PDB", xrayWithoutPdb],
      ]),
    )(
      "makes a Full Reconstruction of the %s Fixture %s, which passes the Round-trip: it rebuilds on every OS, and on Windows stays alive once launched",
      async (fixture, _, reconstruction) => {
        const result = await roundTrip(fixture, reconstruction);

        expect(result.passed, formatRoundTrip(result)).toBe(true);
        expect(result.smokeTest?.outcome).toBe(
          process.platform === "win32" ? "stayed-alive" : "build-only",
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it.each(fixtures)(
      "rebuilds the $fixture Fixture's $name with its WPF resources as they were: each BAML document, its resource dictionary and styles among them, decompiling to the same XAML as the original's, and its Resource files byte for byte",
      async ({ fixture, name, assembly, documents, resources }) => {
        const original = await buildFixture(fixture);
        const work = await scratch();
        const result = await roundTrip(fixture, xray, { workDirectory: work });
        expect(result.passed, formatRoundTrip(result)).toBe(true);
        const [rebuilt] = (
          await readdir(join(work, "rebuilt", "bin"), {
            withFileTypes: true,
            recursive: true,
          })
        )
          .filter((entry) => entry.isFile() && entry.name === assembly)
          .map((entry) => join(entry.parentPath, entry.name));

        const wpf = await wpfResourcesOf(fixture, name, original.assemblyPath);
        expect(wpf).toMatchObject({
          xaml: {
            resource: `${name}.g.resources`,
            notDecompiled: null,
            documents,
          },
          others: Object.fromEntries(
            resources.map((resource) => [
              resource,
              expect.any(String) as unknown,
            ]),
          ),
        });
        expect(Object.keys(wpf.others)).toEqual(resources);
        expect(await wpfResourcesOf(fixture, name, rebuilt as string)).toEqual(
          wpf,
        );
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "recovers the wpf Fixture's resource dictionary and styles as its XAML had them, each XAML file beside a code-behind that leaves out what the markup compiler generates again, so it compiles without duplicate members",
      async () => {
        const { assemblyPath } = await buildFixture("wpf");
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(assemblyPath, output);

        expect(reconstruction).toMatchObject({
          accepted: true,
          outcome: "full",
          summary: { outputKind: "wpf" },
          solution: {
            targetFramework: "net8.0-windows7.0",
            outputType: "WinExe",
          },
          build: { succeeded: true },
        });
        if (!reconstruction.accepted) {
          return;
        }
        expect(
          reconstruction.build?.diagnostics.filter(
            ({ severity }) => severity === "error",
          ),
        ).toEqual([]);
        // Duplicate members and definitions, and a second entry point.
        expect(reconstruction.build?.output).not.toMatch(
          /CS0102|CS0111|CS0101|CS0017/,
        );
        expect(reconstruction.solution.files).toEqual(
          expect.arrayContaining([
            "Tally/App.xaml",
            "Tally/App.xaml.cs",
            "Tally/MainWindow.xaml",
            "Tally/MainWindow.xaml.cs",
            "Tally/Controls/CountBadge.xaml",
            "Tally/Controls/CountBadge.xaml.cs",
            "Tally/Themes/Palette.xaml",
            "Tally/Assets/tally.png",
          ]),
        );
        const read = (...path: string[]) =>
          readFile(join(output, "Tally", ...path), "utf8");
        const palette = await read("Themes", "Palette.xaml");
        expect(palette).toMatch(/^<ResourceDictionary /);
        expect(palette).toContain(
          '<SolidColorBrush x:Key="AccentBrush" Color="{StaticResource Accent}" />',
        );
        expect(palette).toContain(
          '<sys:Double x:Key="BadgeFontSize">28</sys:Double>',
        );
        expect(palette).toContain(
          '<Style x:Key="Heading" TargetType="{x:Type TextBlock}">',
        );
        const app = await read("App.xaml");
        expect(app).toContain(
          '<ResourceDictionary Source="Themes/Palette.xaml" />',
        );
        // Its implicit style, keyed by the type it styles.
        expect(app).toContain(
          '<Style x:Key="{x:Type Button}" TargetType="{x:Type Button}">',
        );
        expect(app).toContain('StartupUri="MainWindow.xaml"');
        expect(app).toContain('Startup="App_Startup"');
        const window = await read("MainWindow.xaml");
        expect(window).toContain(
          '<Style x:Key="StepButton" TargetType="{x:Type Button}" BasedOn="{StaticResource {x:Type Button}}">',
        );
        expect(window).toContain(
          '<EventSetter Event="MouseDoubleClick" Handler="StepButton_MouseDoubleClick" />',
        );
        expect(window).toContain('Click="IncrementButton_Click"');
        expect(window).toContain('Loaded="Window_Loaded"');
        expect(await read("Controls", "CountBadge.xaml")).toContain(
          'x:FieldModifier="public"',
        );
        const codeBehind = await read("MainWindow.xaml.cs");
        expect(codeBehind).toContain(
          "public partial class MainWindow : Window\n",
        );
        expect(codeBehind).not.toMatch(
          /void InitializeComponent\(|Connect\(|_contentLoaded|_CreateDelegate|IComponentConnector/,
        );
        const project = await read("Tally.csproj");
        expect(project).toContain("<UseWPF>true</UseWPF>");
        expect(project).toContain(
          '<ApplicationDefinition Include="App.xaml" />',
        );
        expect(project).toContain('<Page Include="Themes\\Palette.xaml" />');
        expect(project).toContain('<Resource Include="Assets\\tally.png" />');
        expect(reconstruction.solution.projects[0]?.resources).toEqual([
          {
            name: "Tally.g.resources",
            culture: null,
            public: true,
            recoveredAs: "xaml",
            path: null,
            reason: null,
          },
        ]);
        expect(reconstruction.warnings).toEqual([]);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );

    it(
      "recovers the net48-wpf Fixture's bindings, the converter its app declares, its DataTemplate, triggers and ControlTemplate as its XAML had them, its two windows and its UserControl each beside a code-behind, in a project for net48 built against the framework's reference assemblies",
      async () => {
        const { assemblyPath } = await buildFixture("net48-wpf");
        const output = join(await scratch(), "out");

        const reconstruction = await reconstruct(assemblyPath, output);

        expect(reconstruction).toMatchObject({
          accepted: true,
          outcome: "full",
          summary: { outputKind: "wpf" },
          solution: { targetFramework: "net48", outputType: "WinExe" },
          build: { succeeded: true },
        });
        if (!reconstruction.accepted) {
          return;
        }
        // Duplicate members and definitions, and a second entry point.
        expect(reconstruction.build?.output).not.toMatch(
          /CS0102|CS0111|CS0101|CS0017/,
        );
        expect(reconstruction.solution.files).toEqual(
          expect.arrayContaining([
            "Swatches/App.xaml",
            "Swatches/App.xaml.cs",
            "Swatches/MainWindow.xaml",
            "Swatches/MainWindow.xaml.cs",
            "Swatches/PreviewWindow.xaml",
            "Swatches/PreviewWindow.xaml.cs",
            "Swatches/Controls/SwatchChip.xaml",
            "Swatches/Controls/SwatchChip.xaml.cs",
            "Swatches/Themes/Styles.xaml",
            "Swatches/Assets/swatches.png",
            "Swatches/MixerViewModel.cs",
            "Swatches/ColorToBrushConverter.cs",
          ]),
        );
        const read = (...path: string[]) =>
          readFile(join(output, "Swatches", ...path), "utf8");
        const app = await read("App.xaml");
        expect(app).toContain('xmlns:local="clr-namespace:Swatches"');
        expect(app).toContain(
          '<local:ColorToBrushConverter x:Key="ColorToBrush" />',
        );
        expect(app).toContain(
          '<ResourceDictionary Source="Themes/Styles.xaml" />',
        );
        const window = await read("MainWindow.xaml");
        for (const binding of [
          "<local:MixerViewModel />",
          'Title="{Binding Hex, StringFormat=Swatches {0}}"',
          'Icon="pack://application:,,,/Assets/swatches.png"',
          'Value="{Binding Red}"',
          'Text="{Binding Value, ElementName=redSlider, StringFormat=N0}"',
          'Background="{Binding Color, Converter={StaticResource ColorToBrush}}"',
          'Text="{Binding Name, UpdateSourceTrigger=PropertyChanged}"',
          'Command="{Binding SaveCommand}"',
          'ItemsSource="{Binding Saved}"',
          '<DataTemplate DataType="{x:Type local:Swatch}">',
          '<controls:SwatchChip Color="{Binding Color}" />',
          'Loaded="Window_Loaded"',
        ]) {
          expect(window).toContain(binding);
        }
        expect(await read("Controls", "SwatchChip.xaml")).toContain(
          'Background="{Binding Color, Converter={StaticResource ColorToBrush}, RelativeSource={RelativeSource AncestorType=UserControl}}"',
        );
        expect(await read("PreviewWindow.xaml")).toContain(
          'WindowStyle="ToolWindow"',
        );
        const styles = await read("Themes", "Styles.xaml");
        expect(styles).toContain(
          '<Style x:Key="{x:Type Slider}" TargetType="{x:Type Slider}">',
        );
        expect(styles).toContain(
          '<Style x:Key="HexText" TargetType="{x:Type TextBlock}" BasedOn="{StaticResource Caption}">',
        );
        expect(styles).toContain(
          '<DataTrigger Value="True" Binding="{Binding IsDark}">',
        );
        expect(styles).toContain(
          '<ControlTemplate TargetType="{x:Type Button}">',
        );
        expect(styles).toContain(
          'Background="{TemplateBinding Control.Background}"',
        );
        expect(styles).toContain(
          '<Setter TargetName="chrome" Property="UIElement.Opacity" Value="0.85" />',
        );
        for (const codeBehind of [
          ["MainWindow.xaml.cs"],
          ["PreviewWindow.xaml.cs"],
          ["Controls", "SwatchChip.xaml.cs"],
        ]) {
          expect(await read(...codeBehind)).not.toMatch(
            /void InitializeComponent\(|Connect\(|_contentLoaded|_CreateDelegate|IComponentConnector/,
          );
        }
        expect(await read("Properties", "AssemblyInfo.cs")).toContain(
          "[assembly: ThemeInfo(ResourceDictionaryLocation.None, ResourceDictionaryLocation.SourceAssembly)]",
        );
        const project = await read("Swatches.csproj");
        expect(project).toContain("<TargetFramework>net48</TargetFramework>");
        expect(project).toContain("<UseWPF>true</UseWPF>");
        expect(project).not.toContain("EnableWindowsTargeting");
        expect(project).toContain(
          '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />',
        );
        expect(project).toContain(
          '<ApplicationDefinition Include="App.xaml" />',
        );
        expect(project).toContain('<Page Include="PreviewWindow.xaml" />');
        expect(project).toContain(
          '<Resource Include="Assets\\swatches.png" />',
        );
        expect(reconstruction.solution.projects[0]?.resources).toEqual([
          {
            name: "Swatches.g.resources",
            culture: null,
            public: true,
            recoveredAs: "xaml",
            path: null,
            reason: null,
          },
        ]);
        expect(reconstruction.warnings).toEqual([]);
      },
      ROUND_TRIP_TIMEOUT_MS,
    );
  });

  it("does not accept the native Fixture, and writes nothing", async () => {
    const output = join(await scratch(), "out");
    const inspected: unknown[] = [];

    const reconstruction = await reconstruct(
      NATIVE_EXECUTABLE_FIXTURE,
      output,
      {
        onInspected: (summary) => inspected.push(summary),
      },
    );

    expect(reconstruction).toMatchObject({
      accepted: false,
      classification: { kind: "native-executable" },
    });
    expect(existsSync(output)).toBe(false);
    // It has no metadata to summarize.
    expect(inspected).toEqual([]);
  });

  it(
    "tells of the arithmetic Fixture's metadata summary, as xray inspect gives it, as soon as analyse has read it",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const events: string[] = [];
      const inspected: unknown[] = [];

      await reconstruct(assemblyPath, join(await scratch(), "out"), {
        build: false,
        // On a slow machine analyse may also report its progress, once a
        // second.
        onProgress: (event) => {
          if (event.kind !== "stage-progress") {
            events.push(`${event.kind} ${event.stage}`);
          }
        },
        onInspected: (summary) => {
          inspected.push(summary);
          events.push("inspected");
        },
      });

      const inspection = await inspectAssembly(assemblyPath);
      expect(inspection.accepted).toBe(true);
      expect(inspected).toEqual([
        inspection.accepted ? inspection.summary : undefined,
      ]);
      expect(events.slice(0, 3)).toEqual([
        "stage-started analyse",
        "inspected",
        "stage-finished analyse",
      ]);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );

  it(
    "refuses an output directory that is not empty, and replaces it when forced",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const output = await scratch();
      await writeFile(join(output, "notes.txt"), "mine");

      await expect(reconstruct(assemblyPath, output)).rejects.toMatchObject({
        code: "output-not-empty",
      });
      expect(await readdir(output)).toEqual(["notes.txt"]);

      await expect(
        reconstruct(assemblyPath, output, { force: true }),
      ).resolves.toMatchObject({ outcome: "full" });
      expect((await readdir(output)).sort()).toEqual([
        "Arithmetic",
        "Arithmetic.sln",
        "xray-report.json",
      ]);
    },
    ROUND_TRIP_TIMEOUT_MS,
  );
});
