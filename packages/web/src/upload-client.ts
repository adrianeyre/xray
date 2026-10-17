// How the web app uploads an Assembly, or a folder, into the session's
// Workspace over @xray/server's API (docs/reference/xray-ui.md#the-api): it
// says which files it will send, then sends each, telling how far it has got.
// Nothing here needs a page, so it runs, and is tested, in Node.js as in the
// browser.

import type { StartedUpload } from "./events.js";
import {
  API_PREFIX,
  messageOf,
  UNREACHABLE,
  type Transport,
} from "./reconstruction-client.js";

/** One file the user chose, and where it goes in the upload. */
export interface SelectedFile {
  /**
   * Its name, or, in a folder, its path from the folder's parent, the
   * folder's own name first, with `/` between names.
   */
  readonly path: string;
  readonly file: Blob;
}

/** An Assembly, or a folder, the user chose to upload. */
export interface Selection {
  /** The file's or the folder's name. */
  readonly name: string;
  readonly files: readonly SelectedFile[];
}

/** How far an upload has got. */
export interface UploadProgress {
  /** How many bytes have been sent, of {@link total}. */
  readonly sent: number;
  readonly total: number;
  /** How many files have arrived whole, of {@link fileCount}. */
  readonly arrived: number;
  readonly fileCount: number;
}

/** How an upload went. */
export type UploadResult =
  | { readonly ok: true; readonly upload: StartedUpload }
  | { readonly ok: false; readonly message: string };

/** How many files are sent at once: enough to keep a folder of small ones moving. */
export const PARALLEL_FILES = 4;

/**
 * Uploads `selection` into the Workspace of the server at `base` (`""` for
 * the one that served the page), telling `onProgress` how far it has got at
 * the start and whenever more has been sent, and resolves with the upload,
 * and which of its Assemblies to reconstruct, once every file has arrived;
 * or with why it could not be uploaded, sending nothing more once one file
 * could not be.
 */
export async function uploadSelection(
  selection: Selection,
  transport: Pick<Transport, "fetch" | "put">,
  onProgress: (progress: UploadProgress) => void,
  base = "",
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await transport.fetch(`${base}${API_PREFIX}/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: selection.files.map(({ path, file }) => ({
          path,
          size: file.size,
        })),
      }),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return { ok: false, message: messageOf(body, response.status) };
  }
  const upload = body as StartedUpload;

  const { files } = selection;
  const sentOf = files.map(() => 0);
  const total = files.reduce((sum, { file }) => sum + file.size, 0);
  let arrived = 0;
  const report = () =>
    onProgress({
      sent: sentOf.reduce((sum, sent) => sum + sent, 0),
      total,
      arrived,
      fileCount: files.length,
    });
  report();

  let next = 0;
  let failure: string | null = null;
  const sendFiles = async () => {
    while (failure === null && next < files.length) {
      const index = next++;
      const { file } = files[index] as SelectedFile;
      let answer;
      try {
        answer = await transport.put(
          `${base}${upload.files}/${index}`,
          file,
          (sent) => {
            sentOf[index] = Math.min(sent, file.size);
            report();
          },
        );
      } catch {
        failure ??= UNREACHABLE;
        return;
      }
      if (answer.status < 200 || answer.status >= 300) {
        failure ??= messageOf(answer.body, answer.status);
        return;
      }
      sentOf[index] = file.size;
      arrived++;
      report();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_FILES, files.length) }, sendFiles),
  );
  return failure === null
    ? { ok: true, upload }
    : { ok: false, message: failure };
}

/** `850 B`, `12.3 KB`, `40.0 MB` or `1.2 GB`, counting in 1024s, as file managers do. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit] ?? ""}`;
}
