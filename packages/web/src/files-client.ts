// How the web app lists the files of the Recovered Solution a Reconstruction
// wrote, reads each, and downloads them all, over @xray/server's API
// (docs/reference/xray-ui.md#the-api). Nothing here needs a page, so it runs,
// and is tested, in Node.js as in the browser.

import type { RecoveredFile, RecoveredFiles } from "./events.js";
import {
  API_PREFIX,
  messageOf,
  UNREACHABLE,
  type Transport,
} from "./reconstruction-client.js";

/** Where the list of files of the Recovered Solution of the Reconstruction with `id` is. */
export function filesPath(id: string): string {
  return `${API_PREFIX}/reconstructions/${encodeURIComponent(id)}/files`;
}

/** Where the file at `path` in that Recovered Solution is: each of its names encoded. */
export function filePath(id: string, path: string): string {
  return `${filesPath(id)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Where that Recovered Solution is, as a zip archive to download (FR-23):
 * every file of it, in a folder named after its solution.
 */
export function zipPath(id: string): string {
  return `${API_PREFIX}/reconstructions/${encodeURIComponent(id)}/zip`;
}

/** How listing, or reading, went. */
export type FilesResult<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly message: string };

/**
 * Asks the server at `base` (`""` for the one that served the page) for the
 * files of the Recovered Solution the Reconstruction with `id` wrote, and
 * resolves with them, or with why it would not list them.
 */
export async function listRecoveredFiles(
  id: string,
  { fetch }: Pick<Transport, "fetch">,
  base = "",
): Promise<FilesResult<{ readonly files: readonly RecoveredFile[] }>> {
  let response: Response;
  try {
    response = await fetch(`${base}${filesPath(id)}`);
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  const files = (body as Partial<RecoveredFiles> | null)?.files;
  if (response.ok && Array.isArray(files)) {
    return { ok: true, files };
  }
  return { ok: false, message: messageOf(body, response.status) };
}

/**
 * Asks the server at `base` for the file at `path` in that Recovered
 * Solution, and resolves with its text, or with why it would not send it.
 * Rejects with an `AbortError` once `signal` is aborted, as when another
 * file is chosen before it has arrived.
 */
export async function readRecoveredFile(
  id: string,
  path: string,
  { fetch }: Pick<Transport, "fetch">,
  signal?: AbortSignal,
  base = "",
): Promise<FilesResult<{ readonly text: string }>> {
  let response: Response;
  try {
    response = await fetch(`${base}${filePath(id, path)}`, {
      signal: signal ?? null,
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    return { ok: false, message: UNREACHABLE };
  }
  if (response.ok) {
    return { ok: true, text: await response.text() };
  }
  return {
    ok: false,
    message: messageOf(
      (await response.json().catch(() => null)) as unknown,
      response.status,
    ),
  };
}
