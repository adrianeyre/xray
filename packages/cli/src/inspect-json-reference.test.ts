import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildFixture } from "@xray/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Holds the `xray inspect --json` reference to what the binary really prints,
// so the documented schema cannot drift from it.

const XRAY = fileURLToPath(new URL("../bin/xray.js", import.meta.url));
const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-inspect-json.md", import.meta.url),
);

let reference: string;
let printed: Record<string, unknown>;
/** As {@link printed}, for the arithmetic Fixture with another build's PDB beside it. */
let mismatched: Record<string, unknown>;
/** As {@link printed}, for the obfuscated Fixture. */
let obfuscated: Record<string, unknown>;
const temporary: string[] = [];
beforeAll(async () => {
  reference = await readFile(REFERENCE, "utf8");
  const { assemblyPath } = await buildFixture("arithmetic");
  printed = await inspectJson(assemblyPath);
  const { assemblyPath: other } = await buildFixture("copied-binary");
  const folder = await mkdtemp(join(tmpdir(), "xray-inspect-"));
  temporary.push(folder);
  await copyFile(assemblyPath, join(folder, "Arithmetic.dll"));
  await copyFile(
    other.replace(/\.dll$/, ".pdb"),
    join(folder, "Arithmetic.pdb"),
  );
  mismatched = await inspectJson(join(folder, "Arithmetic.dll"));
  obfuscated = await inspectJson(
    (await buildFixture("obfuscated")).assemblyPath,
  );
}, 5 * 60_000);
afterAll(async () => {
  await Promise.all(
    temporary.map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function inspectJson(path: string): Promise<Record<string, unknown>> {
  const { stdout } = await promisify(execFile)(process.execPath, [
    XRAY,
    "inspect",
    "--json",
    path,
  ]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

/** The text of the reference's section headed `## heading`. */
function section(heading: string): string {
  const start = reference.indexOf(`\n## ${heading}\n`);
  expect(start, `the reference has a "## ${heading}" section`).not.toBe(-1);
  const end = reference.indexOf("\n## ", start + 1);
  return reference.slice(start, end === -1 ? undefined : end);
}

/** Every field of a document, as the reference writes them: `a.b`, `list[].c`. */
function fieldsOf(value: unknown, prefix = ""): string[] {
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

describe("docs/reference/xray-inspect-json.md", () => {
  it("documents the schema version xray prints", () => {
    expect(section("Stability")).toContain(
      `\`schemaVersion\` is \`${String(printed["schemaVersion"])}\``,
    );
  });

  it("gives, as its example, what xray prints for the arithmetic Fixture", () => {
    const [, example] =
      /```json\n([\s\S]*?)\n```/.exec(section("Example")) ?? [];
    expect(example).toBeDefined();
    const documented = JSON.parse(example as string) as Record<string, unknown>;

    // Only the paths depend on where the Fixture was built.
    expect(documented).toEqual({
      ...printed,
      path: documented["path"],
      pdb: {
        ...(printed["pdb"] as object),
        path: (documented["pdb"] as Record<string, unknown>)["path"],
      },
    });
    expect(Object.keys(documented)).toEqual(Object.keys(printed));
  });

  it("documents every field xray prints, and no others", () => {
    const documented = [
      ...section("Fields").matchAll(/^\| `([^`]+)` \|/gm),
    ].map(([, field]) => field);

    // A PDB that is not used says why, as its own does not; only an
    // obfuscated Assembly has signs of obfuscation to give.
    expect(documented).toEqual([
      ...new Set([
        ...fieldsOf(mismatched),
        ...fieldsOf(printed),
        ...fieldsOf(obfuscated),
      ]),
    ]);
    expect(mismatched["pdb"]).toMatchObject({ status: "mismatched" });
    expect(obfuscated["obfuscation"]).toMatchObject({ status: "obfuscated" });
  });

  it("gives, as its obfuscation example, what xray prints of the obfuscated Fixture's obfuscation", () => {
    const [, example] = [
      ...section("Example").matchAll(/```json\n([\s\S]*?)\n```/g),
    ].map(([, json]) => json);
    expect(example).toBeDefined();
    const printedObfuscation = obfuscated["obfuscation"] as {
      readonly indicators: readonly { readonly evidence: readonly string[] }[];
    };
    // Only the type Obfuscar hides strings in is named afresh, by GUIDs, each build.
    const [decoders] = printedObfuscation.indicators[1]?.evidence ?? [];
    expect(decoders).toMatch(/^<PrivateImplementationDetails>\{/);

    expect(
      JSON.parse(
        (example as string).replaceAll(
          /<PrivateImplementationDetails>\{[0-9A-F-]+\}\.[0-9A-F-]+/g,
          decoders as string,
        ),
      ),
    ).toEqual({ obfuscation: printedObfuscation });
  });
});
