import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { chooseInputAssembly, type InputAssemblyChoice } from "@xray/core";

/** One file of an upload, as the browser declares it before sending it. */
export interface UploadFile {
  /**
   * Where it goes in the upload: its name, or, in a folder, its path from
   * the folder's parent, the folder's own name first, with `/` between names.
   */
  readonly path: string;
  /** How many bytes it is. */
  readonly size: number;
}

/** Why the server refused part of an upload, with the status to answer. */
export class UploadRefused extends Error {
  override readonly name = "UploadRefused";
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

const FILES_AS_JSON =
  'Send the files to upload as JSON: {"files": [{"path": "…", "size": …}, …]}.';

/**
 * The files the browser says it will upload, checked so each can be written
 * only inside the upload's folder in the Workspace, under the name it has,
 * on any operating system; or why they cannot be.
 */
export function checkUploadFiles(
  files: unknown,
): readonly UploadFile[] | UploadRefused {
  if (!Array.isArray(files)) {
    return new UploadRefused(400, FILES_AS_JSON);
  }
  if (files.length === 0) {
    return new UploadRefused(
      400,
      "There are no files to upload: choose an Assembly, or a folder holding one.",
    );
  }
  const checked: UploadFile[] = [];
  // Each file and folder by its name folded to one case, as Windows and macOS
  // compare them, so no two can be written to the same place.
  const fileNames = new Map<string, string>();
  const folderNames = new Map<string, string>();
  for (const file of files as unknown[]) {
    const { path, size } = (file ?? {}) as Partial<Record<string, unknown>>;
    if (
      typeof path !== "string" ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      return new UploadRefused(400, FILES_AS_JSON);
    }
    const wrong = whatIsWrongWith(path);
    if (wrong !== undefined) {
      return new UploadRefused(400, `Xray cannot upload "${path}": ${wrong}.`);
    }
    const folded = path.toLowerCase();
    const same = fileNames.get(folded) ?? folderNames.get(folded);
    if (same !== undefined) {
      return new UploadRefused(
        400,
        `"${same}" and "${path}" would be the same ${fileNames.has(folded) ? "file" : "folder"} in Xray's Workspace, whose names do not tell capitals from small letters on every system.`,
      );
    }
    const segments = path.split("/");
    for (let end = 1; end < segments.length; end++) {
      const folder = segments.slice(0, end).join("/");
      const file = fileNames.get(folder.toLowerCase());
      if (file !== undefined) {
        return new UploadRefused(
          400,
          `"${file}" cannot be both a file and the folder holding "${path}".`,
        );
      }
      folderNames.set(folder.toLowerCase(), folder);
    }
    fileNames.set(folded, path);
    checked.push({ path, size });
  }
  if (
    chooseInputAssembly(checked.map((file) => file.path)).assemblies.length ===
    0
  ) {
    return new UploadRefused(
      400,
      "There is no .exe or .dll among the files given: choose an Assembly, or a folder holding one.",
    );
  }
  return checked;
}

// Windows' reserved device names, which it will not give a file, whatever
// follows a dot after them.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
// Separators, Windows' forbidden characters, and control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\:*?"<>|\u0000-\u001f]/;

/** What makes `path` no path of a file within the upload, or `undefined` if nothing does. */
function whatIsWrongWith(path: string): string | undefined {
  const segments = path.split("/");
  if (segments.some((segment) => ["", ".", ".."].includes(segment))) {
    return "its path must lead from the folder uploaded to a file in it, with / between names, none of them empty, . or ..";
  }
  for (const segment of segments) {
    if (FORBIDDEN.test(segment)) {
      return `"${segment}" holds a character a name cannot hold on every system: \\ : * ? " < > | or a control character`;
    }
    if (/[. ]$/.test(segment) || RESERVED.test(segment)) {
      return `Windows cannot hold a file or folder named "${segment}"`;
    }
  }
  return undefined;
}

/**
 * The files of one upload, written to a folder of its own in the Workspace
 * as they arrive, each under the path it was declared with.
 */
export class Upload {
  readonly id: string;
  /** Where its files are written, in the Workspace. */
  readonly directory: string;
  readonly files: readonly UploadFile[];
  /** Its Assemblies, and which a Reconstruction of it starts from. */
  readonly choice: InputAssemblyChoice;
  readonly #arrived: boolean[];
  readonly #arriving = new Set<number>();

