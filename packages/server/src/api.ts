import { isAbsolute } from "node:path";
import type { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply } from "fastify";

import type {
  ReconstructionEvent,
  Reconstructions,
} from "./reconstructions.js";
import {
  listRecoveredFiles,
  openRecoveredFile,
  RecoveredFileRefused,
  recoveredSolutionOf,
  zipRecoveredSolution,
  type RecoveredFile,
  type RecoveredSolutionFiles,
} from "./recovered-files.js";
import { checkUploadFiles, UploadRefused, type Uploads } from "./uploads.js";

/** Where the API is, below the web app. */
export const API_PREFIX = "/api";

/** How soon a browser that loses a Reconstruction's stream connects again, in milliseconds. */
export const RECONNECT_MS = 1_000;

/** What the server answers `POST /api/reconstructions` with. */
export interface StartedReconstruction {
  readonly id: string;
  /** The Assembly, as an absolute path. */
  readonly path: string;
  /** Where its stream of events is. */
  readonly events: string;
}

/** What the server answers `POST /api/uploads` with. */
export interface StartedUpload {
  readonly id: string;
  /** Where each file is sent, by its place in the list: `<files>/<n>`. */
  readonly files: string;
  /** The files that may be Assemblies: each `.exe` and `.dll`. */
  readonly assemblies: readonly string[];
  /** The one to reconstruct; `null` if the files do not say which, so the user must choose. */
  readonly assembly: string | null;
}

/** What the server answers `GET /api/reconstructions/<id>/files` with. */
export interface RecoveredFiles {
  /** Every file of the Recovered Solution, in the order it was written, the report last. */
  readonly files: readonly RecoveredFile[];
}

/** How large the list of files to upload may be, in bytes: room for tens of thousands. */
export const UPLOAD_LIST_LIMIT = 16 * 1024 * 1024;

/** What the server answers a request it refuses with, beside its status. */
export interface ApiError {
  /** What was wrong with the request, for the user. */
  readonly message: string;
}

/**
 * Adds the API the web app drives Reconstructions with to `app` (FR-1,
 * FR-19): `POST /api/uploads` and `PUT /api/uploads/<id>/files/<n>` upload
 * an Assembly, or a folder, into the Workspace; `POST /api/reconstructions`
 * starts a Reconstruction of one uploaded, or at a local path, with its
 * Sibling Assemblies unless `siblings` is `false`;
 * `GET /api/reconstructions/<id>/events` streams its progress; and
 * `GET /api/reconstructions/<id>/files` lists the files of the Recovered
 * Solution it wrote, and `GET /api/reconstructions/<id>/files/<path>` sends
 * one of them, read-only (FR-21); and `GET /api/reconstructions/<id>/zip`
 * sends them all, as a zip archive to download (FR-23).
 */
