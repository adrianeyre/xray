// Monaco, as the read-only code viewer, bundled into the web app, so it is
// served by Xray on 127.0.0.1 like the rest of the page, and loads nothing
// from anywhere else.

import * as monaco from "monaco-editor/editor";
// Its icons' font, and finding text in a file, as Ctrl+F (Cmd+F) does.
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/find/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import { clampPosition, type Viewer } from "./code-viewer.js";
import { languageOf } from "./viewer-files.js";
import "./viewer-languages.js";

// What Monaco works out off the page's thread: which only needs its own
// worker, none of a language's.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const DARK = window.matchMedia("(prefers-color-scheme: dark)");

/** Monaco's theme for the user's light or dark scheme, as the page follows it. */
function theme(): string {
  return DARK.matches ? "vs-dark" : "vs";
}

/**
 * A Monaco editor that only shows files, filling `element`. However large a
 * file, it draws only the lines in view, and highlights the rest a little at
 * a time while the page is idle, so showing one never stops the page
 * answering; past 20 MB, or 300,000 lines, it does not highlight it at all.
 */
export function createMonacoViewer(element: HTMLElement): Viewer {
  const editor = monaco.editor.create(element, {
    model: null,
    readOnly: true,
    domReadOnly: true,
    ariaLabel: "Code viewer",
    // Tab leaves the viewer, as it leaves any other part of the page (WCAG 2.1.2).
    tabFocusMode: true,
    readOnlyMessage: {
      value: "The Recovered Solution's files can only be read here.",
    },
    theme: theme(),
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    largeFileOptimizations: true,
    fontSize: 13,
  });
  const followScheme = () => monaco.editor.setTheme(theme());
  DARK.addEventListener("change", followScheme);
  // The line a diagnostic is about, marked while it is shown.
  const marked = editor.createDecorationsCollection();
  let shown: { readonly path: string; readonly text: string } | null = null;
  return {
    show: (path, text, at) => {
      marked.clear();
      if (shown?.path !== path || shown.text !== text) {
        const previous = editor.getModel();
        editor.setModel(monaco.editor.createModel(text, languageOf(path)));
        editor.updateOptions({ ariaLabel: `${path}, read-only` });
        previous?.dispose();
        shown = { path, text };
      }
      const model = editor.getModel();
      if (at === undefined || model === null) {
        editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        return;
      }
      const { line, column } = clampPosition(at, model.getLineCount(), (each) =>
        model.getLineLength(each),
      );
      marked.set([
        {
          range: {
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: line,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "viewer-marked-line",
            linesDecorationsClassName: "viewer-marked-gutter",
          },
        },
      ]);
      editor.setPosition({ lineNumber: line, column });
      editor.revealPositionInCenter({ lineNumber: line, column });
      editor.focus();
    },
    dispose: () => {
      DARK.removeEventListener("change", followScheme);
      marked.clear();
      editor.getModel()?.dispose();
      editor.dispose();
    },
  };
}