  constructor(id: string, directory: string, files: readonly UploadFile[]) {
    this.id = id;
    this.directory = directory;
    this.files = files;
    this.choice = chooseInputAssembly(files.map((file) => file.path));
    this.#arrived = files.map(() => false);
  }

  /** How many of its files have arrived whole. */
  get arrived(): number {
    return this.#arrived.filter(Boolean).length;
  }

  /** Where the file at `path` in the upload is written. */
  pathOf(path: string): string {
    return join(this.directory, ...path.split("/"));
  }

  /**
   * Writes `contents` as the file at `index`, which must be exactly the size
   * declared, and resolves once it is written whole. Throws an
   * {@link UploadRefused} if there is no such file, it has arrived already or
   * is arriving, or its contents are not the size declared, deleting what
   * was written of it so it can be sent again.
   */
  async receive(index: number, contents: Readable): Promise<void> {
    const file = this.files[index];
    if (file === undefined) {
      throw new UploadRefused(404, "There is no such file in this upload.");
    }
    if (this.#arrived[index] === true || this.#arriving.has(index)) {
      throw new UploadRefused(409, `"${file.path}" has already been uploaded.`);
    }
    this.#arriving.add(index);
    const target = this.pathOf(file.path);
    let received = 0;
    try {
      await mkdir(dirname(target), { recursive: true });
      await pipeline(
        contents,
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            // Nothing past its size is written, but all of it is read, so
            // the browser is answered rather than cut off.
            const room = Math.max(file.size - received, 0);
            received += chunk.length;
            done(null, chunk.length <= room ? chunk : chunk.subarray(0, room));
          },
        }),
        createWriteStream(target),
      );
      if (received !== file.size) {
        throw new UploadRefused(
          400,
          `"${file.path}" is ${file.size} bytes, but ${received} were sent.`,
        );
      }
      this.#arrived[index] = true;
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    } finally {
      this.#arriving.delete(index);
    }
  }
}

/** The uploads of one session of `xray ui`, each into a folder of its own in its Workspace. */
export class Uploads {
  readonly #workspace: string;
  readonly #uploads = new Map<string, Upload>();
  readonly #receiving = new Set<Promise<void>>();
  #stopping = false;

  constructor(workspace: string) {
    this.#workspace = workspace;
  }

  /** Begins an upload of `files`, checked by {@link checkUploadFiles}. Its folder is made as they arrive. */
  create(files: readonly UploadFile[]): Upload {
    if (this.#stopping) {
      throw new Error("Xray is stopping, so it takes no upload.");
    }
    const id = randomUUID();
    const upload = new Upload(id, join(this.#workspace, "uploads", id), files);
    this.#uploads.set(id, upload);
    return upload;
  }

  /** The upload with `id`, if this session began it. */
  get(id: string): Upload | undefined {
    return this.#uploads.get(id);
  }

  /** {@link Upload.receive}, kept track of so {@link stop} can wait for it. */
  receive(upload: Upload, index: number, contents: Readable): Promise<void> {
    if (this.#stopping) {
      return Promise.reject(
        new Error("Xray is stopping, so it takes no upload."),
      );
    }
    const receiving = upload.receive(index, contents);
    const settled = receiving.then(
      () => undefined,
      () => undefined,
    );
    this.#receiving.add(settled);
    void settled.finally(() => this.#receiving.delete(settled));
    return receiving;
  }

  /**
   * Takes no more files, and resolves once every file still arriving has
   * stopped, so none is written to the Workspace after.
   */
  async stop(): Promise<void> {
    this.#stopping = true;
    await Promise.all(this.#receiving);
  }
}
