import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROGRESS_INTERVAL_MS,
  StageTracker,
  type ProgressEvent,
} from "./progress.js";

// The clock and the ticker both run on Vitest's fake timers, so time only
// passes when a test advances it.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function tracked(intervalMs?: number): {
  stages: StageTracker;
  events: ProgressEvent[];
} {
  const events: ProgressEvent[] = [];
  const stages = new StageTracker((event) => events.push(event), {
    now: () => Date.now(),
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });
  return { stages, events };
}

describe("StageTracker", () => {
  it("reports a stage's start, its progress every interval while it runs, and its finish", () => {
    const { stages, events } = tracked();
    vi.advanceTimersByTime(40);

    stages.start("decompile");
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    stages.progress({ done: 0, total: 2, current: "App.Program" });
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    stages.progress({ done: 1, total: 2, current: "App.Models.Point`1" });
    vi.advanceTimersByTime(100);
    const duration = stages.finish();
    vi.advanceTimersByTime(10 * PROGRESS_INTERVAL_MS);

    expect(duration).toBe(2 * PROGRESS_INTERVAL_MS + 100);
    expect(events).toEqual([
      { kind: "stage-started", stage: "decompile", elapsedMs: 40 },
      {
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 40 + PROGRESS_INTERVAL_MS,
        done: null,
        total: null,
        current: null,
      },
      {
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 40 + 2 * PROGRESS_INTERVAL_MS,
        done: 0,
        total: 2,
        current: "App.Program",
      },
      {
        kind: "stage-finished",
        stage: "decompile",
        elapsedMs: 40 + duration,
        durationMs: duration,
      },
    ]);
  });

  it("reports progress at least once a second however long a stage runs without moving on", () => {
    const { stages, events } = tracked();

    stages.start("build");
    vi.advanceTimersByTime(60_000);
    stages.finish();

    const times = events.map((event) => event.elapsedMs);
    const gaps = times.slice(1).map((time, i) => time - (times[i] ?? 0));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(PROGRESS_INTERVAL_MS);
    expect(PROGRESS_INTERVAL_MS).toBeLessThan(1_000);
    expect(events).toHaveLength(2 + 60_000 / PROGRESS_INTERVAL_MS);
  });

  it("starts each stage's progress afresh", () => {
    const { stages, events } = tracked(100);

    stages.start("generate");
    stages.progress({ done: 3, total: 4, current: "App/App.csproj" });
    stages.finish();
    stages.start("build");
    vi.advanceTimersByTime(100);

    expect(events.at(-1)).toMatchObject({
      kind: "stage-progress",
      stage: "build",
      done: null,
      total: null,
      current: null,
    });
    stages.finish();
  });

  it("reports a stage that does not run, and why", () => {
    const { stages, events } = tracked();
    vi.advanceTimersByTime(7);

    stages.skip("build", "Building was skipped.");

    expect(events).toEqual([
      {
        kind: "stage-skipped",
        stage: "build",
        elapsedMs: 7,
        reason: "Building was skipped.",
      },
    ]);
  });

  it("fails the running stage with the error's message, and stops reporting its progress", () => {
    const { stages, events } = tracked();
    stages.start("analyse");
    vi.advanceTimersByTime(30);

    stages.fail(new Error("There is no file at /abs/missing.dll."));
    vi.advanceTimersByTime(10 * PROGRESS_INTERVAL_MS);

    expect(events).toEqual([
      { kind: "stage-started", stage: "analyse", elapsedMs: 0 },
      {
        kind: "stage-failed",
        stage: "analyse",
        elapsedMs: 30,
        durationMs: 30,
        message: "There is no file at /abs/missing.dll.",
      },
    ]);
  });

  it("reports nothing on a failure between stages", () => {
    const { stages, events } = tracked();
    stages.start("analyse");
    stages.finish();

    stages.fail(new Error("boom"));

    expect(events.map((event) => event.kind)).toEqual([
      "stage-started",
      "stage-finished",
    ]);
  });

  it("runs one stage at a time", () => {
    const { stages } = tracked();
    stages.start("analyse");

    expect(() => stages.start("decompile")).toThrow(
      'Cannot start "decompile" while "analyse" is running.',
    );
    stages.finish();
    expect(() => stages.finish()).toThrow(
      "There is no stage running to finish.",
    );
  });

  it("only times the stages without a listener, setting no timer", () => {
    const stages = new StageTracker(undefined, { now: () => Date.now() });

    stages.start("build");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_234);

    expect(stages.finish()).toBe(1_234);
    expect(stages.elapsed()).toBe(1_234);
  });

  it("gives events that are plain JSON, for the server to stream as they are", () => {
    const { stages, events } = tracked();
    stages.start("decompile");
    stages.progress({ done: 1, total: 2, current: "App.Program" });
    vi.advanceTimersByTime(PROGRESS_INTERVAL_MS);
    stages.fail(new Error("boom"));
    stages.skip("build", "Not built.");

    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });
});
