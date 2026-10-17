import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFixture,
  NATIVE_EXECUTABLE_FIXTURE,
  restoreFixture,
} from "@xray/fixtures";
import type { XrayReport } from "@xray/core";
import { afterEach, describe, expect, it } from "vitest";

import { formatTimings } from "./format-reconstruction.js";

// Runs the `xray` binary itself, as a user would, against the real engine
// built by the global setup, and the real Fixtures.

const XRAY = fileURLToPath(new URL("../bin/xray.js", import.meta.url));

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function xray(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [XRAY, ...args],
      { env },
      (error, stdout, stderr) =>
        resolve({
          code: typeof error?.code === "number" ? error.code : 0,
          stdout,
          stderr,
        }),
    );
  });
}

/** The `xray-report.json` written into `folder`. */
async function reportIn(folder: string): Promise<XrayReport> {
  return JSON.parse(
    await readFile(join(folder, "xray-report.json"), "utf8"),
  ) as XrayReport;
}

/**
 * `stdout` with its Time row, whose durations differ from run to run, as
 * `<time>`, once it is checked to give the timings `report` records.
 */
function timeless(stdout: string, report: XrayReport): string {
  const row = `Time                ${formatTimings(report.timings)}\n`;
  expect(stdout).toContain(row);
  return stdout.replace(row, "Time                <time>\n");
}

/**
 * The progress lines `stderr` starts with, durations as `<time>`, leaving out
 * those saying how far a stage has got (how many depends on how long it
 * takes); then whatever stderr says after them.
 */
/** The PDB the .NET SDK builds beside an Assembly, as every Fixture is built. */
function pdbOf(assemblyPath: string): string {
  return assemblyPath.replace(/\.(dll|exe)$/, ".pdb");
}

function progressIn(stderr: string): { progress: string[]; rest: string } {
  const lines = stderr.split("\n");
  const end = lines.findIndex((line) => !/^\[\d\/6\] /.test(line));
  return {
    progress: lines
      .slice(0, end)
      .map((line) => line.replaceAll(/\b\d+ ms\b|\b\d+\.\d s\b/g, "<time>"))
      .filter((line) => !line.endsWith(" so far")),
    rest: lines.slice(end).join("\n"),
  };
}

/** The progress of a Reconstruction through every stage up to building. */
const TO_BUILD = [
  "[1/6] Analyse…",
  "[1/6] Analyse: done in <time>",
  "[2/6] Decompile…",
  "[2/6] Decompile: done in <time>",
  "[3/6] Resolve dependencies…",
  "[3/6] Resolve dependencies: done in <time>",
  "[4/6] Generate solution…",
  "[4/6] Generate solution: done in <time>",
  "[5/6] Build…",
  "[5/6] Build: done in <time>",
];

/** The progress of a Reconstruction through every stage, its program not asked to run. */
const EVERY_STAGE = [
  ...TO_BUILD,
  "[6/6] Run the rebuilt program: skipped. Running the rebuilt program executes recovered code, so it is run only when asked.",
];

async function scratchFile(name: string, contents: Buffer | string) {
  const folder = await mkdtemp(join(tmpdir(), "xray-inspect-"));
  temporary.push(folder);
  const path = join(folder, name);
  await writeFile(path, contents);
  return path;
}

