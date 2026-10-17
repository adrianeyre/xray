import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseInputAssembly,
  inputAssemblyAt,
} from "./choose-input-assembly.js";
import { InputError } from "./input-error.js";

describe("chooseInputAssembly", () => {
  it("chooses a single file, whatever its name, for classifying it to explain", () => {
    expect(chooseInputAssembly(["MyApp.dll"])).toEqual({
      assemblies: ["MyApp.dll"],
      assembly: "MyApp.dll",
    });
    expect(chooseInputAssembly(["notes.txt"])).toEqual({
      assemblies: ["notes.txt"],
      assembly: "notes.txt",
    });
  });

  it("chooses a folder's only Assembly, beside the files built with it", () => {
    expect(
      chooseInputAssembly([
        "Arithmetic/Arithmetic.deps.json",
        "Arithmetic/Arithmetic.dll",
        "Arithmetic/Arithmetic.pdb",
        "Arithmetic/Arithmetic.runtimeconfig.json",
      ]),
    ).toEqual({
      assemblies: ["Arithmetic/Arithmetic.dll"],
      assembly: "Arithmetic/Arithmetic.dll",
    });
  });

  it("chooses a .NET application's DLL over the native launcher beside it, and its libraries", () => {
    expect(
      chooseInputAssembly([
        "MyApp/MyApp.exe",
        "MyApp/MyApp.dll",
        "MyApp/MyApp.runtimeconfig.json",
        "MyApp/Newtonsoft.Json.dll",
        "MyApp/MyApp.Core.dll",
      ]),
    ).toEqual({
      assemblies: [
        "MyApp/MyApp.Core.dll",
        "MyApp/MyApp.dll",
        "MyApp/MyApp.exe",
        "MyApp/Newtonsoft.Json.dll",
      ],
      assembly: "MyApp/MyApp.dll",
    });
  });

  it("matches a runtimeconfig to its DLL whatever their case, and only in the same folder", () => {
    expect(
      chooseInputAssembly([
        "App/MYAPP.DLL",
        "App/myapp.runtimeconfig.json",
        "App/Other.dll",
      ]).assembly,
    ).toBe("App/MYAPP.DLL");
    expect(
      chooseInputAssembly([
        "App/MyApp.dll",
        "App/tools/MyApp.runtimeconfig.json",
        "App/Other.dll",
      ]).assembly,
    ).toBeNull();
  });

  it("chooses a .NET Framework application's .exe over its DLLs", () => {
    expect(
      chooseInputAssembly([
        "Legacy/Legacy.exe",
        "Legacy/Legacy.exe.config",
        "Legacy/Legacy.Data.dll",
        "Legacy/log4net.dll",
      ]).assembly,
    ).toBe("Legacy/Legacy.exe");
  });

  it("leaves the choice to the user when the files do not say which, listing the shallowest first", () => {
    expect(
      chooseInputAssembly([
        "Libs/plugins/Plugin.dll",
        "Libs/Beta.dll",
        "Libs/alpha.DLL",
        "Libs/README.md",
      ]),
    ).toEqual({
      assemblies: [
        "Libs/alpha.DLL",
        "Libs/Beta.dll",
        "Libs/plugins/Plugin.dll",
      ],
      assembly: null,
    });
    expect(
      chooseInputAssembly(["Tools/One.exe", "Tools/Two.exe"]).assembly,
    ).toBeNull();
  });

  it("chooses none from a folder holding no Assembly", () => {
    expect(chooseInputAssembly(["Docs/a.txt", "Docs/b.txt"])).toEqual({
      assemblies: [],
      assembly: null,
    });
  });
});

describe("inputAssemblyAt", () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(
      temporary
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  /** A folder holding an empty file at each path, relative to it with `/` between segments. */
  async function folderOf(...paths: string[]): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "xray-input-"));
    temporary.push(folder);
    for (const path of paths) {
      const file = join(folder, ...path.split("/"));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "");
    }
    return folder;
  }

  it("gives a file, or nothing, as it is, for classifying it to explain", async () => {
    const folder = await folderOf("MyApp.dll");

    expect(await inputAssemblyAt(join(folder, "MyApp.dll"))).toBe(
      join(folder, "MyApp.dll"),
    );
    expect(await inputAssemblyAt(join(folder, "Missing.dll"))).toBe(
      join(folder, "Missing.dll"),
    );
  });

  it("chooses a folder's application, in it or a subfolder, as chooseInputAssembly does", async () => {
    const folder = await folderOf(
      "readme.txt",
      "bin/MyApp.dll",
      "bin/MyApp.runtimeconfig.json",
      "bin/Inventory.dll",
    );

    expect(await inputAssemblyAt(folder)).toBe(
      join(folder, "bin", "MyApp.dll"),
    );
  });

  it("rejects a folder with no Assembly in it, or several and nothing saying which", async () => {
    const empty = await folderOf("readme.txt", "notes.md");
    const several = await folderOf("A.dll", "B.dll", "Tools/C.dll");

    await expect(inputAssemblyAt(empty)).rejects.toThrow(
      new InputError(
        "no-assembly-in-folder",
        `${empty} is a folder with no .exe or .dll file in it to reconstruct; give the path of an Assembly, or of the folder holding one.`,
      ),
    );
    await expect(inputAssemblyAt(several)).rejects.toMatchObject({
      code: "assembly-not-chosen",
      message: `${several} is a folder with 3 .exe and .dll files in it, and nothing in it says which is the application's; give the path of the one to reconstruct: A.dll, B.dll, Tools/C.dll.`,
    });
  });

  it("lists at most ten of a folder's Assemblies", async () => {
    const folder = await folderOf(
      ...Array.from(
        { length: 12 },
        (_, i) => `Lib${String(i).padStart(2, "0")}.dll`,
      ),
    );

    await expect(inputAssemblyAt(folder)).rejects.toThrow(
      /: Lib00\.dll, .*, Lib09\.dll and 2 more\.$/,
    );
  });
});
