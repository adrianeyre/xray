import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  targetFrameworkMoniker,
  type AssemblySummary,
  type TargetFramework,
} from "../inspect/assembly-summary.js";
import { buildSolution } from "./build-solution.js";
import {
  planRecoveredSolution,
  type DecompiledAssembly,
} from "./recovered-solution.js";

// These run the real `dotnet build` (and its restore, which fetches each
// framework's reference assemblies from NuGet the first time) on Recovered
// Solutions planned for each .NET Framework 4.x a Fixture does not cover, and
// for .NET Framework 2.0, which an Assembly's CLR and references tell.

const BUILD_TIMEOUT_MS = 5 * 60_000;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

function summaryFor(frameworkName: string): AssemblySummary {
  return summaryOf({
    moniker: targetFrameworkMoniker(frameworkName, null),
    frameworkName,
    runtimeVersion: "v4.0.30319",
    inferredFrom: null,
    support: "full",
  });
}

function summaryOf(targetFramework: TargetFramework): AssemblySummary {
  return {
    path: "/abs/Shop.exe",
    assembly: {
      name: "Shop",
      version: "1.0.0.0",
      culture: null,
      publicKeyToken: null,
    },
    targetFramework,
    architecture: {
      platformTarget: "AnyCPU",
      prefer32Bit: false,
      bitness: "any",
      machine: "I386",
    },
    entryPoint: { type: "Shop.Program", method: "Main" },
    outputKind: "console",
    references: [],
    counts: { types: 1, methods: 1, resources: 0 },
    pdb: { status: "none" },
    obfuscation: { status: "clean", indicators: [] },
  };
}

const PROGRAM = [
  "using System;",
  "",
  "namespace Shop;",
  "",
  "internal static class Program",
  "{",
  "\tprivate static int Main(string[] args)",
  "\t{",
  '\t\tConsole.WriteLine(string.Join(" ", args));',
  "\t\treturn args.Length;",
  "\t}",
  "}",
  "",
].join("\n");

const DECOMPILED: DecompiledAssembly = {
  assemblyAttributes:
    '[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]\n',
  unsafeCode: false,
  nullableAnnotations: false,
  types: [
    {
      namespace: "Shop",
      name: "Program",
      code: PROGRAM,
      sourceFile: null,
      sourcePath: null,
      declares: [{ namespace: "Shop", name: "Program" }],
    },
  ],
};

/** Writes the Recovered Solution of `summary`'s Assembly, holding {@link DECOMPILED}, and builds it. */
async function writeAndBuild(summary: AssemblySummary) {
  const folder = await mkdtemp(join(tmpdir(), "xray-net-framework-"));
  temporary.push(folder);
  const plan = planRecoveredSolution(summary, DECOMPILED);
  for (const file of plan.files) {
    const target = join(folder, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents);
  }
  return buildSolution(join(folder, plan.solutionPath));
}

describe("the Recovered Solution of a .NET Framework 4.x Assembly", () => {
  it.each([
    ".NETFramework,Version=v4.0",
    ".NETFramework,Version=v4.0,Profile=Client",
    ".NETFramework,Version=v4.5",
    ".NETFramework,Version=v4.5.1",
    ".NETFramework,Version=v4.5.2",
    ".NETFramework,Version=v4.6",
    ".NETFramework,Version=v4.6.1",
    ".NETFramework,Version=v4.6.2",
    ".NETFramework,Version=v4.7",
    ".NETFramework,Version=v4.7.1",
    ".NETFramework,Version=v4.7.2",
    ".NETFramework,Version=v4.8",
    ".NETFramework,Version=v4.8.1",
  ])(
    "builds on any OS for %s",
    async (frameworkName) => {
      const build = await writeAndBuild(summaryFor(frameworkName));

      expect(build.succeeded, build.output).toBe(true);
      expect(build.diagnostics).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("the Recovered Solution of a .NET Framework 2.0 Assembly", () => {
  it(
    "builds on any OS as net20, as its CLR and references tell it",
    async () => {
      const build = await writeAndBuild(
        summaryOf({
          moniker: "net20",
          frameworkName: null,
          runtimeVersion: "v2.0.50727",
          inferredFrom:
            "CLR v2.0.50727, and no reference to an assembly of .NET Framework 3.0 or 3.5",
          support: "best-effort",
        }),
      );

      expect(build.succeeded, build.output).toBe(true);
      expect(build.diagnostics).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});
