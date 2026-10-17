import { describe, expect, it } from "vitest";

import {
  STAGES,
  type ProgressEvent,
  type ReconstructionEvent,
} from "./events.js";
import {
  applyEvent,
  emptyView,
  type ReconstructionView,
} from "./reconstruction-view.js";
import { ARITHMETIC } from "./test-inspection.js";

function progress(data: ProgressEvent): ReconstructionEvent {
  return { type: "progress", data };
}

function viewOf(events: readonly ReconstructionEvent[]): ReconstructionView {
  return events.reduce(applyEvent, emptyView());
}

describe("the view of a Reconstruction", () => {
  it("starts with every stage waiting, in the order they run", () => {
    const view = emptyView();

    expect(view.path).toBeNull();
    expect(view.end).toBeNull();
    expect(view.stages.map((stage) => [stage.stage, stage.status])).toEqual(
      STAGES.map((stage) => [stage, "waiting"]),
    );
  });

  it("knows the Assembly once the stream says", () => {
    expect(
      viewOf([{ type: "started", data: { path: "/apps/App.dll" } }]).path,
    ).toBe("/apps/App.dll");
  });

  it("shows a running stage's count, what it is on, and how long it has run", () => {
    const view = viewOf([
      progress({ kind: "stage-started", stage: "decompile", elapsedMs: 100 }),
      progress({
        kind: "stage-progress",
        stage: "decompile",
        elapsedMs: 350,
        done: 2,
        total: 5,
        current: "App.Models.Point",
      }),
    ]);

    expect(view.stages[1]).toEqual({
      stage: "decompile",
      status: "running",
      done: 2,
      total: 5,
      current: "App.Models.Point",
      startedAtMs: 100,
      ms: 250,
      note: null,
    });
  });

  it("shows how long a finished stage took, why one was skipped, and what went wrong with one that failed", () => {
    const view = viewOf([
      progress({ kind: "stage-started", stage: "analyse", elapsedMs: 0 }),
      progress({
        kind: "stage-finished",
        stage: "analyse",
        elapsedMs: 90,
        durationMs: 90,
      }),
      progress({
        kind: "stage-skipped",
        stage: "resolve-dependencies",
        elapsedMs: 90,
        reason: "Not yet.",
      }),
      progress({ kind: "stage-started", stage: "build", elapsedMs: 100 }),
      progress({
        kind: "stage-failed",
        stage: "build",
        elapsedMs: 600,
        durationMs: 500,
        message: "Could not run dotnet.",
      }),
    ]);

    expect(
      view.stages.map((stage) => [stage.status, stage.ms, stage.note]),
    ).toEqual([
      ["finished", 90, null],
      ["waiting", null, null],
      ["skipped", null, "Not yet."],
      ["waiting", null, null],
      ["failed", 500, "Could not run dotnet."],
      ["waiting", null, null],
    ]);
  });

  it("knows the Assembly's metadata summary once analyse has read it", () => {
    expect(emptyView().inspection).toBeNull();
    expect(
      viewOf([
        { type: "started", data: { path: ARITHMETIC.path } },
        { type: "inspected", data: ARITHMETIC },
      ]).inspection,
    ).toEqual(ARITHMETIC);
  });

  it("knows how it ended", () => {
    const end = {
      kind: "failed",
      code: "not-found",
      message: "There is no file at /apps/App.dll.",
    } as const;

    expect(viewOf([{ type: "ended", data: end }]).end).toEqual(end);
  });

  it("ignores events, kinds and stages it does not know, as new ones may be added", () => {
    const before = viewOf([
      progress({ kind: "stage-started", stage: "analyse", elapsedMs: 0 }),
    ]);

    for (const event of [
      { type: "rewound", data: {} },
      {
        type: "progress",
        data: { kind: "stage-paused", stage: "analyse", elapsedMs: 5 },
      },
      {
        type: "progress",
        data: { kind: "stage-started", stage: "sign", elapsedMs: 5 },
      },
    ]) {
      expect(
        applyEvent(before, event as unknown as ReconstructionEvent),
      ).toEqual(before);
    }
  });
});
