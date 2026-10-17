import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  EngineError,
  InputError,
  ReconstructionError,
  toInspectJson,
  toXrayReport,
  type InputKind,
  type InspectJson,
  type ProgressEvent,
  type Reconstruction,
  type ReconstructOptions,
  type XrayReport,
} from "@xray/core";

/** Runs a Reconstruction, as @xray/core's `reconstruct` does; replaced in tests. */
export type Reconstruct = (
  path: string,
  outputDirectory: string,
  options: ReconstructOptions,
) => Promise<Reconstruction>;

/** How a Reconstruction the server ran ended: the last event of its stream. */
export type ReconstructionEnd =
  | {
      /** It wrote a Recovered Solution, whatever its outcome. */
      readonly kind: "reconstructed";
      /** Where, in the session's Workspace. */
      readonly directory: string;
      /** The `xray-report.json` it wrote there. */
      readonly report: XrayReport;
    }
  | {
      /** The input is not a Managed Assembly, so it cannot be reconstructed (ADR 0002). */
      readonly kind: "rejected";
      readonly inputKind: InputKind;
      /** What the input is, and why Xray cannot reconstruct it. */
      readonly explanation: string;
    }
  | {
      /** It could not start or finish. */
      readonly kind: "failed";
      /** The code of the error it failed with, such as `not-found`; `null` if it has none. */
      readonly code: string | null;
      /** What went wrong. */
      readonly message: string;
    };

/**
 * One event in a Reconstruction's stream, which the server sends as a
 * Server-Sent Event of the same `type`: first `started`, then a `progress`
 * for each of @xray/core's progress events, unchanged, with `inspected` among
 * them once `analyse` has read a Managed Assembly's metadata, then `ended`.
 */
export type ReconstructionEvent =
  | {
      readonly type: "started";
      /** The Assembly being reconstructed, as an absolute path. */
      readonly data: { readonly path: string };
    }
  | { readonly type: "progress"; readonly data: ProgressEvent }
  | {
      readonly type: "inspected";
      /** The Assembly's metadata summary, as `xray inspect --json` prints it (FR-20). */
      readonly data: InspectJson;
    }
  | { readonly type: "ended"; readonly data: ReconstructionEnd };

/**
 * Told of an event in a Reconstruction's stream, with its `id`: its place in
 * the stream, counting from 0.
 */
export type EventListener = (id: number, event: ReconstructionEvent) => void;

/**
 * A Reconstruction the server started, and every event it has had so far,
 * kept so a browser that reconnects can be sent those it missed.
 */
export class ReconstructionStream {
  readonly id: string;
  readonly #events: ReconstructionEvent[] = [];
  readonly #listeners = new Set<EventListener>();

  constructor(id: string, path: string) {
    this.id = id;
    this.#events.push({ type: "started", data: { path } });
  }

  /** Whether it has ended, so no event will follow. */
  get ended(): boolean {
    return this.#events.at(-1)?.type === "ended";
  }

  /** How it ended; `null` while it runs. */
  get end(): ReconstructionEnd | null {
    const last = this.#events.at(-1);
    return last?.type === "ended" ? last.data : null;
  }

  /**
   * Tells `listener` of each event after the one with id `after` (-1 for all
   * of them), at once, then of each new one as it happens, until it ends.
   * Returns a function that stops telling it.
   */
  subscribe(after: number, listener: EventListener): () => void {
    for (const [id, event] of this.#events.entries()) {
      if (id > after) {
        listener(id, event);
      }
    }
    if (this.ended) {
      return () => undefined;
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Adds an event to the stream, telling every listener of it. */
  push(event: ReconstructionEvent): void {
    if (this.ended) {
      return;
    }
    const id = this.#events.push(event) - 1;
    for (const listener of this.#listeners) {
      listener(id, event);
    }
    if (event.type === "ended") {
      this.#listeners.clear();
    }
  }
}

/**
 * The Reconstructions of one session of `xray ui`, each into a folder of its
 * own in the session's Workspace.
 */
export class Reconstructions {
  readonly #workspace: string;
  readonly #reconstruct: Reconstruct;
  readonly #streams = new Map<string, ReconstructionStream>();
  readonly #running = new Set<Promise<void>>();
  readonly #stopping = new AbortController();

  constructor(workspace: string, reconstruct: Reconstruct) {
    this.#workspace = workspace;
    this.#reconstruct = reconstruct;
  }

  /**
   * Starts reconstructing the Assembly at `path` (absolute) into the
   * Workspace, building the Recovered Solution, and returns its stream. Each
   * Sibling Assembly beside it that it references is reconstructed too, as a
   * project of its own, unless `siblings` is `false`.
   */
  start(
    path: string,
    { siblings = true }: { readonly siblings?: boolean } = {},
  ): ReconstructionStream {
    if (this.#stopping.signal.aborted) {
      throw new Error("Xray is stopping, so it starts no Reconstruction.");
    }
    const id = randomUUID();
    const stream = new ReconstructionStream(id, path);
    this.#streams.set(id, stream);
    const running = this.#reconstruct(
      path,
      join(this.#workspace, "reconstructions", id),
      {
        siblings,
        onProgress: (data) => stream.push({ type: "progress", data }),
        onInspected: (summary) =>
          stream.push({ type: "inspected", data: toInspectJson(summary) }),
        signal: this.#stopping.signal,
      },
    )
      .then(endOf, failureOf)
      .then((data) => stream.push({ type: "ended", data }));
    this.#running.add(running);
    void running.finally(() => this.#running.delete(running));
    return stream;
  }

  /** The stream of the Reconstruction with `id`, if this session started it. */
  get(id: string): ReconstructionStream | undefined {
    return this.#streams.get(id);
  }

  /**
   * Stops every Reconstruction still running, and resolves once each has, so
   * none writes to the Workspace after. Starts no more.
   */
  async stop(): Promise<void> {
    this.#stopping.abort(
      new Error("Xray stopped, so the Reconstruction was stopped."),
    );
    await Promise.all(this.#running);
  }
}

function endOf(reconstruction: Reconstruction): ReconstructionEnd {
  if (!reconstruction.accepted) {
    const { kind, explanation } = reconstruction.classification;
    return { kind: "rejected", inputKind: kind, explanation };
  }
  return {
    kind: "reconstructed",
    directory: reconstruction.solution.directory,
    report: toXrayReport(reconstruction),
  };
}

function failureOf(error: unknown): ReconstructionEnd {
  // Their messages already say what went wrong.
  const code =
    error instanceof InputError ||
    error instanceof ReconstructionError ||
    error instanceof EngineError
      ? error.code
      : null;
  return {
    kind: "failed",
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
