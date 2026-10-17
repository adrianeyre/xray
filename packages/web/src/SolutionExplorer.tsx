import { useEffect, useRef, useState } from "react";

import type { CreateViewer, Viewer, ViewerPosition } from "./code-viewer.js";
import {
  buildFileTree,
  formatSize,
  type FileNode,
  type FolderNode,
} from "./file-tree.js";
import {
  listRecoveredFiles,
  readRecoveredFile,
  zipPath,
} from "./files-client.js";
import type { RecoveredFile } from "./events.js";
import type { Transport } from "./reconstruction-client.js";
import type { DiagnosticTarget } from "./report.js";
import { isBinary, languageOf } from "./viewer-files.js";

/**
 * A request to open a file of the Recovered Solution at a place in it, as
 * choosing a diagnostic in the report makes: each a new one, so asking for
 * the same place again goes there again.
 */
export interface GoTo {
  readonly target: DiagnosticTarget;
}

/** The files of the Recovered Solution, as far as the server has listed them. */
type Listing =
  | { readonly state: "listing" }
  | {
      readonly state: "listed";
      readonly files: readonly RecoveredFile[];
      readonly tree: FolderNode;
      readonly count: number;
    }
  | { readonly state: "failed"; readonly message: string };

/** The file chosen, and how far it is from being shown. */
type Opened =
  | {
      readonly state: "opening";
      readonly path: string;
      readonly size: number;
    }
  | {
      readonly state: "shown";
      readonly path: string;
      readonly size: number;
      readonly text: string;
      /** Where in it to show, if a diagnostic asked; from its top if absent. */
      readonly at?: ViewerPosition;
    }
  | {
      readonly state: "failed";
      readonly path: string;
      readonly size: number;
      readonly message: string;
    }
  | {
      /** A binary, such as an Assembly copied into `Dependencies/`: not read, nor shown as text. */
      readonly state: "binary";
      readonly path: string;
      readonly size: number;
    };

/**
 * The Recovered Solution a Reconstruction wrote (FR-21): a tree of its
 * folders and files, and a read-only viewer of the one chosen, C#
 * highlighted, or of the one `goTo` asks for, at the place it asks (FR-22);
 * and a button that downloads it all as a zip archive (FR-23).
 */
export function SolutionExplorer({
  reconstruction,
  solutionPath,
  transport,
  createViewer,
  goTo = null,
}: {
  /** The Reconstruction's id. */
  readonly reconstruction: string;
  /** Its `.sln`, relative to its folder. */
  readonly solutionPath: string;
  readonly transport: Transport;
  readonly createViewer: CreateViewer;
  /** The file to open, at the place in it to show, as a diagnostic in the report asks; none if `null`. */
  readonly goTo?: GoTo | null;
}) {
  const [listing, setListing] = useState<Listing>({ state: "listing" });
  // Folders start open, so every file is in view; the user may close them.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<Opened | null>(null);
  const reading = useRef<AbortController | null>(null);
  const panes = useRef<HTMLDivElement>(null);
  // The last request to go to a place that was carried out.
  const went = useRef<GoTo | null>(null);

  useEffect(() => {
    let current = true;
    void listRecoveredFiles(reconstruction, transport).then((result) => {
      if (current) {
        setListing(
          result.ok
            ? {
                state: "listed",
                files: result.files,
                tree: buildFileTree(result.files),
                count: result.files.length,
              }
            : { state: "failed", message: result.message },
        );
      }
    });
    return () => {
      current = false;
    };
  }, [reconstruction, transport]);

  // Nothing still arriving is wanted once the page no longer shows it.
  useEffect(() => () => reading.current?.abort(), []);

  const open = (file: RecoveredFile, at?: ViewerPosition) => {
    reading.current?.abort();
    const reads = new AbortController();
    reading.current = reads;
    const { path, size } = file;
    if (isBinary(path)) {
      reading.current = null;
      setOpened({ state: "binary", path, size });
      return;
    }
    setOpened({ state: "opening", path, size });
    readRecoveredFile(reconstruction, path, transport, reads.signal).then(
      (result) => {
        if (!reads.signal.aborted) {
          setOpened(
            result.ok
              ? {
                  state: "shown",
                  path,
                  size,
                  text: result.text,
                  ...(at === undefined ? {} : { at }),
                }
              : { state: "failed", path, size, message: result.message },
          );
        }
      },
      // Another file was chosen first.
      () => undefined,
    );
  };

  useEffect(() => {
    if (goTo === null || goTo === went.current || listing.state !== "listed") {
      return;
    }
    went.current = goTo;
    const { path, line, column } = goTo.target;
    const file = listing.files.find((each) => each.path === path);
    if (file === undefined) {
      return;
    }
    const at = line === null ? undefined : { line, column };
    // Its folders open, so it is in view in the tree.
    setClosed((current) => {
      const next = new Set(current);
      for (const folder of foldersOf(path)) {
        next.delete(folder);
      }
      return next;
    });
    if (opened?.state === "shown" && opened.path === path) {
      // Shown already: it need only move there.
      const { size, text } = opened;
      setOpened({
        state: "shown",
        path,
        size,
        text,
        ...(at === undefined ? {} : { at }),
      });
    } else {
      open(file, at);
    }
    panes.current?.scrollIntoView?.({ block: "nearest" });
    // Only a new request, or the listing it waited for, goes anywhere: not
    // what is opened changing.
  }, [goTo, listing]);

  const toggle = (folder: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) {
        next.add(folder);
      }
      return next;
    });

  return (
    <section className="explorer" aria-label="Recovered Solution">
      <h2>
        Recovered Solution <code>{solutionPath}</code>
      </h2>
      <p className="download">
        {/* The server names the file, after the solution. */}
        <a className="download-button" href={zipPath(reconstruction)} download>
          Download .zip
        </a>{" "}
        Its files, in a folder of their own, to build with{" "}
        <code>dotnet build</code>: not what that made in <code>bin/</code> and{" "}
        <code>obj/</code>.
      </p>
      {listing.state === "listing" ? (
        <p role="status">Listing its files…</p>
      ) : listing.state === "failed" ? (
        <p className="notice-error" role="alert">
          {listing.message}
        </p>
      ) : (
        <div className="explorer-panes" ref={panes}>
          <nav className="file-tree" aria-label="Files">
            <p className="file-count">
              {listing.count === 1 ? "1 file" : `${listing.count} files`}
            </p>
            <Folder
              folder={listing.tree}
              closed={closed}
              onToggle={toggle}
              chosen={opened?.path ?? null}
              onOpen={open}
            />
          </nav>
          <FilePane opened={opened} createViewer={createViewer} />
        </div>
      )}
    </section>
  );
}

