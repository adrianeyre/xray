// The progress a Reconstruction reports as it runs (PRD §7.3, FR-19): plain
// JSON-serializable events, for the CLI to render and the server to stream
// unchanged. Their shape is docs/reference/progress-events.md.

/** The stages of a Reconstruction, in the order they run. */
export const RECONSTRUCTION_STAGES = [
  "analyse",
  "decompile",
  "resolve-dependencies",
  "generate",
  "build",
  "run",
] as const;

export type ReconstructionStage = (typeof RECONSTRUCTION_STAGES)[number];

/**
 * How often a running stage reports its progress, whether or not it has
 * moved on: well within the second FR-19 allows between updates.
 */
export const PROGRESS_INTERVAL_MS = 250;

/**
 * One step in a Reconstruction's progress. Every event names its stage and
 * the whole milliseconds since the Reconstruction started. A stage that runs
 * is `stage-started`, then `stage-progress` every {@link PROGRESS_INTERVAL_MS}
 * while it runs, then `stage-finished` or `stage-failed`; a stage that does
 * not run is `stage-skipped`, with why.
 */
export type ProgressEvent =
  | {
      readonly kind: "stage-started";
      readonly stage: ReconstructionStage;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "stage-progress";
      readonly stage: ReconstructionStage;
      readonly elapsedMs: number;
      /** How many of the stage's items are done; `null` if it does not count them. */
      readonly done: number | null;
      /** How many items the stage has; `null` if it does not count them, or does not know yet. */
      readonly total: number | null;
      /** What it is working on now (the type being decompiled, the file being written, the program being run); `null` if it does not say. */
      readonly current: string | null;
    }
  | {
      readonly kind: "stage-finished";
      readonly stage: ReconstructionStage;
      readonly elapsedMs: number;
      /** How long the stage took, as `timings` in `xray-report.json` gives it. */
      readonly durationMs: number;
    }
  | {
      readonly kind: "stage-skipped";
      readonly stage: ReconstructionStage;
      readonly elapsedMs: number;
      readonly reason: string;
    }
  | {
      readonly kind: "stage-failed";
      readonly stage: ReconstructionStage;
      readonly elapsedMs: number;
      readonly durationMs: number;
      /** What went wrong: the message of the error the Reconstruction rejects with. */
      readonly message: string;
    };

/** Told of each {@link ProgressEvent} as it happens. It must not throw. */
export type ProgressListener = (event: ProgressEvent) => void;

/** What a running stage has got to, as `stage-progress` reports it. */
export interface StageProgress {
  readonly done: number | null;
  readonly total: number | null;
  readonly current: string | null;
}

interface RunningStage extends StageProgress {
  readonly stage: ReconstructionStage;
  readonly startedAt: number;
  readonly ticker: NodeJS.Timeout | undefined;
}

const NO_PROGRESS: StageProgress = { done: null, total: null, current: null };

/**
 * Times a Reconstruction's stages, one at a time, telling a listener of each
 * as a {@link ProgressEvent}. Without a listener it only times them.
 */
export class StageTracker {
  readonly #listener: ProgressListener | undefined;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #startedAt: number;
  #running: RunningStage | undefined;

  constructor(
    listener: ProgressListener | undefined,
    {
      intervalMs = PROGRESS_INTERVAL_MS,
      now = () => performance.now(),
    }: { readonly intervalMs?: number; readonly now?: () => number } = {},
  ) {
    this.#listener = listener;
    this.#intervalMs = intervalMs;
    this.#now = now;
    this.#startedAt = now();
  }

  /** The whole milliseconds since the tracker was made. */
  elapsed(): number {
    return Math.round(this.#now() - this.#startedAt);
  }

  /** Starts `stage`, which must be the only one running. */
  start(stage: ReconstructionStage): void {
    if (this.#running !== undefined) {
      throw new Error(
        `Cannot start "${stage}" while "${this.#running.stage}" is running.`,
      );
    }
    const ticker =
      this.#listener === undefined
        ? undefined
        : setInterval(() => this.#tick(), this.#intervalMs);
    // Progress alone must not keep the process alive.
    ticker?.unref();
    this.#running = { stage, startedAt: this.#now(), ticker, ...NO_PROGRESS };
    this.#emit({ kind: "stage-started", stage, elapsedMs: this.elapsed() });
  }

  /** Records how far the running stage has got, for its next `stage-progress`. */
  progress(progress: StageProgress): void {
    if (this.#running !== undefined) {
      this.#running = { ...this.#running, ...progress };
    }
  }

  /** Finishes the running stage, resolving how long it took in whole milliseconds. */
  finish(): number {
    const { stage, durationMs } = this.#stop("finish");
    this.#emit({
      kind: "stage-finished",
      stage,
      elapsedMs: this.elapsed(),
      durationMs,
    });
    return durationMs;
  }

  /** Records that `stage` does not run, and why. */
  skip(stage: ReconstructionStage, reason: string): void {
    this.#emit({
      kind: "stage-skipped",
      stage,
      elapsedMs: this.elapsed(),
      reason,
    });
  }

  /** Fails the running stage, if there is one, with the error that stopped it. */
  fail(error: unknown): void {
    if (this.#running === undefined) {
      return;
    }
    const { stage, durationMs } = this.#stop("fail");
    this.#emit({
      kind: "stage-failed",
      stage,
      elapsedMs: this.elapsed(),
      durationMs,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  #stop(action: string): {
    stage: ReconstructionStage;
    durationMs: number;
  } {
    const running = this.#running;
    if (running === undefined) {
      throw new Error(`There is no stage running to ${action}.`);
    }
    clearInterval(running.ticker);
    this.#running = undefined;
    return {
      stage: running.stage,
      durationMs: Math.round(this.#now() - running.startedAt),
    };
  }

  #tick(): void {
    if (this.#running === undefined) {
      return;
    }
    const { stage, done, total, current } = this.#running;
    this.#emit({
      kind: "stage-progress",
      stage,
      elapsedMs: this.elapsed(),
      done,
      total,
      current,
    });
  }

  #emit(event: ProgressEvent): void {
    this.#listener?.(event);
  }
}