describe("xray inspect", () => {
  // What Arithmetic.csproj and Program.cs say the arithmetic Fixture is; see
  // ../../core/src/inspect/inspect-assembly.engine.test.ts for why each value.
  it(
    "summarizes the arithmetic Fixture's metadata",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");

      const result = await xray(["inspect", assemblyPath]);

      expect(result).toEqual({
        code: 0,
        stdout: [
          `File              ${assemblyPath}`,
          "Assembly          Arithmetic, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null",
          "Target framework  net8.0 (.NETCoreApp,Version=v8.0)",
          "Architecture      AnyCPU (runs as 64-bit on a 64-bit OS, otherwise 32-bit)",
          "Entry point       Arithmetic.Program.Main",
          "Output kind       Console",
          "Types             1",
          "Methods           9",
          "Resources         0",
          `PDB               ${pdbOf(assemblyPath)} (portable), its own: used for local names and source layout`,
          "Obfuscation       clean: no sign of it found",
          "References        System.Console, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
          "                  System.Runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a",
          "",
        ].join("\n"),
        stderr: "",
      });
    },
    5 * 60_000,
  );

  it(
    "prints the arithmetic Fixture's metadata as JSON",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");

      const result = await xray(["inspect", assemblyPath, "--json"]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toEqual({
        schemaVersion: 1,
        path: assemblyPath,
        assembly: {
          name: "Arithmetic",
          version: "1.0.0.0",
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
        entryPoint: { type: "Arithmetic.Program", method: "Main" },
        outputKind: "console",
        references: [
          {
            name: "System.Console",
            version: "8.0.0.0",
            culture: null,
            publicKeyToken: "b03f5f7f11d50a3a",
          },
          {
            name: "System.Runtime",
            version: "8.0.0.0",
            culture: null,
            publicKeyToken: "b03f5f7f11d50a3a",
          },
        ],
        counts: { types: 1, methods: 9, resources: 0 },
        pdb: {
          status: "matching",
          path: pdbOf(assemblyPath),
          format: "portable",
        },
        obfuscation: { status: "clean", indicators: [] },
      });
    },
    5 * 60_000,
  );

  it(
    "says the obfuscated Fixture is likely obfuscated, and why",
    async () => {
      const { assemblyPath } = await buildFixture("obfuscated");

      const result = await xray(["inspect", assemblyPath]);

      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(result.stdout).toMatch(
        new RegExp(
          [
            "\\nPDB               none beside it",
            "Obfuscation       likely obfuscated, so reconstructed as it is, not deobfuscated:",
            "                  \\d+ of its \\d+ names \\(9\\d%\\) are one or two characters long, such as A, a, B, b, C: names an obfuscator gives, not a programmer\\.",
            "                  Its strings are hidden: \\d+ calls fetch them from string decoders, which decode them from bytes \\(in <PrivateImplementationDetails>\\{.+\\}\\..+\\), against 0 literals\\.",
            "References        ",
          ].join("\\n"),
        ),
      );
    },
    5 * 60_000,
  );

  it("rejects the native Fixture, explaining why a Native Executable cannot be reconstructed", async () => {
    const result = await xray(["inspect", NATIVE_EXECUTABLE_FIXTURE]);

    expect(result).toEqual({
      code: 3,
      stdout: "",
      stderr: [
        '"hello.exe" is a Native Executable (x64 machine code), not a Managed Assembly, so Xray cannot reconstruct it.',
        "It has no CLI header: it was compiled straight to machine code (from C, C++, Rust, Go or similar), which discards the types, members and signatures that .NET IL and metadata keep. The most that could be recovered from it is pseudocode, never a C# solution that builds and behaves like the original.",
        "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.",
        "",
      ].join("\n"),
    });
  });

  it("rejects the native Fixture the same way with --json", async () => {
    const result = await xray(["inspect", "--json", NATIVE_EXECUTABLE_FIXTURE]);

    expect(result).toMatchObject({ code: 3, stdout: "" });
    expect(result.stderr).toMatch(
      /^"hello\.exe" is a Native Executable \(x64 machine code\)/,
    );
  });

  it("rejects a text file as not a PE file", async () => {
    const path = await scratchFile("notes.txt", "Just some text.\n");

    const result = await xray(["inspect", path]);

    expect(result).toEqual({
      code: 3,
      stdout: "",
      stderr: [
        '"notes.txt" is not a PE file: it does not start with the "MZ" signature every PE file has. It is neither a Managed Assembly nor a Native Executable, so Xray cannot reconstruct it.',
        "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.",
        "",
      ].join("\n"),
    });
  });

  it("rejects random bytes as not a PE file", async () => {
    // Looks random, but the same on every run, so it never happens to start "MZ".
    const noise = Buffer.concat(
      Array.from({ length: 128 }, (_, i) =>
        createHash("sha256").update(`xray #8 noise ${i}`).digest(),
      ),
    );
    const path = await scratchFile("random.exe", noise);

    const result = await xray(["inspect", path]);

    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/^"random\.exe" is not a PE file: /);
  });

  it("exits 1, not 3, when there is no file to classify", async () => {
    const path = join(tmpdir(), "xray-no-such-file.dll");

    const result = await xray(["inspect", path]);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `There is no file at ${path}.\n`,
    });
  });
});

