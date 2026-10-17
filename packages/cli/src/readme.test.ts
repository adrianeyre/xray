import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ExitCode, USAGE } from "./main.js";

// Holds the README's usage docs to the CLI: its exit codes to the ones the CLI
// returns, and its options for `xray reconstruct` to the ones the usage gives.

const README = fileURLToPath(new URL("../../../README.md", import.meta.url));

/** The first cell of each row of the first table after `heading`. */
async function firstColumn(heading: string): Promise<string[]> {
  const readme = await readFile(README, "utf8");
  const start = readme.indexOf(`\n${heading}\n`);
  expect(start, `the README has a "${heading}" section`).not.toBe(-1);
  const [table = ""] =
    /(?:^\|.*\|\n)+/m.exec(readme.slice(start)) ?? ([] as string[]);
  return table
    .split("\n")
    .slice(2)
    .filter((row) => row !== "")
    .map((row) => (row.split("|")[1] ?? "").trim());
}

describe("the README", () => {
  it("documents every exit code, and only those", async () => {
    expect((await firstColumn("### Exit codes")).map(Number)).toEqual(
      Object.values(ExitCode).toSorted((a, b) => a - b),
    );
  });

  it("documents every option of xray reconstruct the usage gives, and only those", async () => {
    const [synopsis = ""] = /^ {2}reconstruct .*$/m.exec(USAGE) ?? [];
    const given = [...synopsis.matchAll(/(?<=[\s[])(-{1,2}[\w-]+)/g)].map(
      ([option]) => option,
    );
    const documented = (
      await firstColumn("### Reconstruct an application")
    ).flatMap((cell) => [...cell.matchAll(/(?<=[`\s])(-{1,2}[\w-]+)/g)]);

    expect(given).toEqual([
      "-o",
      "--force",
      "--no-build",
      "--run",
      "--no-siblings",
      "--offline",
    ]);
    expect(documented.map(([option]) => option)).toEqual([
      "-o",
      "--output",
      ...given.slice(1),
    ]);
  });
});
