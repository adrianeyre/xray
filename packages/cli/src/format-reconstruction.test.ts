import { describe, expect, it } from "vitest";

import { formatDuration, formatTimings } from "./format-reconstruction.js";

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [999, "999 ms"],
    [1_000, "1.0 s"],
    [1_249, "1.2 s"],
    [61_500, "61.5 s"],
  ])("gives %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatTimings", () => {
  it("gives the total, then each stage", () => {
    expect(
      formatTimings({
        analyse: 120,
        decompile: 2_340,
        resolveDependencies: 15,
        generate: 4,
        build: 5_600,
        run: null,
        total: 8_064,
      }),
    ).toBe(
      "8.1 s: analyse 120 ms, decompile 2.3 s, resolve dependencies 15 ms, generate 4 ms, build 5.6 s",
    );
  });

  it("gives the run of the rebuilt program after the build", () => {
    expect(
      formatTimings({
        analyse: 120,
        decompile: 2_340,
        resolveDependencies: 15,
        generate: 4,
        build: 5_600,
        run: 85,
        total: 8_149,
      }),
    ).toBe(
      "8.1 s: analyse 120 ms, decompile 2.3 s, resolve dependencies 15 ms, generate 4 ms, build 5.6 s, run 85 ms",
    );
  });

  it("leaves out Dependency Resolution and a build that were skipped", () => {
    expect(
      formatTimings({
        analyse: 120,
        decompile: 340,
        resolveDependencies: null,
        generate: 4,
        build: null,
        run: null,
        total: 464,
      }),
    ).toBe("464 ms: analyse 120 ms, decompile 340 ms, generate 4 ms");
  });
});
