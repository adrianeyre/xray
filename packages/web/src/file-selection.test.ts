// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  chosenFromDrop,
  chosenFromPicker,
  type DirectoryEntryLike,
  type DropLike,
  type EntryLike,
  type FileEntryLike,
} from "./file-selection.js";
import type { Selection } from "./upload-client.js";

/** A file as the folder picker gives it, with its path from the folder's parent. */
function inFolder(path: string, contents = "MZ"): File {
  const file = new File([contents], path.split("/").at(-1) ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

/** A dropped file's entry. */
function fileEntry(name: string, contents = "MZ"): FileEntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(new File([contents], name)),
  };
}

/** A dropped folder's entry, giving its entries `batch` at a time, as Chrome gives 100. */
function folderEntry(
  name: string,
  entries: EntryLike[],
  batch = 100,
): DirectoryEntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let given = 0;
      return {
        readEntries: (success) => {
          const next = entries.slice(given, given + batch);
          given += next.length;
          // Asynchronously, as browsers do.
          setTimeout(() => success(next), 0);
        },
      };
    },
  };
}

function dropOf(entries: (EntryLike | null)[], files: File[] = []): DropLike {
  return {
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
    })),
    files,
  };
}

function pathsOf(chosen: unknown): string[] {
  return (chosen as Selection).files.map(({ path }) => path);
}

describe("chosenFromPicker", () => {
  it("takes the one file the file picker gave, by its name", () => {
    const file = new File(["MZ"], "MyApp.exe");

    expect(chosenFromPicker([file], false)).toEqual({
      name: "MyApp.exe",
      files: [{ path: "MyApp.exe", file }],
    });
  });

  it("takes every file the folder picker gave, each by its path from the folder's parent", () => {
    const files = [
      inFolder("MyApp/MyApp.dll"),
      inFolder("MyApp/MyApp.runtimeconfig.json"),
      inFolder("MyApp/de/MyApp.resources.dll"),
    ];

    const chosen = chosenFromPicker(files, true);

    expect(chosen).toMatchObject({ name: "MyApp" });
    expect(pathsOf(chosen)).toEqual([
      "MyApp/MyApp.dll",
      "MyApp/MyApp.runtimeconfig.json",
      "MyApp/de/MyApp.resources.dll",
    ]);
    expect((chosen as Selection).files[2]?.file).toBe(files[2]);
  });

  it("takes nothing when the user closed the picker, and says so of an empty folder", () => {
    expect(chosenFromPicker([], false)).toBeNull();
    expect(chosenFromPicker([], true)).toEqual({
      error: "That folder is empty: choose a folder holding an Assembly.",
    });
  });

  it("refuses more than one file at a time", () => {
    expect(
      chosenFromPicker(
        [new File([""], "a.dll"), new File([""], "b.dll")],
        false,
      ),
    ).toEqual({
      error: "Choose one Assembly, or one folder holding one, at a time.",
    });
  });
});

describe("chosenFromDrop", () => {
  it("takes a dropped file, by its name", async () => {
    const chosen = await chosenFromDrop(dropOf([fileEntry("MyApp.dll")]));

    expect(chosen).toMatchObject({ name: "MyApp.dll" });
    expect(pathsOf(chosen)).toEqual(["MyApp.dll"]);
    expect(await (chosen as Selection).files[0]?.file.text()).toBe("MZ");
  });

  it("takes a dropped file from the drop's files where it has it, whose entry may not read", async () => {
    const file = new File(["MZ"], "MyApp.dll");
    const unreadable: FileEntryLike = {
      ...fileEntry("MyApp.dll"),
      file: (_success, failure) =>
        failure?.(new DOMException("Not found", "NotFoundError")),
    };

    expect(await chosenFromDrop(dropOf([unreadable], [file]))).toEqual({
      name: "MyApp.dll",
      files: [{ path: "MyApp.dll", file }],
    });
  });

  it("takes every file below a dropped folder, however deep, keeping its structure", async () => {
    const chosen = await chosenFromDrop(
      dropOf([
        folderEntry("MyApp", [
          fileEntry("MyApp.dll"),
          folderEntry("de", [fileEntry("MyApp.resources.dll")]),
          folderEntry("empty", []),
          folderEntry("runtimes", [
            folderEntry("win-x64", [
              folderEntry("native", [fileEntry("e_sqlite3.dll")]),
            ]),
          ]),
        ]),
      ]),
    );

    expect(chosen).toMatchObject({ name: "MyApp" });
    expect(pathsOf(chosen)).toEqual([
      "MyApp/MyApp.dll",
      "MyApp/de/MyApp.resources.dll",
      "MyApp/runtimes/win-x64/native/e_sqlite3.dll",
    ]);
  });

  it("reads a folder's entries until there are none left, as browsers give them a batch at a time", async () => {
    const entries = Array.from({ length: 250 }, (_, index) =>
      fileEntry(`Library${index}.dll`),
    );

    const chosen = await chosenFromDrop(
      dropOf([folderEntry("Big", entries, 100)]),
    );

    expect(pathsOf(chosen)).toHaveLength(250);
    expect(pathsOf(chosen).at(-1)).toBe("Big/Library249.dll");
  });

  it("refuses more than one thing dropped at a time", async () => {
    expect(
      await chosenFromDrop(dropOf([fileEntry("a.dll"), fileEntry("b.dll")])),
    ).toEqual({
      error: "Choose one Assembly, or one folder holding one, at a time.",
    });
  });

  it("says so of an empty folder, and of one it cannot read", async () => {
    expect(await chosenFromDrop(dropOf([folderEntry("Nothing", [])]))).toEqual({
      error: "Nothing is empty: drop a folder holding an Assembly.",
    });
    const unreadable: DirectoryEntryLike = {
      ...folderEntry("Locked", []),
      createReader: () => ({
        readEntries: (_success, failure) =>
          failure?.(new DOMException("Denied", "NotReadableError")),
      }),
    };
    expect(await chosenFromDrop(dropOf([unreadable]))).toEqual({
      error:
        "Could not read what was dropped (Locked): check you have permission to read it, or choose it with a picker instead.",
    });
  });

  it("takes a single file from the drop's files where it has no entries", async () => {
    const file = new File(["MZ"], "MyApp.exe");

    expect(await chosenFromDrop({ files: [file] })).toEqual({
      name: "MyApp.exe",
      files: [{ path: "MyApp.exe", file }],
    });
    expect(await chosenFromDrop(dropOf([null], [file]))).toEqual({
      name: "MyApp.exe",
      files: [{ path: "MyApp.exe", file }],
    });
    expect(await chosenFromDrop({ files: [] })).toEqual({
      error: "Drop a file or a folder: that was neither.",
    });
  });

  it("ignores what was dropped that is not a file, such as text", async () => {
    const drop: DropLike = {
      items: [
        { kind: "string" },
        { kind: "file", webkitGetAsEntry: () => fileEntry("MyApp.dll") },
      ],
      files: [],
    };

    expect(pathsOf(await chosenFromDrop(drop))).toEqual(["MyApp.dll"]);
  });
});
