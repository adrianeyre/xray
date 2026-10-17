// What the user chose to upload, by a picker or by dropping it, as a
// Selection: each file with its path from the chosen folder's parent, as
// every browser gives it, so the folder's structure is kept.

import type { SelectedFile, Selection } from "./upload-client.js";

/** What the user chose, or why it cannot be uploaded. */
export type Chosen = Selection | { readonly error: string };

const ONE_AT_A_TIME =
  "Choose one Assembly, or one folder holding one, at a time.";

/**
 * The files a file picker gave: one file from the file picker, or, from the
 * folder picker (`webkitdirectory`), every file in the folder, each with its
 * `webkitRelativePath`, which starts with the folder's name.
 */
export function chosenFromPicker(
  files: ArrayLike<File>,
  folder: boolean,
): Chosen | null {
  const all = Array.from(files);
  if (all.length === 0) {
    // The user closed the picker without choosing, or the folder is empty.
    return folder
      ? { error: "That folder is empty: choose a folder holding an Assembly." }
      : null;
  }
  if (!folder) {
    const [file] = all as [File, ...File[]];
    return all.length === 1
      ? { name: file.name, files: [{ path: file.name, file }] }
      : { error: ONE_AT_A_TIME };
  }
  const selected = all.map((file) => ({
    path: file.webkitRelativePath === "" ? file.name : file.webkitRelativePath,
    file,
  }));
  return { name: selected[0]?.path.split("/")[0] ?? "", files: selected };
}

/** The parts of a `FileSystemEntry` this reads, as each browser gives them for a drop. */
export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
}

/** A dropped file's entry. */
export interface FileEntryLike extends EntryLike {
  file(
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ): void;
}

/** A dropped folder's entry. */
export interface DirectoryEntryLike extends EntryLike {
  createReader(): {
    readEntries(
      success: (entries: EntryLike[]) => void,
      failure?: (error: DOMException) => void,
    ): void;
  };
}

/** The parts of a drop's `DataTransfer` this reads. */
export interface DropLike {
  readonly items?: ArrayLike<{
    readonly kind: string;
    webkitGetAsEntry?: () => EntryLike | null;
  }>;
  readonly files: ArrayLike<File>;
}

/**
 * What the user dropped: one file, or one folder with every file below it,
 * read through each item's entry (`webkitGetAsEntry`, in every browser
 * despite its name). Where there are no entries, only a single file can be
 * told from its `files`.
 */
export async function chosenFromDrop(drop: DropLike): Promise<Chosen> {
  // Entries must be taken before the drop's handler returns: the browser
  // empties its items after.
  const items = Array.from(drop.items ?? []).filter(
    (item) => item.kind === "file",
  );
  const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    const files = Array.from(drop.files);
    if (files.length === 0) {
      return { error: "Drop a file or a folder: that was neither." };
    }
    const [file] = files as [File, ...File[]];
    return files.length === 1
      ? { name: file.name, files: [{ path: file.name, file }] }
      : { error: ONE_AT_A_TIME };
  }
  if (entries.length !== 1) {
    return { error: ONE_AT_A_TIME };
  }
  const entry = entries[0] as EntryLike;
  try {
    if (!entry.isDirectory) {
      // The drop's own File, where it has it, can be read where its entry's
      // cannot always be (Safari).
      const file =
        drop.files.length === 1
          ? (drop.files[0] as File)
          : await fileOf(entry as FileEntryLike);
      return { name: entry.name, files: [{ path: entry.name, file }] };
    }
    const files = await filesIn(entry as DirectoryEntryLike, entry.name);
    if (files.length === 0) {
      return {
        error: `${entry.name} is empty: drop a folder holding an Assembly.`,
      };
    }
    return { name: entry.name, files };
  } catch {
    return {
      error: `Could not read what was dropped (${entry.name}): check you have permission to read it, or choose it with a picker instead.`,
    };
  }
}

function fileOf(entry: FileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Every file below `folder`, whose path is `path`, each with its path. */
async function filesIn(
  folder: DirectoryEntryLike,
  path: string,
): Promise<SelectedFile[]> {
  const reader = folder.createReader();
  const entries: EntryLike[] = [];
  // Each read gives only some of the entries (100 at a time in Chrome), and
  // none once all have been given.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) {
      break;
    }
    entries.push(...batch);
  }
  const files: SelectedFile[] = [];
  for (const entry of entries) {
    const entryPath = `${path}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...(await filesIn(entry as DirectoryEntryLike, entryPath)));
    } else if (entry.isFile) {
      files.push({
        path: entryPath,
        file: await fileOf(entry as FileEntryLike),
      });
    }
  }
  return files;
}
