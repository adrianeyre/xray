import { useEffect, useMemo, useRef, useState } from "react";

import { createMonacoViewer, type CreateViewer } from "./code-viewer.js";

import type { Chosen } from "./file-selection.js";
import { InspectSummary } from "./InspectSummary.js";
import { PathForm } from "./PathForm.js";
import {
  eventsPath,
  followReconstruction,
  startReconstruction,
  type Answer,
  type Connection,
  type ReconstructionInput,
  type Transport,
} from "./reconstruction-client.js";
import {
  applyEvent,
  emptyView,
  type ReconstructionView,
} from "./reconstruction-view.js";
import { ReconstructionProgress } from "./ReconstructionProgress.js";
import { ReportPanel } from "./ReportPanel.js";
import { SiblingsOption } from "./SiblingsOption.js";
import { SiteFooter } from "./SiteFooter.js";
import { SolutionExplorer, type GoTo } from "./SolutionExplorer.js";
import { uploadSelection } from "./upload-client.js";
import { UploadForm, type UploadState } from "./UploadForm.js";

export interface AppProps {
  /** How it talks to the server: the browser's `fetch` and `EventSource` if absent. */
  readonly transport?: Transport;
  /**
   * The Reconstruction to follow from the start, as when the page is loaded
   * again while one runs; none if absent.
   */
  readonly reconstruction?: string | null;
  /** Told of each Reconstruction it starts following, to keep in the address. */
  readonly onFollow?: (id: string) => void;
  /** What makes the code viewer a Recovered Solution's files are read in: Monaco if absent. */
  readonly createViewer?: CreateViewer;
}

/** The browser's own `fetch`, `EventSource` and `XMLHttpRequest`. */
export function browserTransport(): Transport {
  return {
    fetch: (input, init) => fetch(input, init),
    openEventSource: (url) => new EventSource(url),
    put: (url, body, onProgress) =>
      new Promise<Answer>((resolve, reject) => {
        // Only XMLHttpRequest tells how much of a request has been sent.
        const request = new XMLHttpRequest();
        request.open("PUT", url);
        request.setRequestHeader("content-type", "application/octet-stream");
        request.upload.addEventListener("progress", (event) =>
          onProgress(event.loaded),
        );
        request.addEventListener("load", () => {
          let answer: unknown = null;
          try {
            answer = JSON.parse(request.responseText) as unknown;
          } catch {
            // No body, or not JSON.
          }
          resolve({ status: request.status, body: answer });
        });
        request.addEventListener("error", () =>
          reject(new Error(`Could not send ${url}.`)),
        );
        request.addEventListener("abort", () =>
          reject(new Error(`Sending ${url} was stopped.`)),
        );
        request.send(body);
      }),
  };
}

/**
 * Xray's UI: somewhere to drop or pick an Assembly, or a folder, to upload,
 * and a box for the path of one on this machine; the Reconstruction it
 * starts, followed live; its report; and the files of the Recovered
 * Solution it writes, which the report's diagnostics open at their lines.
 */
