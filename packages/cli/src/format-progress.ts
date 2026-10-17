import {
  RECONSTRUCTION_STAGES,
  type ProgressEvent,
  type ProgressListener,
  type ReconstructionStage,
} from "@xray/core";

import { formatDuration } from "./format-reconstruction.js";

const STAGE_NAMES: Readonly<Record<ReconstructionStage, string>> = {
  analyse: "Analyse",
  decompile: "Decompile",
  "resolve-dependencies": "Resolve dependencies",
  generate: "Generate solution",
  build: "Build",
  run: "Run the rebuilt program",
};

/** What each stage counts, when it counts: one, and more. */
const COUNTED: Partial<
  Readonly<Record<ReconstructionStage, readonly [string, string]>>
> = {
  decompile: ["type", "types"],
  "resolve-dependencies": ["Sibling Assembly", "Sibling Assemblies"],
  generate: ["file", "files"],
};

/**
 * In plain lines, how long a stage goes between progress lines, so a CI log
 * shows a long stage is still running without filling up with it.
 */
export const PLAIN_PROGRESS_INTERVAL_MS = 5_000;

const CLEAR_LINE = "\r\x1b[2K";

/**
 * Renders a Reconstruction's progress events with `write` (FR-19). On a
 * terminal `columns` wide, each stage is one line, rewritten in place as it
 * progresses (cut short of the terminal's width, as a line that wraps cannot
 * be rewritten) and left showing how it ended, in full. Elsewhere (`columns` is
 * `undefined`), as in a CI log, each stage is a plain line as it starts and
 * another as it ends, with a progress line between every
 * {@link PLAIN_PROGRESS_INTERVAL_MS} while it runs.
 */
export function progressDisplay(
  write: (text: string) => void,
  columns: () => number | undefined,
): ProgressListener {
  /** When the running stage started, and when its last plain progress line was. */
  let startedAt = 0;
  let lastLineAt = 0;
  return (event) => {
    if (event.kind === "stage-started") {
      startedAt = lastLineAt = event.elapsedMs;
    }
    const width = columns();
    const line = formatProgressEvent(event, event.elapsedMs - startedAt);
    const ends =
      event.kind !== "stage-started" && event.kind !== "stage-progress";
    if (width !== undefined) {
      // One column short, so a line that fills the terminal does not wrap.
      write(`${CLEAR_LINE}${ends ? `${line}\n` : truncate(line, width - 1)}`);
      return;
    }
    if (event.kind === "stage-progress") {
      if (event.elapsedMs - lastLineAt < PLAIN_PROGRESS_INTERVAL_MS) {
        return;
      }
      lastLineAt = event.elapsedMs;
    }
    write(`${line}\n`);
  };
}

/**
 * One event as a line: the stage, numbered among them, then what happened:
 * `[2/6] Decompile: 3 of 120 types (App.Models.Point), 4.2 s so far`.
 * `stageMs` is how long its stage has been running.
 */
export function formatProgressEvent(
  event: ProgressEvent,
  stageMs: number,
): string {
  const number = RECONSTRUCTION_STAGES.indexOf(event.stage) + 1;
  const stage = `[${number}/${RECONSTRUCTION_STAGES.length}] ${STAGE_NAMES[event.stage]}`;
  switch (event.kind) {
    case "stage-started":
      return `${stage}…`;
    case "stage-progress": {
      const { done, total, current } = event;
      const nouns = COUNTED[event.stage];
      const noun = nouns === undefined ? "" : ` ${nouns[total === 1 ? 0 : 1]}`;
      const counted =
        done === null || total === null
          ? ""
          : `${done} of ${total}${noun}${current === null ? "" : ` (${current})`}, `;
      return `${stage}: ${counted}${formatDuration(stageMs)} so far`;
    }
    case "stage-finished":
      return `${stage}: done in ${formatDuration(event.durationMs)}`;
    case "stage-skipped":
      return `${stage}: skipped. ${event.reason}`;
    case "stage-failed":
      return `${stage}: failed after ${formatDuration(event.durationMs)}`;
  }
}

function truncate(line: string, width: number): string {
  return line.length <= width
    ? line
    : `${line.slice(0, Math.max(0, width - 1))}…`;
}
