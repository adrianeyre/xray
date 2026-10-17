import type { RecoveredFile } from "./events.js";

/** A file of the Recovered Solution, in its tree. */
export interface FileNode {
  readonly kind: "file";
  /** Its own name. */
  readonly name: string;
  /** Its path in the Recovered Solution, with `/` between names. */
  readonly path: string;
  readonly size: number;
}

/** A folder of the Recovered Solution, in its tree. */
export interface FolderNode {
  readonly kind: "folder";
  /** Its own name; `""` for the Recovered Solution's own folder. */
  readonly name: string;
  /** Its path in the Recovered Solution, with `/` between names; `""` for its own folder. */
  readonly path: string;
  /** Its folders, then its files, each by name. */
  readonly children: readonly TreeNode[];
}

export type TreeNode = FileNode | FolderNode;

// The same order on every machine, whatever its language: capitals and small
// letters together, and numbers by their value, as a file manager sorts them.
const byName = new Intl.Collator("en", { numeric: true });

/**
 * The tree of folders and files that `files`, by their paths, make: the
 * Recovered Solution's own folder, holding its folders, then its files,
 * each by name.
 */
export function buildFileTree(files: readonly RecoveredFile[]): FolderNode {
  interface Building {
    readonly folders: Map<string, Building>;
    readonly files: FileNode[];
  }
  const root: Building = { folders: new Map(), files: [] };
  for (const { path, size } of files) {
    const names = path.split("/");
    let folder = root;
    for (const name of names.slice(0, -1)) {
      let next = folder.folders.get(name);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        folder.folders.set(name, next);
      }
      folder = next;
    }
    folder.files.push({ kind: "file", name: names.at(-1) ?? path, path, size });
  }
  const finish = (name: string, path: string, built: Building): FolderNode => ({
    kind: "folder",
    name,
    path,
    children: [
      ...[...built.folders]
        .sort(([a], [b]) => byName.compare(a, b))
        .map(([child, folder]) =>
          finish(child, path === "" ? child : `${path}/${child}`, folder),
        ),
      ...built.files.sort((a, b) => byName.compare(a.name, b.name)),
    ],
  });
  return finish("", "", root);
}

/** `850 bytes`, `4.2 KiB` or `1.5 MiB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
