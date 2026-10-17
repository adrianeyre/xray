import { describe, expect, it } from "vitest";

import { runDoctor } from "./doctor.js";

// Runs every real check: this Node.js, `dotnet --list-sdks`, and the real engine
// built by the global setup (../engine/build-engine.ts).

describe("runDoctor (on this machine)", () => {
  it("passes every check on a correctly set-up machine", async () => {
    const report = await runDoctor();

    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "node",
      "dotnet-sdk",
      "engine",
    ]);
  });
});
