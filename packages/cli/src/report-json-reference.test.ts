import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { PdbCheck, XrayReport } from "@xray/core";
import { buildFixture, restoreFixture } from "@xray/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Holds the `xray-report.json` reference to what the binary really writes, for
// a Full Reconstruction, a Partial one, one whose program ran (`--run`), ones
// with Sibling Assemblies (one of them twice) and with a cycle, one with
// NuGet packages, one with a copied binary, one with another build's PDB
// beside it, one of an obfuscated Assembly, and one with resources and
// satellite assemblies, so the documented schema cannot drift from it.

const XRAY = fileURLToPath(new URL("../bin/xray.js", import.meta.url));
const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-report-json.md", import.meta.url),
);

// Fields documented elsewhere, whose own fields the Fields table leaves out:
// the inspect summary, diagnostics (the Diagnostics table), and the
// Unresolved Dependencies of a reason, each as `dependencies` gives it.
const DOCUMENTED_ELSEWHERE = new Set([
  "inspect",
  "build.diagnostics",
  "reasons[].errors",
  "reasons[].dependencies",
]);

let reference: string;
let full: XrayReport;
let partial: XrayReport;
let ran: XrayReport;
let multi: XrayReport;
let cyclic: XrayReport;
let duplicated: XrayReport;
let nuget: XrayReport;
let copied: XrayReport;
let stale: XrayReport;
let obfuscated: XrayReport;
let net35: XrayReport;
let resources: XrayReport;
let inspected: Record<string, unknown>;
const temporary: string[] = [];

/** What `xray reconstruct` writes as `xray-report.json` for a Fixture; it may exit 4, for Partial. */
async function reportFor(
  fixture: string,
  ...options: string[]
): Promise<XrayReport> {
  const { assemblyPath } = await buildFixture(fixture);
  return reportOf(assemblyPath, ...options);
}

/** What `xray reconstruct` writes as `xray-report.json` for the Assembly or folder at `input`. */
async function reportOf(
  input: string,
  ...options: string[]
): Promise<XrayReport> {
  const parent = await mkdtemp(join(tmpdir(), "xray-report-"));
  temporary.push(parent);
  const output = join(parent, "out");
  await promisify(execFile)(process.execPath, [
    XRAY,
    "reconstruct",
    input,
    "-o",
    output,
    ...options,
  ]).catch((error: unknown) => {
    if ((error as { code?: unknown }).code !== 4) {
      throw error;
    }
  });
  // The .NET SDK's own targeting pack differs, by its patch version, machine
  // to machine: as the reference's examples put it.
  return JSON.parse(
    (await readFile(join(output, "xray-report.json"), "utf8")).replaceAll(
      /Microsoft\.NETCore\.App\.Ref 8\.0\.\d+,/g,
      "Microsoft.NETCore.App.Ref 8.0.31,",
    ),
  ) as XrayReport;
}

