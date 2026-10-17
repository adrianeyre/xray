// The read-only code viewer the page shows a Recovered Solution's files in
// (FR-21): Monaco in the browser (monaco-viewer.ts), loaded only once there
// is a file to show; something else in tests, which have no Monaco.

/** A place in a file: its line and, where known, its column, each 1-based. */
export interface ViewerPosition {
  readonly line: number;
  readonly column: number | null;
}

/** A read-only viewer of one file at a time. */
export interface Viewer {
  /**
   * Shows `text` as the file at `path`, highlighted as its language: from
   * its top, or, given `at`, with that line marked, in view, and the cursor
   * on it. Shown again with the same file, it only moves to `at`.
   */
  show(path: string, text: string, at?: ViewerPosition): void;
  /** Removes it from the page. */
  dispose(): void;
}

/** Makes a {@link Viewer} that fills `element`. */
export type CreateViewer = (element: HTMLElement) => Promise<Viewer>;

/**
 * `at`, kept within the `lineCount` lines of a file, the longest of which is
 * no longer than its line's `lineLength`: a diagnostic about a file changed
 * since is still shown, at the nearest place there is.
 */
export function clampPosition(
  at: ViewerPosition,
  lineCount: number,
  lineLength: (line: number) => number,
): { readonly line: number; readonly column: number } {
  const line = Math.min(
    Math.max(Math.trunc(at.line), 1),
    Math.max(lineCount, 1),
  );
  const column = Math.min(
    Math.max(Math.trunc(at.column ?? 1), 1),
    lineLength(line) + 1,
  );
  return { line, column };
}

/**
 * Monaco, loaded from the page's own server, as a chunk of its own, so the
 * page does not wait for it before anything else.
 */
export const createMonacoViewer: CreateViewer = async (element) =>
  (await import("./monaco-viewer.js")).createMonacoViewer(element);