describe("xray reconstruct", () => {
  it(
    "makes a Full Reconstruction of the arithmetic Fixture, laid out as <Name>.sln and <Name>/<Name>.csproj",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", assemblyPath, "-o", output]);

      const report = await reportIn(output);
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr),
      }).toEqual({
        code: 0,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            Arithmetic.sln",
          "Project             Arithmetic/Arithmetic.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          "Types               1, each decompiled to a file of its own",
          "Resources           none",
          `PDB                 ${pdbOf(assemblyPath)}, used for local names and source layout`,
          "Obfuscation         clean: no sign of it found",
          "Dependencies        2 references: 2 framework",
          "NuGet packages      none needed",
          "Sibling Assemblies  none found beside it",
          "Copied binaries     none",
          "Build               succeeded",
          "Time                <time>",
          "Outcome             Full Reconstruction",
          "Report              xray-report.json",
          "",
        ].join("\n"),
        stderr: { progress: EVERY_STAGE, rest: "" },
      });
      expect(report).toMatchObject({
        schemaVersion: 1,
        outcome: "full",
        inputs: { path: assemblyPath, options: { build: true, run: false } },
        solution: { solutionPath: "Arithmetic.sln", typeCount: 1 },
        build: { succeeded: true, diagnostics: [] },
      });
      expect((await readdir(output)).sort()).toEqual([
        "Arithmetic",
        "Arithmetic.sln",
        "xray-report.json",
      ]);
      expect(
        (await readdir(join(output, "Arithmetic")))
          .filter((entry) => !["bin", "obj"].includes(entry))
          .sort(),
      ).toEqual(["Arithmetic.csproj", "Program.cs", "Properties"]);
    },
    5 * 60_000,
  );

  it(
    "warns on stderr of another build's PDB beside the arithmetic Fixture, which it ignores, a Full Reconstruction all the same, and exits 0",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const { assemblyPath: other } = await buildFixture("copied-binary");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const input = join(parent, "in");
      await mkdir(input);
      for (const file of ["Arithmetic.dll", "Arithmetic.runtimeconfig.json"]) {
        await copyFile(join(dirname(assemblyPath), file), join(input, file));
      }
      const pdb = join(input, "Arithmetic.pdb");
      await copyFile(pdbOf(other), pdb);
      const output = join(parent, "out");

      const result = await xray([
        "reconstruct",
        join(input, "Arithmetic.dll"),
        "-o",
        output,
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `\nPDB                 ${pdb}, ignored, as it is not the Assembly's own\n`,
      );
      expect(result.stdout).toContain(
        "Outcome             Full Reconstruction",
      );
      expect(progressIn(result.stderr)).toEqual({
        progress: EVERY_STAGE,
        rest: `Warning: Ignored the PDB beside Arithmetic.dll, ${pdb}. Arithmetic.pdb, a portable PDB, is not Arithmetic.dll's own: its ID is not the one Arithmetic.dll records, so it is another build's. So Arithmetic's local variables are named, and its source files laid out, as without a PDB.\n`,
      });
      expect((await reportIn(output)).warnings).toHaveLength(1);
    },
    5 * 60_000,
  );

  it(
    "refuses an output directory that is not empty, unless --force",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const output = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(output);
      await writeFile(join(output, "notes.txt"), "mine");

      const refused = await xray(["reconstruct", assemblyPath, "-o", output]);

      expect({ ...refused, stderr: progressIn(refused.stderr) }).toEqual({
        code: 1,
        stdout: "",
        stderr: {
          progress: ["[1/6] Analyse…", "[1/6] Analyse: failed after <time>"],
          rest: `${output} is not empty. Choose an empty or new folder, or pass --force to replace what is in it.\n`,
        },
      });
      expect(await readdir(output)).toEqual(["notes.txt"]);

      const forced = await xray([
        "reconstruct",
        assemblyPath,
        "-o",
        output,
        "--force",
      ]);

      expect(forced).toMatchObject({ code: 0 });
      expect(progressIn(forced.stderr)).toEqual({
        progress: EVERY_STAGE,
        rest: "",
      });
      expect(forced.stdout).toContain(
        "Outcome             Full Reconstruction",
      );
      expect((await readdir(output)).sort()).toEqual([
        "Arithmetic",
        "Arithmetic.sln",
        "xray-report.json",
      ]);
    },
    5 * 60_000,
  );

  it(
    "makes a Partial Reconstruction of the missing-reference Fixture, naming its Unresolved Dependency and why, listing its build error at file:line, and exits 4",
    async () => {
      const { assemblyPath } = await buildFixture("missing-reference");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", assemblyPath, "-o", output]);

      const program = await readFile(
        join(output, "MissingReference", "Program.cs"),
        "utf8",
      );
      const line = program.split(/\r?\n/).indexOf("using Greetings;") + 1;
      expect(line).toBeGreaterThan(0);
      const report = await reportIn(output);
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr),
      }).toEqual({
        code: 4,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            MissingReference.sln",
          "Project             MissingReference/MissingReference.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          "Types               1, each decompiled to a file of its own",
          "Resources           none",
          `PDB                 ${pdbOf(assemblyPath)}, used for local names and source layout`,
          "Obfuscation         clean: no sign of it found",
          "Dependencies        3 references: 2 framework, 1 unresolved",
          "NuGet packages      none found",
          "Sibling Assemblies  none found beside it",
          "Copied binaries     none",
          "Build               failed with 1 error",
          "Time                <time>",
          "Outcome             Partial Reconstruction",
          "Report              xray-report.json",
          "",
          "Partial, because nothing satisfies this reference, an Unresolved Dependency:",
          "  Greetings 1.0.0.0, referenced by MissingReference. Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for. No Managed Assembly named Greetings is beside the input to reconstruct or copy, so nothing satisfies it.",
          "",
          "Partial, because the Recovered Solution did not build:",
          `  MissingReference/Program.cs:${line}:7: error CS0246: The type or namespace name 'Greetings' could not be found (are you missing a using directive or an assembly reference?)`,
          "",
        ].join("\n"),
        stderr: { progress: EVERY_STAGE, rest: "" },
      });
      const error = {
        severity: "error",
        code: "CS0246",
        file: "MissingReference/Program.cs",
        line,
        column: 7,
      };
      expect(report).toMatchObject({
        schemaVersion: 1,
        outcome: "partial",
        reasons: [
          {
            kind: "unresolved-dependencies",
            dependencies: [
              {
                reference: { name: "Greetings" },
                resolution: "unresolved",
              },
            ],
          },
          { kind: "build-failed", errors: [error] },
        ],
        inputs: { path: assemblyPath, options: { build: true, run: false } },
        build: { succeeded: false, diagnostics: [error] },
      });
    },
    5 * 60_000,
  );

  it(
    "reconstructs the multi-assembly Fixture from its folder, each Sibling Assembly a project of its own, and exits 0",
    async () => {
      const { outputDirectory } = await buildFixture("multi-assembly");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", outputDirectory, "-o", output]);

      const report = await reportIn(output);
      const types = (projectPath: string) =>
        report.solution.projects.find(
          (project) => project.projectPath === projectPath,
        )?.typeCount;
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr),
      }).toEqual({
        code: 0,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            MultiAssembly.sln",
          "Project             MultiAssembly/MultiAssembly.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          // Program.cs declares Program and HalfPriceOn.
          "Types               2, decompiled to 1 file",
          "Resources           none",
          `PDB                 MultiAssembly/MultiAssembly.csproj: ${join(outputDirectory, "MultiAssembly.pdb")}, used for local names and source layout`,
          `                    Inventory/Inventory.csproj: ${join(outputDirectory, "Inventory.pdb")}, used for local names and source layout`,
          `                    Pricing/Pricing.csproj: ${join(outputDirectory, "Pricing.pdb")}, used for local names and source layout`,
          "Obfuscation         MultiAssembly/MultiAssembly.csproj: clean: no sign of it found",
          "                    Inventory/Inventory.csproj: clean: no sign of it found",
          "                    Pricing/Pricing.csproj: clean: no sign of it found",
          "Dependencies        7 references: 5 framework, 2 Sibling Assemblies",
          "NuGet packages      none found",
          "Sibling Assemblies  2, each a project of its own:",
          `                    Inventory/Inventory.csproj (${types("Inventory/Inventory.csproj")} types)`,
          `                    Pricing/Pricing.csproj (${types("Pricing/Pricing.csproj")} types)`,
          "Copied binaries     none",
          "Build               succeeded",
          "Time                <time>",
          "Outcome             Full Reconstruction",
          "Report              xray-report.json",
          "",
        ].join("\n"),
        stderr: { progress: EVERY_STAGE, rest: "" },
      });
      expect(report).toMatchObject({
        outcome: "full",
        inputs: {
          path: join(outputDirectory, "MultiAssembly.dll"),
          options: { siblings: true },
        },
      });
    },
    5 * 60_000,
  );

  it(
    "copies the multi-assembly Fixture's libraries into Dependencies with --no-siblings, rather than reconstruct them, a Full Reconstruction, and exits 0",
    async () => {
      const { assemblyPath } = await buildFixture("multi-assembly");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray([
        "reconstruct",
        assemblyPath,
        "-o",
        output,
        "--no-siblings",
      ]);

      const beside = (file: string) => join(dirname(assemblyPath), file);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        [
          "",
          "Dependencies        4 references: 2 framework, 2 copied binaries",
          "NuGet packages      none found",
          "Sibling Assemblies  not reconstructed (--no-siblings)",
          "Copied binaries     2, each referenced with a HintPath:",
          `                    Dependencies/Inventory.dll, from ${beside("Inventory.dll")}`,
          `                    Dependencies/Pricing.dll, from ${beside("Pricing.dll")}`,
          "Build               succeeded",
          "",
        ].join("\n"),
      );
      // Still run, to look its references up as NuGet packages.
      expect(progressIn(result.stderr).progress).toContain(
        "[3/6] Resolve dependencies: done in <time>",
      );
      expect((await readdir(output)).sort()).toEqual([
        "Dependencies",
        "MultiAssembly",
        "MultiAssembly.sln",
        "xray-report.json",
      ]);
      expect(await reportIn(output)).toMatchObject({
        outcome: "full",
        inputs: { options: { siblings: false } },
      });
    },
    5 * 60_000,
  );

  it(
    "copies the copied-binary Fixture's third party's library into Dependencies, listing where it was found, a Full Reconstruction, and exits 0",
    async () => {
      const { assemblyPath } = await buildFixture("copied-binary");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", assemblyPath, "-o", output]);

      const report = await reportIn(output);
      const vendor = join(dirname(assemblyPath), "Kestrelwood.Checksums.dll");
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr),
      }).toEqual({
        code: 0,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            CopiedBinary.sln",
          "Project             CopiedBinary/CopiedBinary.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          // Program.cs declares ByteSum and Program.
          "Types               2, decompiled to 1 file",
          "Resources           none",
          `PDB                 ${pdbOf(assemblyPath)}, used for local names and source layout`,
          "Obfuscation         clean: no sign of it found",
          "Dependencies        3 references: 2 framework, 1 copied binary",
          "NuGet packages      none found",
          "Sibling Assemblies  none found beside it",
          "Copied binaries     1, each referenced with a HintPath:",
          `                    Dependencies/Kestrelwood.Checksums.dll, from ${vendor}`,
          "Build               succeeded",
          "Time                <time>",
          "Outcome             Full Reconstruction",
          "Report              xray-report.json",
          "",
        ].join("\n"),
        stderr: { progress: EVERY_STAGE, rest: "" },
      });
      expect(
        await readFile(
          join(output, "Dependencies", "Kestrelwood.Checksums.dll"),
        ),
      ).toEqual(await readFile(vendor));
    },
    5 * 60_000,
  );

  it(
    "makes no network calls with --offline, from Xray or from dotnet build, where without it NuGet would",
    async () => {
      await restoreFixture("nuget-dependencies");
      const { assemblyPath } = await buildFixture("nuget-dependencies");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      // Every connection Xray or dotnet makes goes through this proxy, which
      // records what it was asked for and refuses it.
      const connections: string[] = [];
      const trap = createServer((socket) => {
        socket.once("data", (request) => {
          connections.push(request.toString().split("\r\n")[0] ?? "");
          socket.destroy();
        });
      });
      await new Promise<void>((resolve) =>
        trap.listen(0, "127.0.0.1", resolve),
      );
      const proxy = `http://127.0.0.1:${(trap.address() as { port: number }).port}`;
      const env = {
        ...process.env,
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        NO_PROXY: "",
        no_proxy: "",
        NODE_USE_ENV_PROXY: "1",
        // Nothing NuGet asked for before, as its audit data, is answered from
        // its cache.
        NUGET_HTTP_CACHE_PATH: join(parent, "http-cache"),
      };
      try {
        const offline = await xray(
          [
            "reconstruct",
            assemblyPath,
            "-o",
            join(parent, "offline"),
            "--offline",
          ],
          env,
        );

        expect(offline.code, offline.stdout + offline.stderr).toBe(0);
        expect(connections).toEqual([]);
        expect(offline.stdout).toContain(
          [
            "NuGet packages      2, each a PackageReference (--offline: only the global-packages cache was looked in):",
            "                    Newtonsoft.Json 13.0.3, from the global-packages cache",
            "                    Serilog 3.1.1, from the global-packages cache",
            "Sibling Assemblies  none found beside it",
            "Copied binaries     none",
            "Build               succeeded",
          ].join("\n"),
        );
        expect(await reportIn(join(parent, "offline"))).toMatchObject({
          outcome: "full",
          inputs: { options: { offline: true } },
        });

        // Without --offline, dotnet build's restore asks nuget.org about the
        // packages' vulnerabilities, so the trap does catch what it is sent.
        const online = await xray(
          ["reconstruct", assemblyPath, "-o", join(parent, "online")],
          env,
        );

        expect(online.code, online.stdout + online.stderr).toBe(0);
        expect(connections).toContain("CONNECT api.nuget.org:443 HTTP/1.1");
      } finally {
        await new Promise((resolve) => trap.close(resolve));
      }
    },
    5 * 60_000,
  );

  it(
    "runs the arithmetic Fixture's rebuilt program with --run, after warning that it executes recovered code, and records its exit code",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray([
        "reconstruct",
        assemblyPath,
        "-o",
        output,
        "--run",
      ]);

      const report = await reportIn(output);
      const warning =
        "Warning: --run executes recovered code. Once the Recovered Solution builds, its program runs on this machine, as you.";
      expect(result.stderr.startsWith(`${warning}\n`)).toBe(true);
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr.slice(warning.length + 1)),
      }).toEqual({
        code: 0,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            Arithmetic.sln",
          "Project             Arithmetic/Arithmetic.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          "Types               1, each decompiled to a file of its own",
          "Resources           none",
          `PDB                 ${pdbOf(assemblyPath)}, used for local names and source layout`,
          "Obfuscation         clean: no sign of it found",
          "Dependencies        2 references: 2 framework",
          "NuGet packages      none needed",
          "Sibling Assemblies  none found beside it",
          "Copied binaries     none",
          "Build               succeeded",
          // With no arguments, it prints its usage and exits 1.
          "Run                 exited with code 1",
          "Time                <time>",
          "Outcome             Full Reconstruction",
          "Report              xray-report.json",
          "",
        ].join("\n"),
        stderr: {
          progress: [
            ...TO_BUILD,
            "[6/6] Run the rebuilt program…",
            "[6/6] Run the rebuilt program: done in <time>",
          ],
          rest: "",
        },
      });
      expect(report).toMatchObject({
        outcome: "full",
        inputs: { options: { build: true, run: true } },
        run: {
          status: "exited",
          reason: null,
          program: "Arithmetic/bin/Debug/net8.0/Arithmetic.dll",
          exitCode: 1,
          stdout: "",
          stderr: expect.stringMatching(
            /^Usage: Arithmetic <int\|long\|double\|decimal> <left> <right>\r?\n$/,
          ) as unknown,
        },
        timings: { run: expect.any(Number) as unknown },
      });
    },
    5 * 60_000,
  );

  it(
    "recovers the resources Fixture's resources, its satellite assemblies' too, counting what became of them, warning on stderr of the .resources file it kept as it is",
    async () => {
      const { assemblyPath } = await buildFixture("resources");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", assemblyPath, "-o", output]);

      const report = await reportIn(output);
      expect({
        ...result,
        stdout: timeless(result.stdout, report),
        stderr: progressIn(result.stderr),
      }).toEqual({
        code: 0,
        stdout: [
          `Recovered Solution  ${output}`,
          "Solution            Phrasebook.sln",
          "Project             Phrasebook/Phrasebook.csproj",
          "Target framework    net8.0",
          "Output type         Exe",
          "Types               4, each decompiled to a file of its own",
          "Resources           11, each under its own name: 6 written as .resx, 5 embedded as they are; 2 satellite assemblies (de, fr)",
          `PDB                 ${pdbOf(assemblyPath)}, used for local names and source layout`,
          "Obfuscation         clean: no sign of it found",
          "Dependencies        4 references: 4 framework",
          "NuGet packages      none needed",
          "Sibling Assemblies  none found beside it",
          "Copied binaries     none",
          "Build               succeeded",
          "Time                <time>",
          "Outcome             Full Reconstruction",
          "Report              xray-report.json",
          "",
        ].join("\n"),
        stderr: {
          progress: EVERY_STAGE,
          rest: 'Warning: Phrasebook.Limits.resources, a resource of Phrasebook.dll, is embedded as it is, as Phrasebook/Limits.resources, rather than written as a .resx. Its entry "MaxPhrases" is a System.Int32, not a string, a byte[] or a stream. A .resx the .NET SDK builds holds only strings, and byte[]s and streams in files it refers to, without System.Resources.Extensions; the rebuilt Assembly holds this resource byte for byte all the same.\n',
        },
      });
      expect(report.warnings.map(({ kind }) => kind)).toEqual([
        "resource-kept-as-is",
      ]);
    },
    5 * 60_000,
  );

  it("refuses --run with --no-build, as there would be no program to run", async () => {
    const result = await xray([
      "reconstruct",
      "Any.dll",
      "-o",
      "out",
      "--run",
      "--no-build",
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "--run runs the program the Recovered Solution builds to, so it cannot be given with --no-build.",
    );
  });

  it(
    "skips building with --no-build, saying the Recovered Solution was not verified, and exits 0",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray([
        "reconstruct",
        assemblyPath,
        "-o",
        output,
        "--no-build",
      ]);

      expect(result).toMatchObject({ code: 0 });
      expect(progressIn(result.stderr)).toEqual({
        progress: [
          ...TO_BUILD.slice(0, -2),
          "[5/6] Build: skipped. Building was skipped, so the Recovered Solution is not verified.",
          EVERY_STAGE.at(-1),
        ],
        rest: "",
      });
      expect(result.stdout).toContain(
        "Build               skipped (--no-build), so the Recovered Solution was not verified\n",
      );
      expect(result.stdout).toContain(
        "Outcome             Unverified: not built, so neither Full nor Partial\n",
      );
      const report = await reportIn(output);
      expect(timeless(result.stdout, report)).toContain(
        "Time                <time>\n",
      );
      expect(report).toMatchObject({
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
    5 * 60_000,
  );

  it(
    "makes a Partial Reconstruction of the missing-reference Fixture with --no-build, for its Unresolved Dependency, though it is not built, and exits 4",
    async () => {
      const { assemblyPath } = await buildFixture("missing-reference");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray([
        "reconstruct",
        assemblyPath,
        "-o",
        output,
        "--no-build",
      ]);

      expect(result.code).toBe(4);
      expect(result.stdout).toContain(
        "Build               skipped (--no-build), so the Recovered Solution was not verified\n",
      );
      expect(result.stdout).toContain(
        "Outcome             Partial Reconstruction\n",
      );
      expect(result.stdout).toContain(
        "\n\nPartial, because nothing satisfies this reference, an Unresolved Dependency:\n  Greetings 1.0.0.0, referenced by MissingReference. ",
      );
      expect(await reportIn(output)).toMatchObject({
        outcome: "partial",
        reasons: [{ kind: "unresolved-dependencies" }],
        build: null,
      });
    },
    5 * 60_000,
  );

  it(
    "reconstructs the obfuscated Fixture as it is, saying it is likely obfuscated, warning of it on stderr, and exits 4 as C# cannot declare the names Obfuscar gave",
    async () => {
      const { assemblyPath } = await buildFixture("obfuscated");
      const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
      temporary.push(parent);
      const output = join(parent, "out");

      const result = await xray(["reconstruct", assemblyPath, "-o", output]);

      const report = await reportIn(output);
      expect(report.obfuscated).toBe(true);
      expect(result.code).toBe(4);
      expect(result.stdout).toContain(
        [
          "PDB                 none beside the Assembly",
          "Obfuscation         likely obfuscated (mangled names, hidden strings): reconstructed as it is, not deobfuscated",
          "",
        ].join("\n"),
      );
      expect(result.stdout).toContain(
        "Outcome             Partial Reconstruction",
      );
      const { progress, rest } = progressIn(result.stderr);
      expect(progress).toEqual(EVERY_STAGE);
      expect(rest).toBe(
        `Warning: ${report.warnings.map(({ message }) => message).join("")}\n`,
      );
      expect(rest).toMatch(
        /^Warning: Obfuscated\.dll is likely obfuscated\. .+ It was reconstructed as it is, not deobfuscated: Obfuscated's names and strings are the obfuscator's\.\n$/,
      );
    },
    5 * 60_000,
  );

  it("rejects the native Fixture as it does for inspect, writing nothing", async () => {
    const parent = await mkdtemp(join(tmpdir(), "xray-reconstruct-"));
    temporary.push(parent);

    const result = await xray([
      "reconstruct",
      NATIVE_EXECUTABLE_FIXTURE,
      "-o",
      join(parent, "out"),
    ]);

    expect(result).toMatchObject({ code: 3, stdout: "" });
    const { progress, rest } = progressIn(result.stderr);
    expect(progress).toEqual([
      "[1/6] Analyse…",
      "[1/6] Analyse: done in <time>",
    ]);
    expect(rest).toMatch(
      /^"hello\.exe" is a Native Executable \(x64 machine code\), not a Managed Assembly/,
    );
    expect(await readdir(parent)).toEqual([]);
  });
});

describe("the xray binary", () => {
  it("passes `xray doctor` on a correctly set-up machine", async () => {
    const result = await xray(["doctor"]);

    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^PASS {2}Node\.js {6}26\.10\.0$/m);
    expect(result.stdout).toMatch(/^PASS {2}\.NET SDK {5}(\d+)\.\d+\.\d+/m);
    expect(result.stdout).toMatch(/^PASS {2}Xray engine {2}0\.0\.0/m);
    expect(result.stdout).toMatch(/All 3 checks passed\.\n$/);
    expect(result.code).toBe(0);
  });

  it("fails `xray doctor`, with install guidance, when dotnet is not on PATH", async () => {
    const empty = await mkdtemp(join(tmpdir(), "xray-empty-path-"));
    temporary.push(empty);
    // Windows spells it "Path"; drop every spelling before setting our own.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toUpperCase() !== "PATH",
      ),
    );

    const result = await xray(["doctor"], { ...env, PATH: empty });

    expect(result.stdout).toMatch(/^PASS {2}Node\.js/m);
    expect(result.stdout).toContain(
      'FAIL  .NET SDK     "dotnet" was not found, so no .NET SDK is available.',
    );
    expect(result.stdout).toContain(
      "Fix: Install the .NET SDK 8 or later from https://dot.net and make sure `dotnet` is on PATH.",
    );
    expect(result.stdout).toMatch(/^FAIL {2}Xray engine/m);
    expect(result.stdout).toContain("2 of 3 checks failed.");
    expect(result.code).toBe(1);
  });

  it("exits 2 on a command it does not know", async () => {
    const result = await xray(["frobnicate"]);

    expect(result.stderr).toContain('Unknown command "frobnicate".');
    expect(result.code).toBe(2);
  });
});
