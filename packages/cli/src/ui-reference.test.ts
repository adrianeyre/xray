import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DEFAULT_PORT, SERVER_HOST } from "@xray/server";
import { describe, expect, it } from "vitest";

import { ExitCode } from "./main.js";

// Holds the `xray ui` reference to the address, port and exit codes the CLI
// and server use, so it cannot drift from them. What each does is tested
// against the server in @xray/server and the binary in xray-ui.test.ts.

const REFERENCE = fileURLToPath(
  new URL("../../../docs/reference/xray-ui.md", import.meta.url),
);

describe("the xray ui reference", () => {
  it("gives the address the server listens on, and its default port", async () => {
    const reference = await readFile(REFERENCE, "utf8");

    expect(reference).toContain(`listens on \`${SERVER_HOST}\``);
    expect(reference).toContain(`Xray listens on ${DEFAULT_PORT},`);
    expect(reference).toContain(
      `Xray is running at http://${SERVER_HOST}:${DEFAULT_PORT}/`,
    );
  });

  it("documents the exit codes xray ui returns", async () => {
    const reference = await readFile(REFERENCE, "utf8");
    const table = reference.slice(reference.indexOf("## Exit codes"));
    const documented = [...table.matchAll(/^\| (\d+) \|/gm)].map((match) =>
      Number(match[1]),
    );

    expect(documented).toEqual([ExitCode.ok, ExitCode.failed, ExitCode.usage]);
  });
});