beforeAll(async () => {
  reference = await readFile(REFERENCE, "utf8");
  // The multi-assembly Fixture's build folder, with Inventory there twice.
  const { outputDirectory } = await buildFixture("multi-assembly");
  const twice = join(await mkdtemp(join(tmpdir(), "xray-report-")), "app");
  temporary.push(dirname(twice));
  await cp(outputDirectory, twice, { recursive: true });
  await copyFile(join(twice, "Inventory.dll"), join(twice, "Inventory.exe"));
  // So its packages are found in the global-packages cache, as documented.
  await restoreFixture("nuget-dependencies");
  // The arithmetic Fixture, with the copied-binary Fixture's PDB as its own.
  const arithmetic = await buildFixture("arithmetic");
  const { assemblyPath: other } = await buildFixture("copied-binary");
  const app = join(await mkdtemp(join(tmpdir(), "xray-report-")), "app");
  temporary.push(dirname(app));
  await mkdir(app);
  for (const file of ["Arithmetic.dll", "Arithmetic.runtimeconfig.json"]) {
    await copyFile(join(arithmetic.outputDirectory, file), join(app, file));
  }
  await copyFile(other.replace(/\.dll$/, ".pdb"), join(app, "Arithmetic.pdb"));
  [
    full,
    partial,
    ran,
    multi,
    cyclic,
    duplicated,
    nuget,
    copied,
    stale,
    obfuscated,
    net35,
    resources,
  ] = await Promise.all([
    reportFor("arithmetic"),
    reportFor("missing-reference"),
    reportFor("arithmetic", "--run"),
    reportFor("multi-assembly"),
    reportFor("cyclic-reference"),
    reportOf(twice),
    reportFor("nuget-dependencies"),
    reportFor("copied-binary"),
    reportOf(join(app, "Arithmetic.dll")),
    reportFor("obfuscated"),
    reportFor("net35-library"),
    reportFor("resources"),
  ]);
  const { assemblyPath } = await buildFixture("arithmetic");
  const { stdout } = await promisify(execFile)(process.execPath, [
    XRAY,
    "inspect",
    "--json",
    assemblyPath,
  ]);
  inspected = JSON.parse(stdout) as Record<string, unknown>;
}, 5 * 60_000);

afterAll(async () => {
  await Promise.all(
    temporary.map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 5 }),
    ),
  );
});

/** A PDB's check, as if the PDB were in `folder`, as the reference's examples put it. */
function movedTo(pdb: PdbCheck, folder: string): PdbCheck {
  // The examples' folders are POSIX paths, whatever this OS's are.
  return pdb.status === "none"
    ? pdb
    : { ...pdb, path: posix.join(folder, basename(pdb.path)) };
}

/**
 * An example's JSON, parsed, with each file it puts in `/home/me/app` put in
 * `folder` instead, as this OS writes a path there.
 */
function exampleIn(example: string, folder: string): unknown {
  return JSON.parse(example, (_key, value: unknown) =>
    typeof value === "string"
      ? value.replaceAll(/\/home\/me\/app\/([\w.-]+)/g, (_path, file: string) =>
          join(folder, file),
        )
      : value,
  );
}

/** The text of the reference's section headed `## heading`. */
function section(heading: string): string {
  const start = reference.indexOf(`\n## ${heading}\n`);
  expect(start, `the reference has a "## ${heading}" section`).not.toBe(-1);
  const end = reference.indexOf("\n## ", start + 1);
  return reference.slice(start, end === -1 ? undefined : end);
}

