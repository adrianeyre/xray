// Which file a Reconstruction of a folder starts from: the application's own
// Assembly, where its files make that plain. The Sibling Assemblies beside it
// that it references are reconstructed with it.

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { InputError } from "./input-error.js";

/** The Assemblies in a set of files, and which of them a Reconstruction starts from. */
export interface InputAssemblyChoice {
  /** The files that may be Assemblies: each `.exe` and `.dll`, in order. */
  readonly assemblies: readonly string[];
  /**
   * The one to reconstruct, as given; `null` if the files do not say which,
   * so the user must choose from {@link assemblies}.
   */
  readonly assembly: string | null;
}

const ASSEMBLY = /\.(exe|dll)$/i;

/**
 * Chooses the file to reconstruct from `paths`, the files of a folder,
 * relative to it with `/` between segments; or from a single file, whatever
 * its name, which classifying it will explain. In a folder, it is:
 *
 * 1. its only `.exe` or `.dll`;
 * 2. else, its only `.dll` with a `.runtimeconfig.json` of the same name
 *    beside it: a .NET Core or .NET 5+ application, whose `.exe`, if it has
 *    one, is a native launcher;
 * 3. else, its only `.exe`: a .NET Framework application, beside its DLLs;
 * 4. else, none: the user must choose.
 */
export function chooseInputAssembly(
  paths: readonly string[],
): InputAssemblyChoice {
  if (paths.length === 1) {
    return { assemblies: paths, assembly: paths[0] ?? null };
  }
  const assemblies = paths
    .filter((path) => ASSEMBLY.test(path))
    .toSorted(byPath);
  const runtimeConfigs = new Set(
    paths
      .filter((path) => /\.runtimeconfig\.json$/i.test(path))
      .map((path) =>
        path.slice(0, -".runtimeconfig.json".length).toLowerCase(),
      ),
  );
  const assembly =
    only(assemblies) ??
    only(
      assemblies.filter(
        (path) =>
          /\.dll$/i.test(path) &&
          runtimeConfigs.has(path.slice(0, -".dll".length).toLowerCase()),
      ),
    ) ??
    only(assemblies.filter((path) => /\.exe$/i.test(path)));
  return { assemblies, assembly };
}

function only(paths: readonly string[]): string | null {
  return paths.length === 1 ? (paths[0] ?? null) : null;
}

/** Shallower first, so an application's own files come before its subfolders'; then by name. */
function byPath(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  return depth !== 0 ? depth : a.localeCompare(b, "en");
}

// How many of a folder's Assemblies an error lists.
const LISTED_ASSEMBLIES = 10;

/**
 * The Assembly to reconstruct at `path` (absolute): `path` itself, unless it
 * is a folder, when it is the Assembly {@link chooseInputAssembly} chooses
 * from every file in it and its subfolders. Rejects with an
 * {@link InputError} if the folder holds no `.exe` or `.dll`, or holds several
 * and its files do not say which to reconstruct.
 */
export async function inputAssemblyAt(path: string): Promise<string> {
  const isFolder = await stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isFolder) {
    return path;
  }
  const entries = await readdir(path, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(path, join(entry.parentPath, entry.name)).split(sep).join("/"),
    );
  const { assemblies, assembly } = chooseInputAssembly(files);
  if (assembly !== null) {
    return join(path, ...assembly.split("/"));
  }
  if (assemblies.length === 0) {
    throw new InputError(
      "no-assembly-in-folder",
      `${path} is a folder with no .exe or .dll file in it to reconstruct; give the path of an Assembly, or of the folder holding one.`,
    );
  }
  const listed = assemblies.slice(0, LISTED_ASSEMBLIES).join(", ");
  const unlisted = assemblies.length - LISTED_ASSEMBLIES;
  throw new InputError(
    "assembly-not-chosen",
    `${path} is a folder with ${assemblies.length} .exe and .dll files in it, and nothing in it says which is the application's; give the path of the one to reconstruct: ${listed}${unlisted > 0 ? ` and ${unlisted} more` : ""}.`,
  );
}
