import type { FormEvent } from "react";

/**
 * The local path text box (FR-1): the path of an Assembly, or a folder holding
 * one, on this machine, so a large one need not be uploaded.
 */
export function PathForm({
  path,
  onPathChange,
  onSubmit,
  busy,
  error,
}: {
  readonly path: string;
  readonly onPathChange: (path: string) => void;
  readonly onSubmit: (path: string) => void;
  /** While a Reconstruction is starting or running, another cannot be started. */
  readonly busy: boolean;
  /** Why the server refused the last path, if it did. */
  readonly error: string | null;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(path);
  };
  return (
    <form className="path-form" onSubmit={submit}>
      <label htmlFor="assembly-path">
        Path to an Assembly, or a folder holding one, on this machine
      </label>
      <div className="path-form-row">
        <input
          id="assembly-path"
          name="path"
          type="text"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder="C:\Apps\MyApp.exe or /home/me/MyApp.dll"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : "assembly-path-error"}
        />
        <button type="submit" disabled={busy}>
          Reconstruct
        </button>
      </div>
      {error === null ? null : (
        <p id="assembly-path-error" className="path-form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