/** The fields a table in `text` documents, in order. */
function documentedFields(text: string): string[] {
  return [...text.matchAll(/^\| `([^`]+)` \|/gm)].map(
    ([, field]) => field as string,
  );
}

/** Every field of a document, as the reference writes them: `a.b`, `list[].c`. */
function fieldsOf(value: unknown, prefix = ""): string[] {
  if (DOCUMENTED_ELSEWHERE.has(prefix)) {
    return [];
  }
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => fieldsOf(item, `${prefix}[]`)))];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const field = prefix === "" ? key : `${prefix}.${key}`;
    return [field, ...fieldsOf(child, field)];
  });
}

describe("docs/reference/xray-report-json.md", () => {
  it("documents the schema version xray writes", () => {
    expect(full.schemaVersion).toBe(partial.schemaVersion);
    expect(section("Stability")).toContain(
      `\`schemaVersion\` is \`${String(full.schemaVersion)}\``,
    );
  });

  it("gives, as its example, what xray writes for the arithmetic Fixture", () => {
    const [, example] =
      /```json\n([\s\S]*?)\n```/.exec(section("Example")) ?? [];
    expect(example).toBeDefined();
    const documented = JSON.parse(example as string) as XrayReport;

    // Only the paths, the build's output and the timings differ run to run.
    const pdb = movedTo(full.inspect.pdb, dirname(documented.inputs.path));
    expect(documented).toEqual({
      ...full,
      inputs: { ...full.inputs, path: documented.inputs.path },
      inspect: {
        ...full.inspect,
        path: documented.inspect.path,
        pdb,
      },
      solution: {
        ...full.solution,
        projects: full.solution.projects.map((project) => ({
          ...project,
          assemblyPath: documented.inputs.path,
          pdb,
        })),
      },
      build: full.build && {
        ...full.build,
        output: documented.build?.output,
      },
      timings: documented.timings,
    });
    expect(Object.keys(documented)).toEqual(Object.keys(full));
    expect(Object.keys(documented.timings)).toEqual(Object.keys(full.timings));
  });

  it("gives, as its Partial example, the reasons xray writes for the missing-reference Fixture", () => {
    const [, example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // The example stops, with "…", after the reasons.
    const documented = JSON.parse(
      (example as string).replace(/,\n {2}…\n\}$/, "\n}"),
    ) as Partial<XrayReport>;

    expect(documented).toEqual({
      schemaVersion: partial.schemaVersion,
      outcome: partial.outcome,
      reasons: partial.reasons,
    });
  });

  it("gives, as its Sibling Assemblies example, the projects xray writes for the multi-assembly Fixture", () => {
    const [, , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    const documented = JSON.parse(
      example as string,
    ) as XrayReport["solution"]["projects"];

    expect(multi.inputs.options.siblings).toBe(true);
    // Only the folder the Assemblies, and their PDBs, are in differs.
    expect(documented).toEqual(
      multi.solution.projects.map((project, i) => {
        const assemblyPath = documented[i]?.assemblyPath ?? "";
        return {
          ...project,
          assemblyPath,
          pdb: movedTo(project.pdb, dirname(assemblyPath)),
        };
      }),
    );
    expect(
      documented.map(({ assemblyPath }) => basename(assemblyPath)),
    ).toEqual(
      multi.solution.projects.map(({ assemblyPath }) => basename(assemblyPath)),
    );
  });

  it("gives, as its cycle example, what xray writes for the cyclic-reference Fixture", () => {
    const [, , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();

    expect(cyclic.outcome).toBe("partial");
    expect(JSON.parse(example as string)).toEqual(cyclic.siblingProblems);
  });

  it("gives, as its --run example, the run xray writes for the arithmetic Fixture", () => {
    const [, , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();

    expect(ran.inputs.options.run).toBe(true);
    // Windows ends the line it prints with \r\n.
    expect(JSON.parse(example as string)).toEqual({
      ...ran.run,
      stderr: ran.run?.stderr?.replaceAll("\r\n", "\n"),
    });
  });

  it("gives, as its NuGet example, the packages xray writes for the nuget-dependencies Fixture", () => {
    const [, , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // Only the folder the Assembly is in differs.
    const folder = dirname(nuget.inputs.path);
    expect(exampleIn(example as string, folder)).toEqual(nuget.packages);
    expect(nuget.solution.projects[0]?.packageReferences).toEqual([
      { id: "Newtonsoft.Json", version: "13.0.3" },
      { id: "Serilog", version: "3.1.1" },
    ]);
  });

  it("gives, as its copied binary example, the dependencies xray writes for the copied-binary Fixture", () => {
    const [, , , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // Only the folder the Assembly is in differs.
    const folder = dirname(copied.inputs.path);
    expect(exampleIn(example as string, folder)).toEqual(copied.dependencies);
    expect(copied.solution.projects[0]?.binaryReferences).toEqual([
      "Dependencies/Kestrelwood.Checksums.dll",
    ]);
  });

  it("gives, as its PDB example, the warnings xray writes for the arithmetic Fixture with another build's PDB", () => {
    const [, , , , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // Only the folder the Assembly is in differs.
    const folder = dirname(stale.inputs.path);
    expect(exampleIn(example as string, folder)).toEqual(stale.warnings);
    expect(stale.outcome).toBe("full");
    expect(stale.inspect.pdb).toMatchObject({ status: "mismatched" });
    expect(stale.solution.projects[0]?.pdb).toEqual(stale.inspect.pdb);
  });

  it("gives, as its obfuscation example, the warnings xray writes for the obfuscated Fixture", () => {
    const [, , , , , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // Only the folder the Assembly is in, and the type Obfuscar hides strings
    // in, named afresh by GUIDs each build, differ.
    const folder = dirname(obfuscated.inputs.path);
    const [decoders] =
      obfuscated.inspect.obfuscation.indicators.find(
        ({ kind }) => kind === "encrypted-strings",
      )?.evidence ?? [];
    expect(decoders).toMatch(/^<PrivateImplementationDetails>\{/);
    expect(
      exampleIn(
        (example as string).replaceAll(
          /<PrivateImplementationDetails>\{[0-9A-F-]+\}\.[0-9A-F-]+/g,
          decoders as string,
        ),
        folder,
      ),
    ).toEqual(obfuscated.warnings);
    expect(obfuscated.obfuscated).toBe(true);
    expect(obfuscated.outcome).toBe("partial");
    expect(obfuscated.solution.projects[0]?.obfuscation).toEqual(
      obfuscated.inspect.obfuscation,
    );
    expect(full.obfuscated).toBe(false);
  });

  it("gives, as its best-effort target framework example, the warnings xray writes for the net35-library Fixture", () => {
    const [, , , , , , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    // Only the folder the Assemblies are in differs.
    const folder = dirname(net35.inputs.path);
    expect(exampleIn(example as string, folder)).toEqual(net35.warnings);
    expect(net35.outcome).toBe("full");
    expect(net35.solution.projects.map((p) => p.targetFramework)).toEqual([
      "net8.0",
      "net35",
    ]);
  });

  it("gives, as its resources example, the resources xray writes for the resources Fixture", () => {
    const [, , , , , , , , , , example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();

    expect(JSON.parse(example as string)).toEqual(
      resources.solution.projects[0]?.resources,
    );
    expect(resources.outcome).toBe("full");
    expect(resources.warnings.map(({ kind }) => kind)).toEqual([
      "resource-kept-as-is",
    ]);
  });

  it("gives, as reasons[].dependencies, each Unresolved Dependency exactly as dependencies gives it", () => {
    const [unresolved] = partial.reasons;

    expect(unresolved?.kind).toBe("unresolved-dependencies");
    expect(
      unresolved?.kind === "unresolved-dependencies" && unresolved.dependencies,
    ).toEqual(
      partial.dependencies.filter(
        ({ resolution }) => resolution === "unresolved",
      ),
    );
  });

  it("documents every field xray writes, and no others, in the order it writes them", () => {
    const documented = documentedFields(section("Fields"));
    const reports = [
      partial,
      full,
      ran,
      multi,
      cyclic,
      duplicated,
      nuget,
      copied,
      stale,
      obfuscated,
      net35,
      resources,
    ];
    expect(duplicated.siblingProblems.map(({ kind }) => kind)).toEqual([
      "duplicate-assembly-name",
    ]);

    expect(documented.toSorted()).toEqual(
      [...new Set(reports.flatMap((report) => fieldsOf(report)))].toSorted(),
    );
    for (const report of reports) {
      const written = fieldsOf(report);
      expect(documented.filter((field) => written.includes(field))).toEqual(
        written,
      );
    }
  });

  it("documents every field of a diagnostic", () => {
    const diagnostics = partial.build?.diagnostics ?? [];
    expect(diagnostics.length).toBeGreaterThan(0);

    expect(documentedFields(section("Diagnostics"))).toEqual(
      fieldsOf(diagnostics).map((field) => field.replace(/^\[\]\./, "")),
    );
  });

  it("gives, as inspect, what `xray inspect --json` prints, without its schemaVersion", () => {
    const { schemaVersion, ...summary } = inspected;

    expect(schemaVersion).toBe(1);
    expect(full.inspect).toEqual(summary);
    expect(Object.keys(full.inspect)).toEqual(Object.keys(summary));
  });
});
