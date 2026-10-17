import type { ProgressEvent } from "@xray/core";
import { describe, expect, it } from "vitest";

import {
  formatProgressEvent,
  PLAIN_PROGRESS_INTERVAL_MS,
  progressDisplay,
} from "./format-progress.js";

/** What `progressDisplay` writes for `events`, on a terminal `columns` wide or none. */
function displayed(
  events: readonly ProgressEvent[],
  columns?: number,
): string[] {
  const written: string[] = [];
  const display = progressDisplay(
    (text) => written.push(text),
    () => columns,
  );
  events.forEach(display);
  return written;
}

/** A build that runs for `seconds`, reporting its progress every 250 ms. */
function building(seconds: number): ProgressEvent[] {
  const startedAt = 2_000;
  return [
    { kind: "stage-started", stage: "build", elapsedMs: startedAt },
    ...Array.from(
      { length: (seconds * 1_000) / 250 },
      (_, i): ProgressEvent => ({
        kind: "stage-progress",
        stage: "build",
        elapsedMs: startedAt + (i + 1) * 250,
        done: null,
        total: null,
        current: null,
      }),
    ),
    {
      kind: "stage-finished",
      stage: "build",
      elapsedMs: startedAt + seconds * 1_000 + 10,
      durationMs: seconds * 1_000 + 10,
    },
  ];
}

describe("formatProgressEvent", () => {
  it.each<[ProgressEvent, number, string]>([
    [
      { kind: "stage-started", stage: "analyse", elapsedMs: 0 },
      0,
      "[1/6] Analyse…",
    ],
    [
      {
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 4_300,
        done: 120,
        total: 2_000,
        current: "App.Models.Point`1",
      },
      4_200,
      "[2/6] Decompile: 120 of 2000 types (App.Models.Point`1), 4.2 s so far",
    ],
    [
      {
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 4_300,
        done: 5,
        total: 5,
        current: null,
      },
      4_200,
      "[2/6] Decompile: 5 of 5 types, 4.2 s so far",
    ],
    [
      {
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 300,
        done: 0,
        total: 1,
        current: "Arithmetic.Program",
      },
      250,
      "[2/6] Decompile: 0 of 1 type (Arithmetic.Program), 250 ms so far",
    ],
    [
      {
        kind: "stage-skipped",
        stage: "resolve-dependencies",
        elapsedMs: 900,
        reason: "Xray does not resolve dependencies yet.",
      },
      0,
      "[3/6] Resolve dependencies: skipped. Xray does not resolve dependencies yet.",
    ],
    [
      {
        kind: "stage-progress",
        stage: "resolve-dependencies",
        elapsedMs: 1_000,
        done: 1,
        total: 2,
        current: "Pricing.dll",
      },
      120,
      "[3/6] Resolve dependencies: 1 of 2 Sibling Assemblies (Pricing.dll), 120 ms so far",
    ],
    [
      {
        kind: "stage-progress",
        stage: "generate",
        elapsedMs: 950,
        done: 2,
        total: 4,
        current: "App/Program.cs",
      },
      30,
      "[4/6] Generate solution: 2 of 4 files (App/Program.cs), 30 ms so far",
    ],
    [
      {
        kind: "stage-progress",
        stage: "build",
        elapsedMs: 9_000,
        done: null,
        total: null,
        current: null,
      },
      8_000,
      "[5/6] Build: 8.0 s so far",
    ],
    [
      {
        kind: "stage-finished",
        stage: "build",
        elapsedMs: 9_900,
        durationMs: 8_912,
      },
      8_912,
      "[5/6] Build: done in 8.9 s",
    ],
    [
      {
        kind: "stage-failed",
        stage: "analyse",
        elapsedMs: 40,
        durationMs: 40,
        message: "There is no file.",
      },
      40,
      "[1/6] Analyse: failed after 40 ms",
    ],
  ])("formats %j", (event, stageMs, expected) => {
    expect(formatProgressEvent(event, stageMs)).toBe(expected);
  });
});

describe("progressDisplay", () => {
  it("writes a plain line as a stage starts and ends, and a progress line only every few seconds between", () => {
    expect(displayed(building(12))).toEqual([
      "[5/6] Build…\n",
      "[5/6] Build: 5.0 s so far\n",
      "[5/6] Build: 10.0 s so far\n",
      "[5/6] Build: done in 12.0 s\n",
    ]);
    expect(PLAIN_PROGRESS_INTERVAL_MS).toBe(5_000);
  });

  it("writes no progress line for a stage shorter than that", () => {
    expect(displayed(building(1))).toEqual([
      "[5/6] Build…\n",
      "[5/6] Build: done in 1.0 s\n",
    ]);
  });

  it("rewrites a terminal's line with every event, ending it as the stage ends", () => {
    const written = displayed(building(1), 80);

    expect(written).toHaveLength(1 + 4 + 1);
    expect(written.every((text) => text.startsWith("\r\x1b[2K"))).toBe(true);
    expect(written.slice(0, -1).some((text) => text.includes("\n"))).toBe(
      false,
    );
    expect(written[4]).toBe("\r\x1b[2K[5/6] Build: 1.0 s so far");
    expect(written.at(-1)).toBe("\r\x1b[2K[5/6] Build: done in 1.0 s\n");
  });

  it("cuts a running stage's line short of a terminal's width, so it never wraps", () => {
    const written = displayed(
      [
        { kind: "stage-started", stage: "decompile", elapsedMs: 0 },
        {
          kind: "stage-progress",
          stage: "decompile",
          elapsedMs: 250,
          done: 1,
          total: 2,
          current: "Some.Very.Long.Namespace.With.A.Very.Long.TypeName",
        },
      ],
      40,
    );

    expect(written[1]).toBe("\r\x1b[2K[2/6] Decompile: 1 of 2 types (Some.Ve…");
    expect((written[1] ?? "").length - "\r\x1b[2K".length).toBe(39);
  });

  it("leaves the line a stage ends with in full, however wide", () => {
    const reason =
      "Xray does not resolve dependencies yet, so every reference is left to the target framework.";

    expect(
      displayed(
        [
          {
            kind: "stage-skipped",
            stage: "resolve-dependencies",
            elapsedMs: 700,
            reason,
          },
        ],
        40,
      ),
    ).toEqual([`\r\x1b[2K[3/6] Resolve dependencies: skipped. ${reason}\n`]);
  });
});
