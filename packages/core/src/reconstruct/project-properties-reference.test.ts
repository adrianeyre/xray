import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  projectFile,
  RECOVERED_LANGUAGE_VERSION,
  recoverRootNamespace,
} from "./recovered-solution.js";

// Holds what the `xray reconstruct` reference says about the project's
// properties to the project Xray writes.

const REFERENCE = fileURLToPath(
  new URL("../../../../docs/reference/xray-reconstruct.md", import.meta.url),
);

let section: string;
beforeAll(async () => {
  const reference = await readFile(REFERENCE, "utf8");
  section = reference.slice(
    reference.indexOf("## The Recovered Solution"),
    reference.indexOf("## Build diagnostics"),
  );
});

/** The rows of the table of properties below its header, as [property, value]. */
function rows(): [string, string][] {
  const start = section.indexOf("  | Property | Value |");
  const table = section.slice(start, section.indexOf("\n\n", start));
  return [...table.matchAll(/^ {2}\| `<(\w+)>` \| (.+) \|$/gm)].map((match) => [
    match[1] as string,
    match[2] as string,
  ]);
}

describe("the xray reconstruct reference", () => {
  it("lists every property the project sets, in its order, when the original has them all", () => {
    const project = projectFile({
      assemblyName: "Shop",
      rootNamespace: "Retail.Shop",
      targetFramework: "net8.0-windows7.0",
      outputType: "WinExe",
      useWindowsForms: true,
      useWpf: true,
      allowUnsafeBlocks: true,
      nullable: "annotations",
    });
    const group = project.slice(
      project.indexOf("<PropertyGroup>"),
      project.indexOf("</PropertyGroup>"),
    );
    const written = [...group.matchAll(/^ {4}<(\w+)>/gm)].map(
      (match) => match[1],
    );

    expect(rows().map(([property]) => property)).toEqual(written);
  });

  it("gives the values the project sets", () => {
    const values = new Map(rows());

    expect(values.get("LangVersion")).toMatch(
      new RegExp(`^\`${RECOVERED_LANGUAGE_VERSION.replace(".", "\\.")}\``),
    );
    expect(values.get("AllowUnsafeBlocks")).toMatch(/^`true` if /);
    expect(values.get("Nullable")).toMatch(/^`annotations` if /);
    expect(values.get("GenerateAssemblyInfo")).toMatch(/^`false`/);
    expect(values.get("UseWindowsForms")).toMatch(/^`true` if /);
    expect(values.get("UseWPF")).toMatch(/^`true` if /);
    expect(values.get("EnableWindowsTargeting")).toMatch(/^`true` for /);
  });

  it("gives the unsafe-nullable Fixture's root namespace as Xray tells it", () => {
    expect(section).toContain(
      "its root namespace is `Fixtures.Pointers` and `Fixtures.Pointers.Text.Directory` is in `Xray.UnsafeNullable/Text/Directory.cs`",
    );
    expect(
      recoverRootNamespace("Xray.UnsafeNullable", [
        "Fixtures.Pointers",
        "Fixtures.Pointers.Text",
      ]),
    ).toBe("Fixtures.Pointers");
  });
});
