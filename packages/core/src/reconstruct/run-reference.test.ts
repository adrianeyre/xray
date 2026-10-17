import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_LAUNCH_MS,
  DEFAULT_RUN_TIMEOUT_MS,
  planRun,
  RUN_STATUSES,
  runFailed,
  type RunTarget,
} from "./run-program.js";

// Holds what the `xray reconstruct` reference says about --run to how core
// runs the rebuilt program: its statuses, which count against the
// Reconstruction, and why a program is skipped.

const REFERENCE = fileURLToPath(
  new URL("../../../../docs/reference/xray-reconstruct.md", import.meta.url),
);

let section: string;
beforeAll(async () => {
  const reference = await readFile(REFERENCE, "utf8");
  section = reference.slice(
    reference.indexOf("\n## Run\n"),
    reference.indexOf("\n## Outcome\n"),
  );
});

/** The cells of each row of the table whose header starts `| heading`, below its header. */
function table(heading: string): string[][] {
  const start = section.indexOf(`\n| ${heading}`);
  expect(start, `the Run section has a "${heading}" table`).not.toBe(-1);
  const end = section.indexOf("\n\n", start);
  return section
    .slice(start + 1, end === -1 ? undefined : end)
    .split("\n")
    .slice(2)
    .map((row) =>
      row
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim()),
    );
}

const target: RunTarget = {
  projectPath: "App/App.csproj",
  assemblyName: "App",
  targetFramework: "net8.0",
  outputKind: "console",
};
const built = { succeeded: true, output: "", diagnostics: [] };

describe("the xray reconstruct reference's Run section", () => {
  it("documents every way a run can go, and which count against the Reconstruction", () => {
    const rows = table("How it went");

    expect(
      rows.map(([status]) => /\(`([^`]+)`\)/.exec(status ?? "")?.[1]),
    ).toEqual([...RUN_STATUSES]);
    for (const [status, , counts] of rows) {
      const run = {
        status: /\(`([^`]+)`\)/.exec(status ?? "")?.[1],
      } as Parameters<typeof runFailed>[0];
      expect(counts?.startsWith(runFailed(run) ? "Yes" : "No"), status).toBe(
        true,
      );
    }
  });

  it("gives the times a program is allowed", () => {
    expect(DEFAULT_LAUNCH_MS).toBe(5_000);
    expect(DEFAULT_RUN_TIMEOUT_MS).toBe(60_000);
    expect(section).toContain("still running 5 seconds after it started");
    expect(section).toContain("still running after 60 seconds");
  });

  it("gives the reasons a program is skipped as Xray gives them", () => {
    const reasons = table("Program").map(([, reason]) =>
      (reason ?? "").replaceAll("`", ""),
    );

    expect(reasons).toEqual(
      [
        planRun({ ...target, outputKind: "winforms" }, built, "linux"),
        planRun({ ...target, targetFramework: "net48" }, built, "darwin"),
        planRun(
          { ...target, targetFramework: "net8.0-windows" },
          built,
          "linux",
        ),
        planRun({ ...target, outputKind: "library" }, built, "linux"),
        planRun(target, { ...built, succeeded: false }, "linux"),
      ].map((plan) => (plan.runnable ? "" : plan.reason)),
    );
  });
});
