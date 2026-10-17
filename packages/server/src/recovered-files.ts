import { createReadStream, type ReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";

import type { ReconstructionStream } from "./reconstructions.js";
import { fitsInZip, zipStream, type ZipEntry } from "./zip.js";

/** One file of a Recovered Solution, as the server lists it. */
export interface RecoveredFile {
  /** Its path in the Recovered Solution, with `/` between names. */
  readonly path: string;
  /** How many bytes it is. */
  readonly size: number;
}

/** Why the server will not list or send a Recovered Solution's files, with the status to answer. */
export class RecoveredFileRefused extends Error {
  override readonly name = "RecoveredFileRefused";
  readonly status: 404 | 409 | 413;

  constructor(status: 404 | 409 | 413, message: string) {
    super(message);
    this.status = status;
  }
}

/** The Recovered Solution a Reconstruction wrote: where, and its files. */
export interface RecoveredSolutionFiles {
  /** Its folder, in the session's Workspace. */
  readonly directory: string;
  /** Its `.sln`, relative to {@link directory}, with `/` between names. */
  readonly solutionPath: string;
  /**
   * Every file the Reconstruction wrote, as @xray/core lists them, relative
   * to {@link directory} with `/` between names: not what `dotnet build`
   * made beside them in `bin/` and `obj/`.
   */
  readonly files: readonly string[];
}

/**
 * The Recovered Solution the Reconstruction of `stream` wrote; or why there
 * is none to browse, yet or at all.
 */
export function recoveredSolutionOf(
  stream: ReconstructionStream,
): RecoveredSolutionFiles | RecoveredFileRefused {
  const { end } = stream;
  if (end === null) {
    return new RecoveredFileRefused(
      409,
      "The Reconstruction has not finished. Its files can be browsed, and downloaded, once it has.",
    );
  }
  if (end.kind !== "reconstructed") {
    return new RecoveredFileRefused(
      404,
      "The Reconstruction wrote no Recovered Solution, so there are no files to browse or download.",
    );
  }
  const { solutionPath, files } = end.report.solution;
  return { directory: end.directory, solutionPath, files };
}

/**
 * Every file of `solution`, each with its size, in the order @xray/core
 * listed them; leaving out any no longer there.
 */
export async function listRecoveredFiles(
  solution: RecoveredSolutionFiles,
): Promise<RecoveredFile[]> {
  const listed = await Promise.all(
    solution.files.map(async (path) => {
      const found = await find(solution, path);
      return found === undefined ? [] : [{ path, size: found.size }];
    }),
  );
  return listed.flat();
}

/**
 * Opens the file at `path` in `solution` to be read, and nothing else: it
 * must be one of the files the Reconstruction wrote, and, links followed,
 * still lie within its folder in the Workspace. Throws a
 * {@link RecoveredFileRefused} otherwise.
 */
export async function openRecoveredFile(
  solution: RecoveredSolutionFiles,
  path: string,
): Promise<{ readonly size: number; readonly contents: ReadStream }> {
  const found = await find(solution, path);
  if (found === undefined) {
    throw new RecoveredFileRefused(
      404,
      `There is no file "${path}" in the Recovered Solution.`,
    );
  }
  return { size: found.size, contents: createReadStream(found.realPath) };
}

/** A Recovered Solution as a zip archive, to download. */
export interface RecoveredSolutionZip {
  /** What to name the archive: its solution's name, then `.zip`. */
  readonly fileName: string;
  /** The archive, made as it is read. */
  readonly contents: Readable;
}

/**
 * Every file of `solution`, in the order @xray/core listed them, in a zip
 * archive (FR-23), each in a folder named after its solution, so extracting
 * it makes one folder, that `dotnet build` builds. As with
 * {@link openRecoveredFile}, it holds only the files the Reconstruction
 * wrote, within its folder, so nothing `dotnet build` made beside them in
 * `bin/` and `obj/`; leaving out any no longer there. Throws a
 * {@link RecoveredFileRefused} if they are too many, or too large, for one.
 */
export async function zipRecoveredSolution(
  solution: RecoveredSolutionFiles,
): Promise<RecoveredSolutionZip> {
  const name = basename(solution.solutionPath).replace(/\.sln$/i, "");
  const entries: ZipEntry[] = (
    await Promise.all(
      solution.files.map(async (path) => {
        const found = await find(solution, path);
        return found === undefined
          ? []
          : [
              {
                name: `${name}/${path}`,
                path: found.realPath,
                size: found.size,
                modified: found.modified,
              },
            ];
      }),
    )
  ).flat();
  if (!fitsInZip(entries)) {
    throw new RecoveredFileRefused(
      413,
      `The Recovered Solution is too large to download as a zip archive. It is in ${solution.directory}, until Xray stops.`,
    );
  }
  return { fileName: `${name}.zip`, contents: zipStream(entries) };
}

/**
 * The file at `path` in `solution`, by its real path, size and when it was
 * last changed, if it is one of its files and is there, a file, within its
 * folder.
 */
async function find(
  solution: RecoveredSolutionFiles,
  path: string,
): Promise<
  | {
      readonly realPath: string;
      readonly size: number;
      readonly modified: Date;
    }
  | undefined
> {
  // Only a path the Reconstruction listed is ever joined to its folder, so
  // no path a request gives, such as one with `..` in it, can lead outside.
  if (!solution.files.includes(path)) {
    return undefined;
  }
  try {
    const [realFolder, realPath] = await Promise.all([
      realpath(solution.directory),
      realpath(join(solution.directory, ...path.split("/"))),
    ]);
    // Nor can a link put there since.
    const inside = relative(realFolder, realPath);
    if (
      inside === "" ||
      inside === ".." ||
      inside.startsWith(`..${sep}`) ||
      isAbsolute(inside)
    ) {
      return undefined;
    }
    const stats = await stat(realPath);
    return stats.isFile()
      ? { realPath, size: stats.size, modified: stats.mtime }
      : undefined;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      return undefined;
    }
    throw error;
  }
}
