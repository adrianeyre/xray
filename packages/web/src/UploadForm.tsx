import { useRef, useState, type DragEvent } from "react";

import type { StartedUpload } from "./events.js";
import {
  chosenFromDrop,
  chosenFromPicker,
  type Chosen,
} from "./file-selection.js";
import { formatBytes, type UploadProgress } from "./upload-client.js";

/** An upload under way: sending its files, or waiting for the user to say which Assembly to reconstruct. */
export type UploadState =
  | {
      readonly stage: "uploading";
      /** The file's or the folder's name. */
      readonly name: string;
      /** How far it has got; `null` until the server has taken the list of files. */
      readonly progress: UploadProgress | null;
    }
  | {
      readonly stage: "choosing";
      readonly name: string;
      readonly upload: StartedUpload;
    };

/**
 * Uploading an Assembly, or a folder holding one (FR-1): dropped on it, or
 * chosen with the file or folder picker; then how far the upload has got,
 * and, where the folder does not say which Assembly to reconstruct, a choice
 * of them.
 */
export function UploadForm({
  onChosen,
  onAssemblyChosen,
  busy,
  upload,
  error,
}: {
  /** Told of what the user dropped or picked, or why it cannot be uploaded. */
  readonly onChosen: (chosen: Chosen) => void;
  /** Told which Assembly of the upload to reconstruct, when the user must choose. */
  readonly onAssemblyChosen: (assembly: string) => void;
  /** While an upload or a Reconstruction is under way, nothing more can be uploaded. */
  readonly busy: boolean;
  readonly upload: UploadState | null;
  /** Why the last upload failed, if it did. */
  readonly error: string | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const dragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
    setDragging(!busy);
  };
  const dragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) {
      // Reads the drop's items before returning, as it must.
      void chosenFromDrop(event.dataTransfer).then(onChosen);
    }
  };
  const picked = (input: HTMLInputElement, folder: boolean) => {
    const chosen = chosenFromPicker(input.files ?? [], folder);
    // Choosing the same again must still tell of it.
    input.value = "";
    if (chosen !== null) {
      onChosen(chosen);
    }
  };

  return (
    <section className="upload" aria-label="Upload">
      <div
        className="drop-zone"
        data-dragging={dragging}
        data-busy={busy}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={drop}
      >
        <p className="drop-zone-prompt">
          Drop an Assembly (<code>.exe</code> or <code>.dll</code>), or a folder
          holding one, here
        </p>
        <p className="drop-zone-pickers">
          or{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Choose a file…
          </button>{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => folderInput.current?.click()}
          >
            Choose a folder…
          </button>
        </p>
        <input
          ref={fileInput}
          id="upload-file"
          type="file"
          accept=".exe,.dll"
          hidden
          onChange={(event) => picked(event.currentTarget, false)}
        />
        <input
          ref={(input) => {
            folderInput.current = input;
            // React does not know the attribute every browser picks folders with.
            input?.setAttribute("webkitdirectory", "");
          }}
          id="upload-folder"
          type="file"
          hidden
          onChange={(event) => picked(event.currentTarget, true)}
        />
        <p className="drop-zone-note">
          It is copied into this session&rsquo;s Workspace, on this machine, and
          deleted when Xray stops. To reconstruct a large application without
          copying it, give its path below.
        </p>
      </div>
      {upload === null ? null : (
        <UploadStatus upload={upload} onAssemblyChosen={onAssemblyChosen} />
      )}
      {error === null ? null : (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function UploadStatus({
  upload,
  onAssemblyChosen,
}: {
  readonly upload: UploadState;
  readonly onAssemblyChosen: (assembly: string) => void;
}) {
  if (upload.stage === "choosing") {
    return (
      <AssemblyChoice upload={upload} onAssemblyChosen={onAssemblyChosen} />
    );
  }
  const { name, progress } = upload;
  const percent =
    progress === null || progress.total === 0
      ? null
      : Math.floor((progress.sent / progress.total) * 100);
  return (
    <div className="upload-progress" role="status" aria-live="polite">
      <p>
        Uploading <code>{name}</code>
        {progress === null
          ? "…"
          : `: ${formatBytes(progress.sent)} of ${formatBytes(progress.total)}${percent === null ? "" : ` (${percent}%)`}, ${progress.arrived} of ${progress.fileCount} ${progress.fileCount === 1 ? "file" : "files"}`}
      </p>
      <progress
        value={progress?.sent ?? 0}
        max={Math.max(progress?.total ?? 1, 1)}
        aria-label={`Uploading ${name}`}
      />
    </div>
  );
}

function AssemblyChoice({
  upload,
  onAssemblyChosen,
}: {
  readonly upload: Extract<UploadState, { stage: "choosing" }>;
  readonly onAssemblyChosen: (assembly: string) => void;
}) {
  const { assemblies } = upload.upload;
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <form
      className="assembly-choice"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen !== null) {
          onAssemblyChosen(chosen);
        }
      }}
    >
      <fieldset>
        <legend>
          <code>{upload.name}</code> holds {assemblies.length} <code>.exe</code>{" "}
          and <code>.dll</code> files. Which is the application to reconstruct?
        </legend>
        {assemblies.map((assembly) => (
          <label key={assembly}>
            <input
              type="radio"
              name="assembly"
              value={assembly}
              checked={chosen === assembly}
              onChange={() => setChosen(assembly)}
            />{" "}
            <code>{assembly}</code>
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={chosen === null}>
        Reconstruct
      </button>
    </form>
  );
}
