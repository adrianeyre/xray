import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  formatSize,
  type FolderNode,
  type TreeNode,
} from "./file-tree.js";

/** Each folder and file of `folder`, depth first, indented by how deep it is. */
function outline(folder: FolderNode, depth = 0): string[] {
  return folder.children.flatMap((child: TreeNode) =>
    child.kind === "folder"
      ? [`${"  ".repeat(depth)}${child.name}/`, ...outline(child, depth + 1)]
      : [`${"  ".repeat(depth)}${child.name}`],
  );
}

describe("buildFileTree", () => {
  it("makes the arithmetic Recovered Solution's tree: each folder's folders, then its files", () => {
    const tree = buildFileTree([
      { path: "Arithmetic.sln", size: 1 },
      { path: "Arithmetic/Arithmetic.csproj", size: 2 },
      { path: "Arithmetic/Properties/AssemblyInfo.cs", size: 3 },
      { path: "Arithmetic/Program.cs", size: 4 },
      { path: "xray-report.json", size: 5 },
    ]);

    expect(outline(tree)).toEqual([
      "Arithmetic/",
      "  Properties/",
      "    AssemblyInfo.cs",
      "  Arithmetic.csproj",
      "  Program.cs",
      "Arithmetic.sln",
      "xray-report.json",
    ]);
    expect(tree).toMatchObject({ kind: "folder", name: "", path: "" });
    expect(tree.children[0]).toMatchObject({
      kind: "folder",
      name: "Arithmetic",
      path: "Arithmetic",
    });
    expect((tree.children[0] as FolderNode).children[0]).toMatchObject({
      path: "Arithmetic/Properties",
    });
    expect((tree.children[0] as FolderNode).children[2]).toEqual({
      kind: "file",
      name: "Program.cs",
      path: "Arithmetic/Program.cs",
      size: 4,
    });
  });

  it("sorts names as a file manager does: capitals and small letters together, and numbers by their value", () => {
    const tree = buildFileTree(
      ["b.cs", "A.cs", "Type10.cs", "Type2.cs", "a/x.cs", "B/y.cs"].map(
        (path) => ({ path, size: 0 }),
      ),
    );

    expect(outline(tree)).toEqual([
      "a/",
      "  x.cs",
      "B/",
      "  y.cs",
      "A.cs",
      "b.cs",
      "Type2.cs",
      "Type10.cs",
    ]);
  });

  it("makes an empty tree of no files", () => {
    expect(buildFileTree([])).toEqual({
      kind: "folder",
      name: "",
      path: "",
      children: [],
    });
  });
});

describe("formatSize", () => {
  it("gives bytes, KiB or MiB", () => {
    expect(
      [0, 1, 850, 1023, 1024, 4300, 1024 * 1024 - 1, 1.5 * 1024 * 1024].map(
        formatSize,
      ),
    ).toEqual([
      "0 bytes",
      "1 byte",
      "850 bytes",
      "1023 bytes",
      "1.0 KiB",
      "4.2 KiB",
      "1024.0 KiB",
      "1.5 MiB",
    ]);
  });
});
