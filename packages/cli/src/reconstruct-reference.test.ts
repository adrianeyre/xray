import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ExitCode } from "./main.js";

// Holds the `xray reconstruct` reference's exit codes to the ones the CLI
// returns, so the documented table cannot drift from them. What each code
// means is tested against the binary in xray.test.ts.

const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-reconstruct.md", import.meta.url),
);

describe("the xray reconstruct reference", () => {
  it("documents every exit code, and only those", async () => {
    const reference = await readFile(REFERENCE, "utf8");
    const table = reference.slice(reference.indexOf("## Exit codes"));
    const documented = [...table.matchAll(/^\| (\d+) \|/gm)].map((match) =>
      Number(match[1]),
    );

    expect(documented).toEqual(
      Object.values(ExitCode).toSorted((a, b) => a - b),
    );
  });
});