function Folder({
  folder,
  closed,
  onToggle,
  chosen,
  onOpen,
}: {
  readonly folder: FolderNode;
  readonly closed: ReadonlySet<string>;
  readonly onToggle: (folder: string) => void;
  readonly chosen: string | null;
  readonly onOpen: (file: FileNode) => void;
}) {
  return (
    <ul>
      {folder.children.map((child) =>
        child.kind === "folder" ? (
          <li key={child.path} className="tree-folder">
            <button
              type="button"
              aria-expanded={!closed.has(child.path)}
              onClick={() => onToggle(child.path)}
            >
              {child.name}
            </button>
            {closed.has(child.path) ? null : (
              <Folder
                folder={child}
                closed={closed}
                onToggle={onToggle}
                chosen={chosen}
                onOpen={onOpen}
              />
            )}
          </li>
        ) : (
          <li key={child.path} className="tree-file">
            <button
              type="button"
              title={`${child.path}, ${formatSize(child.size)}`}
              aria-current={child.path === chosen ? "true" : undefined}
              data-language={languageOf(child.path)}
              onClick={() => onOpen(child)}
            >
              {child.name}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/** The file chosen: its path and size, how far it is from being shown, and the viewer it is shown in. */
function FilePane({
  opened,
  createViewer,
}: {
  readonly opened: Opened | null;
  readonly createViewer: CreateViewer;
}) {
  if (opened === null) {
    return (
      <div className="file-pane">
        <p className="file-pane-empty">Choose a file to read it.</p>
      </div>
    );
  }
  return (
    <div className="file-pane" aria-label="File" role="region">
      <p className="file-pane-header">
        <code>{opened.path}</code>{" "}
        <span className="file-size">{formatSize(opened.size)}</span>
        {opened.state === "shown" && opened.at !== undefined ? (
          <>
            {" "}
            <span className="file-at">{formatPosition(opened.at)}</span>
          </>
        ) : null}
      </p>
      {opened.state === "opening" ? (
        <p role="status">Opening {opened.path}…</p>
      ) : opened.state === "failed" ? (
        <p className="notice-error" role="alert">
          {opened.message}
        </p>
      ) : opened.state === "binary" ? (
        <p className="file-binary">
          A binary, copied into the Recovered Solution as it was found beside
          the input, so it is not shown here. It is in the .zip.
        </p>
      ) : null}
      <CodeViewer
        file={opened.state === "shown" ? opened : null}
        createViewer={createViewer}
      />
    </div>
  );
}

/**
 * The read-only viewer, made once a file is first chosen and kept while the
 * page shows the Recovered Solution, showing `file`, or hidden while there
 * is none to show.
 */
function CodeViewer({
  file,
  createViewer,
}: {
  readonly file: {
    readonly path: string;
    readonly text: string;
    readonly at?: ViewerPosition;
  } | null;
  readonly createViewer: CreateViewer;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const host = element.current;
    if (host === null) {
      return;
    }
    let made: Viewer | undefined;
    let removed = false;
    createViewer(host).then(
      (each) => {
        if (removed) {
          each.dispose();
          return;
        }
        made = each;
        setViewer(each);
      },
      (error: unknown) =>
        setFailed(
          `The code viewer could not be loaded: ${error instanceof Error ? error.message : String(error)}. Reload the page to try again.`,
        ),
    );
    return () => {
      removed = true;
      made?.dispose();
      setViewer(null);
    };
  }, [createViewer]);

  useEffect(() => {
    if (viewer !== null && file !== null) {
      viewer.show(file.path, file.text, file.at);
    }
  }, [viewer, file]);

  return (
    <>
      {failed === null ? null : (
        <p className="notice-error" role="alert">
          {failed}
        </p>
      )}
      <div
        className="code-viewer"
        ref={element}
        hidden={file === null || failed !== null}
        data-path={file?.path}
      />
    </>
  );
}

/** The folders `path` lies in, outermost first: `A`, `A/B` for `A/B/C.cs`. */
function foldersOf(path: string): string[] {
  const names = path.split("/").slice(0, -1);
  return names.map((_, index) => names.slice(0, index + 1).join("/"));
}

/** `line 2, column 7`, or `line 2`. */
function formatPosition(at: ViewerPosition): string {
  return at.column === null
    ? `line ${at.line}`
    : `line ${at.line}, column ${at.column}`;
}