export function registerApi(
  app: FastifyInstance,
  reconstructions: Reconstructions,
  uploads: Uploads,
): void {
  // A file's contents are streamed to the Workspace as they arrive, never
  // held whole in memory, however large.
  app.addContentTypeParser(
    "application/octet-stream",
    (_request, payload, done) => done(null, payload),
  );

  app.post(
    `${API_PREFIX}/uploads`,
    { bodyLimit: UPLOAD_LIST_LIMIT },
    async (request, reply) => {
      if (!isJson(request.headers["content-type"])) {
        return refuse(
          reply,
          415,
          'Send the files to upload as JSON: {"files": [{"path": "…", "size": …}, …]}.',
        );
      }
      const { files } = (request.body ?? {}) as { files?: unknown };
      const checked = checkUploadFiles(files);
      if (checked instanceof UploadRefused) {
        return refuse(reply, checked.status, checked.message);
      }
      const upload = uploads.create(checked);
      const location = `${API_PREFIX}/uploads/${upload.id}/files`;
      const started: StartedUpload = {
        id: upload.id,
        files: location,
        assemblies: upload.choice.assemblies,
        assembly: upload.choice.assembly,
      };
      return reply.code(201).header("location", location).send(started);
    },
  );

  app.put<{ Params: { id: string; index: string } }>(
    `${API_PREFIX}/uploads/:id/files/:index`,
    async (request, reply) => {
      const upload = uploads.get(request.params.id);
      if (upload === undefined) {
        return refuse(reply, 404, NO_SUCH_UPLOAD);
      }
      const { index } = request.params;
      const file = /^\d+$/.test(index)
        ? upload.files[Number(index)]
        : undefined;
      if (file === undefined) {
        return refuse(reply, 404, "There is no such file in this upload.");
      }
      if (
        !/^application\/octet-stream\s*(;|$)/i.test(
          request.headers["content-type"] ?? "",
        )
      ) {
        return refuse(
          reply,
          415,
          "Send the file's contents as application/octet-stream.",
        );
      }
      const length = request.headers["content-length"];
      if (length !== undefined && Number(length) !== file.size) {
        return refuse(
          reply,
          400,
          `"${file.path}" is ${file.size} bytes, but ${length} were sent.`,
        );
      }
      try {
        await uploads.receive(
          upload,
          Number(index),
          (request.body as Readable | undefined) ?? request.raw,
        );
      } catch (error) {
        if (error instanceof UploadRefused) {
          return refuse(reply, error.status, error.message);
        }
        throw error;
      }
      return reply.code(204).send();
    },
  );

  app.post(`${API_PREFIX}/reconstructions`, async (request, reply) => {
    if (!isJson(request.headers["content-type"])) {
      return refuse(
        reply,
        415,
        'Send the Assembly\'s path as JSON: {"path": "…"}.',
      );
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const checked =
      body.upload === undefined
        ? checkPath(body.path)
        : checkUploaded(uploads, body.upload, body.assembly);
    if (checked instanceof UploadRefused) {
      return refuse(reply, checked.status, checked.message);
    }
    if (typeof checked !== "string") {
      return refuse(reply, 400, checked.message);
    }
    const { siblings = true } = body;
    if (typeof siblings !== "boolean") {
      return refuse(
        reply,
        400,
        'Say whether to reconstruct Sibling Assemblies as true or false: {"siblings": false}.',
      );
    }
    const stream = reconstructions.start(checked, { siblings });
    const events = `${API_PREFIX}/reconstructions/${stream.id}/events`;
    const started: StartedReconstruction = {
      id: stream.id,
      path: checked,
      events,
    };
    return reply.code(202).header("location", events).send(started);
  });

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/reconstructions/:id/events`,
    (request, reply) => {
      const stream = reconstructions.get(request.params.id);
      if (stream === undefined) {
        return refuse(reply, 404, NO_SUCH_RECONSTRUCTION);
      }
      // The browser says which event it had last when it connects again.
      const lastEventId = request.headers["last-event-id"];
      const after =
        typeof lastEventId === "string" && /^\d+$/.test(lastEventId)
          ? Number(lastEventId)
          : -1;

      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      });
      response.write(`retry: ${RECONNECT_MS}\n\n`);
      const unsubscribe = stream.subscribe(after, (id, event) => {
        response.write(formatEvent(id, event));
        if (event.type === "ended") {
          response.end();
        }
      });
      if (stream.ended) {
        response.end();
      }
      // The browser has gone, or the stream has ended.
      response.once("close", unsubscribe);
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/reconstructions/:id/files`,
    async (request, reply) => {
      const solution = solutionOf(reconstructions, request.params.id);
      if (solution instanceof RecoveredFileRefused) {
        return refuse(reply, solution.status, solution.message);
      }
      const listed: RecoveredFiles = {
        files: await listRecoveredFiles(solution),
      };
      return reply.header("cache-control", "no-store").send(listed);
    },
  );

  app.get<{ Params: { id: string; "*": string } }>(
    `${API_PREFIX}/reconstructions/:id/files/*`,
    async (request, reply) => {
      const solution = solutionOf(reconstructions, request.params.id);
      if (solution instanceof RecoveredFileRefused) {
        return refuse(reply, solution.status, solution.message);
      }
      let file;
      try {
        file = await openRecoveredFile(solution, request.params["*"]);
      } catch (error) {
        if (error instanceof RecoveredFileRefused) {
          return refuse(reply, error.status, error.message);
        }
        throw error;
      }
      // Streamed from disk, never held whole in memory, however large; and
      // only ever shown as text, never run, by any page.
      return reply
        .type("text/plain; charset=utf-8")
        .header("content-length", file.size)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .send(file.contents);
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/reconstructions/:id/zip`,
    async (request, reply) => {
      const solution = solutionOf(reconstructions, request.params.id);
      if (solution instanceof RecoveredFileRefused) {
        return refuse(reply, solution.status, solution.message);
      }
      let zip;
      try {
        zip = await zipRecoveredSolution(solution);
      } catch (error) {
        if (error instanceof RecoveredFileRefused) {
          return refuse(reply, error.status, error.message);
        }
        throw error;
      }
      // Zipped as it is sent, so its length is not known until it has been.
      return reply
        .type("application/zip")
        .header("content-disposition", attachment(zip.fileName))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .send(zip.contents);
    },
  );
}

/**
 * A `Content-Disposition` that has a browser save the response as
 * `fileName`: in UTF-8 (RFC 6266, RFC 8187), and, for one that reads only
 * ASCII, with every other character `_`.
 */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * The Recovered Solution the Reconstruction with `id` wrote, or why there is
 * none to browse or download.
 */
function solutionOf(
  reconstructions: Reconstructions,
  id: string,
): RecoveredSolutionFiles | RecoveredFileRefused {
  const stream = reconstructions.get(id);
  return stream === undefined
    ? new RecoveredFileRefused(404, NO_SUCH_RECONSTRUCTION)
    : recoveredSolutionOf(stream);
}

const NO_SUCH_RECONSTRUCTION =
  "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.";

const NO_SUCH_UPLOAD =
  "There is no such upload: Xray has been restarted since it began, or it never did. Upload the Assembly again.";

/**
 * The Assembly `assembly` of the upload with id `upload`, as the absolute
 * path in the Workspace to reconstruct, once every file of it has arrived;
 * or why it cannot be.
 */
export function checkUploaded(
  uploads: Uploads,
  upload: unknown,
  assembly: unknown,
): string | UploadRefused {
  if (typeof upload !== "string" || typeof assembly !== "string") {
    return new UploadRefused(
      400,
      'Send the upload, and the Assembly in it to reconstruct, as JSON: {"upload": "…", "assembly": "…"}.',
    );
  }
  const uploaded = uploads.get(upload);
  if (uploaded === undefined) {
    return new UploadRefused(404, NO_SUCH_UPLOAD);
  }
  if (!uploaded.files.some((file) => file.path === assembly)) {
    return new UploadRefused(
      400,
      `"${assembly}" is not one of the files uploaded.`,
    );
  }
  if (uploaded.arrived < uploaded.files.length) {
    return new UploadRefused(
      409,
      `The upload has not finished: ${uploaded.arrived} of its ${uploaded.files.length} files have arrived. Reconstruct it once they all have.`,
    );
  }
  return uploaded.pathOf(assembly);
}

function isJson(contentType: string | undefined): boolean {
  return /^application\/json\s*(;|$)/i.test(contentType ?? "");
}

/** One event as a Server-Sent Event. */
export function formatEvent(id: number, event: ReconstructionEvent): string {
  // JSON.stringify writes no line breaks, so the data is one line.
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * The path the user gave, as the absolute path to reconstruct, without the
 * whitespace or quotes around it that copying it may bring; or why it cannot be.
 */
export function checkPath(path: unknown): string | ApiError {
  if (typeof path !== "string") {
    return { message: 'Send the Assembly\'s path as JSON: {"path": "…"}.' };
  }
  const trimmed = path.trim();
  // Windows' "Copy as path" puts it in double quotes.
  const unquoted = /^"(.*)"$/s.exec(trimmed)?.[1]?.trim() ?? trimmed;
  if (unquoted === "") {
    return {
      message:
        "Enter the path of an Assembly, or of a folder holding one, to reconstruct.",
    };
  }
  if (!isAbsolute(unquoted)) {
    return {
      message: `"${unquoted}" is not a full path. Enter the Assembly's full path, from the root of its ${process.platform === "win32" ? "drive, such as C:\\Apps\\MyApp.exe" : "file system, such as /home/me/MyApp.dll"}.`,
    };
  }
  return unquoted;
}

function refuse(reply: FastifyReply, status: number, message: string) {
  const error: ApiError = { message };
  return reply.code(status).type("application/json").send(error);
}