export function App({
  transport,
  reconstruction = null,
  onFollow,
  createViewer = createMonacoViewer,
}: AppProps = {}) {
  // The same one each time, so what depends on it does not start again.
  const client = useMemo(() => transport ?? browserTransport(), [transport]);
  const [id, setId] = useState<string | null>(reconstruction);
  const [view, setView] = useState<ReconstructionView>(emptyView);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [path, setPath] = useState("");
  // Whether Sibling Assemblies are reconstructed too, as they are unless turned off.
  const [siblings, setSiblings] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Whether the box shows the path of the Assembly being reconstructed: not
  // an uploaded copy's, in the Workspace, which the user never gave.
  const showStartedPath = useRef(true);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Where in the Recovered Solution the diagnostic last chosen in the report is.
  const [goTo, setGoTo] = useState<GoTo | null>(null);

  useEffect(() => {
    // Dropped anywhere else, a file would replace the page.
    const ignore = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, []);

  useEffect(() => {
    if (id === null) {
      return;
    }
    setView(emptyView());
    setGoTo(null);
    return followReconstruction(
      eventsPath(id),
      {
        onEvent: (event) => {
          setView((current) => applyEvent(current, event));
          if (event.type === "started" && showStartedPath.current) {
            // Loaded again, the page shows which Assembly it was.
            setPath((current) => (current === "" ? event.data.path : current));
          }
        },
        onConnection: setConnection,
      },
      client,
    );
  }, [id, client]);

  const running =
    id !== null && view.end === null && connection?.state !== "lost";

  useEffect(() => {
    // Says, in the tab and to a screen reader, where the page has got (WCAG 2.4.2).
    document.title = pageTitle(id === null ? null : view);
  }, [id, view]);

  /** Starts reconstructing `input`, resolving why the server refused, or `null` if it did not. */
  const start = async (input: ReconstructionInput): Promise<string | null> => {
    setStarting(true);
    try {
      const result = await startReconstruction({ ...input, siblings }, client);
      if (!result.ok) {
        return result.message;
      }
      setError(null);
      setUploadError(null);
      setConnection(null);
      setId(result.started.id);
      onFollow?.(result.started.id);
      return null;
    } finally {
      setStarting(false);
    }
  };

  const startFromPath = async (assembly: string) => {
    showStartedPath.current = true;
    setError(await start({ path: assembly }));
  };

  const startFromUpload = async (uploaded: string, assembly: string) => {
    showStartedPath.current = false;
    const refused = await start({ upload: uploaded, assembly });
    setUpload(null);
    setUploadError(refused);
  };

  const uploadChosen = async (chosen: Chosen) => {
    if ("error" in chosen) {
      setUploadError(chosen.error);
      return;
    }
    setUploadError(null);
    setUpload({ stage: "uploading", name: chosen.name, progress: null });
    const result = await uploadSelection(chosen, client, (progress) =>
      setUpload({ stage: "uploading", name: chosen.name, progress }),
    );
    if (!result.ok) {
      setUpload(null);
      setUploadError(result.message);
      return;
    }
    const { assembly } = result.upload;
    if (assembly === null) {
      setUpload({
        stage: "choosing",
        name: chosen.name,
        upload: result.upload,
      });
      return;
    }
    await startFromUpload(result.upload.id, assembly);
  };

  const uploading = upload?.stage === "uploading";

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-header-inner">
          <div className="brand">
            <BrandMark />
            <div>
              <h1>Xray</h1>
              <p>
                Turn a compiled .NET application back into a buildable C#
                solution.
              </p>
            </div>
          </div>
          <p className="local-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Runs only on this machine
          </p>
        </div>
      </header>
      <main
        id="content"
        className="shell-main"
        aria-label="Reconstruction"
        tabIndex={-1}
      >
        <IntendedUse />
        <SiblingsOption
          siblings={siblings}
          onChange={setSiblings}
          busy={starting || running || uploading}
        />
        <UploadForm
          onChosen={(chosen) => void uploadChosen(chosen)}
          onAssemblyChosen={(assembly) => {
            if (upload?.stage === "choosing") {
              void startFromUpload(upload.upload.id, assembly);
            }
          }}
          busy={starting || running || uploading}
          upload={upload}
          error={uploadError}
        />
        <PathForm
          path={path}
          onPathChange={setPath}
          onSubmit={(assembly) => void startFromPath(assembly)}
          busy={starting || running || uploading}
          error={error}
        />
        {id === null ? null : (
          <ReconstructionProgress view={view} connection={connection} />
        )}
        {id === null || view.end?.kind !== "reconstructed" ? null : (
          <ReportPanel
            report={view.end.report}
            directory={view.end.directory}
            onGoTo={(target) => setGoTo({ target })}
          />
        )}
        {id === null || view.inspection === null ? null : (
          <InspectSummary inspection={view.inspection} />
        )}
        {id === null || view.end?.kind !== "reconstructed" ? null : (
          <SolutionExplorer
            key={id}
            reconstruction={id}
            solutionPath={view.end.report.solution.solutionPath}
            transport={client}
            createViewer={createViewer}
            goTo={goTo}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

/** The page's title: what it is doing, then Xray. */
export function pageTitle(view: ReconstructionView | null): string {
  if (view === null || view.path === null) {
    return "Xray";
  }
  const name = view.path.split(/[\\/]/).at(-1) ?? view.path;
  const doing =
    view.end === null
      ? "Reconstructing"
      : view.end.kind === "reconstructed"
        ? "Reconstructed"
        : "Could not reconstruct";
  return `${doing} ${name} – Xray`;
}

/** Xray's mark: a lens over a bracket, the code it sees through. */
function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" />
      <path d="M10 10l-4.5 6 4.5 6M22 10l4.5 6-4.5 6M17.8 10.5l-3.6 11" />
    </svg>
  );
}

/** What Xray is for, and what it is not (PRD §5), where every user sees it before giving it anything. */
export function IntendedUse() {
  return (
    <aside className="intended-use" aria-label="Intended use">
      <p>
        <strong>Intended use.</strong> Xray is for Assemblies you own or have
        the right to analyse: recovering lost source for your own software,
        studying how C# features compile, or maintaining legacy internal
        applications. It does not undo obfuscation, or bypass licence checks or
        any other protection.
      </p>
    </aside>
  );
}
