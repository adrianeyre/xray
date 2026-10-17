import {
  STAGES,
  type InspectJson,
  type ProgressEvent,
  type ReconstructionEnd,
  type ReconstructionEvent,
  type Stage,
} from "./events.js";

export type StageStatus =
  /** It has not started, and may yet. */
  "waiting" | "running" | "finished" | "skipped" | "failed";

/** A stage of the pipeline, as far as the events so far tell. */
export interface StageView {
  readonly stage: Stage;
  readonly status: StageStatus;
  /** How many of its items are done, and of how many, while it runs; `null` if it does not count them. */
  readonly done: number | null;
  readonly total: number | null;
  /** What it is working on now, while it runs. */
  readonly current: string | null;
  /** When it started, in milliseconds since the Reconstruction did; `null` until it does. */
  readonly startedAtMs: number | null;
  /** How long it has run so far, or ran, in milliseconds; `null` until it starts. */
  readonly ms: number | null;
  /** Why it was skipped, or what went wrong when it failed. */
  readonly note: string | null;
}

/** A Reconstruction, as far as the events so far tell. */
export interface ReconstructionView {
  /** The Assembly, once the stream says. */
  readonly path: string | null;
  /** Every stage, in the order they run. */
  readonly stages: readonly StageView[];
  /** The Assembly's metadata summary, once `analyse` has read it; only a Managed Assembly has one. */
  readonly inspection: InspectJson | null;
  /** How it ended; `null` while it runs. */
  readonly end: ReconstructionEnd | null;
}

/** A Reconstruction no event has been heard of yet. */
export function emptyView(): ReconstructionView {
  return {
    path: null,
    stages: STAGES.map((stage) => ({
      stage,
      status: "waiting",
      done: null,
      total: null,
      current: null,
      startedAtMs: null,
      ms: null,
      note: null,
    })),
    inspection: null,
    end: null,
  };
}

/** `view`, with one more event of its stream heard. */
export function applyEvent(
  view: ReconstructionView,
  event: ReconstructionEvent,
): ReconstructionView {
  switch (event.type) {
    case "started":
      return { ...view, path: event.data.path };
    case "progress":
      return applyProgress(view, event.data);
    case "inspected":
      return { ...view, inspection: event.data };
    case "ended":
      return { ...view, end: event.data };
    default:
      // New kinds of event may be added; this app does not know them.
      return view;
  }
}

function applyProgress(
  view: ReconstructionView,
  event: ProgressEvent,
): ReconstructionView {
  if (!view.stages.some((stage) => stage.stage === event.stage)) {
    // A stage this app does not know: treated as "other", and not shown.
    return view;
  }
  return {
    ...view,
    stages: view.stages.map((stage) =>
      stage.stage === event.stage ? applyToStage(stage, event) : stage,
    ),
  };
}

function applyToStage(stage: StageView, event: ProgressEvent): StageView {
  switch (event.kind) {
    case "stage-started":
      return {
        ...stage,
        status: "running",
        done: null,
        total: null,
        current: null,
        startedAtMs: event.elapsedMs,
        ms: 0,
        note: null,
      };
    case "stage-progress":
      return {
        ...stage,
        status: "running",
        done: event.done,
        total: event.total,
        current: event.current,
        ms: event.elapsedMs - (stage.startedAtMs ?? event.elapsedMs),
      };
    case "stage-finished":
      return {
        ...stage,
        status: "finished",
        current: null,
        ms: event.durationMs,
      };
    case "stage-skipped":
      return { ...stage, status: "skipped", note: event.reason };
    case "stage-failed":
      return {
        ...stage,
        status: "failed",
        current: null,
        ms: event.durationMs,
        note: event.message,
      };
    default:
      // New kinds of progress event may be added; this app does not know them.
      return stage;
  }
}
