import { describe, expect, it } from "vitest";

import type { AssemblySummary } from "../inspect/assembly-summary.js";
import type { PackageSource } from "./package-sources.js";
import {
  findReferencePack,
  referencePackFor,
  type ReferencePack,
} from "./reference-packs.js";

const FORMS = {
  name: "System.Windows.Forms",
  version: "4.0.0.0",
  culture: null,
  publicKeyToken: "b77a5c561934e089",
};

const WPF = {
  name: "PresentationFramework",
  version: "4.0.0.0",
  culture: null,
  publicKeyToken: "31bf3856ad364e35",
};

/** A Windows Forms app for `moniker`, or one referencing only `references`. */
function app(moniker: string | null, references = [FORMS]): AssemblySummary {
  return {
    path: "/abs/Greeter.exe",
    assembly: {
      name: "Greeter",
      version: "1.0.0.0",
      culture: null,
      publicKeyToken: null,
    },
    targetFramework: {
      moniker,
      frameworkName: null,
      runtimeVersion: "v4.0.30319",
      inferredFrom: null,
      support: "full",
    },
    architecture: {
      platformTarget: "AnyCPU",
      prefer32Bit: false,
      bitness: "any",
      machine: "I386",
    },
    entryPoint: { type: "Greeter.Program", method: "Main" },
    outputKind: "winforms",
    references,
    counts: { types: 1, methods: 1, resources: 0 },
    pdb: { status: "none" },
    obfuscation: { status: "clean", indicators: [] },
  };
}

describe("referencePackFor", () => {
  it("is .NET's Windows Desktop framework's for its version, off Windows, for a .NET app using Windows Forms", () => {
    expect(referencePackFor(app("net8.0-windows7.0"), "linux")).toEqual({
      id: "Microsoft.WindowsDesktop.App.Ref",
      versionPrefix: "8.0.",
      preferredVersion: null,
      folder: "ref/net8.0",
      holds: "Windows Forms for .NET 8.0",
    });
    expect(referencePackFor(app("netcoreapp3.1"), "darwin")).toMatchObject({
      versionPrefix: "3.1.",
      folder: "ref/netcoreapp3.1",
      holds: "Windows Forms for .NET Core 3.1",
    });
  });

  it("is .NET Framework's for its version, off Windows, for a .NET Framework app using Windows Forms", () => {
    expect(referencePackFor(app("net48"), "linux")).toEqual({
      id: "Microsoft.NETFramework.ReferenceAssemblies.net48",
      versionPrefix: null,
      preferredVersion: "1.0.3",
      folder: "build/.NETFramework/v4.8",
      holds: "Windows Forms for .NET Framework 4.8",
    });
    expect(referencePackFor(app("net472"), "darwin")).toMatchObject({
      id: "Microsoft.NETFramework.ReferenceAssemblies.net472",
      folder: "build/.NETFramework/v4.7.2",
    });
  });

  it("is the same, off Windows, for an app using WPF, or both", () => {
    expect(referencePackFor(app("net8.0-windows7.0", [WPF]), "linux")).toEqual({
      id: "Microsoft.WindowsDesktop.App.Ref",
      versionPrefix: "8.0.",
      preferredVersion: null,
      folder: "ref/net8.0",
      holds: "WPF for .NET 8.0",
    });
    expect(
      referencePackFor(app("net48", [FORMS, WPF]), "darwin"),
    ).toMatchObject({
      id: "Microsoft.NETFramework.ReferenceAssemblies.net48",
      holds: "Windows Forms and WPF for .NET Framework 4.8",
    });
    expect(
      referencePackFor(app("net8.0-windows7.0", [WPF]), "win32"),
    ).toBeNull();
  });

  it("is none on Windows, which has both frameworks", () => {
    expect(referencePackFor(app("net8.0-windows7.0"), "win32")).toBeNull();
    expect(referencePackFor(app("net48"), "win32")).toBeNull();
  });

  it("is none for an Assembly that uses neither Windows Forms nor WPF, or whose framework has no such pack", () => {
    expect(referencePackFor(app("net8.0", []), "linux")).toBeNull();
    expect(referencePackFor(app("net48", []), "linux")).toBeNull();
    expect(referencePackFor(app(null), "linux")).toBeNull();
    expect(referencePackFor(app("netcoreapp2.1"), "linux")).toBeNull();
    expect(referencePackFor(app("net40-client"), "linux")).toBeNull();
  });
});

describe("findReferencePack", () => {
  const desktop = referencePackFor(
    app("net8.0-windows7.0"),
    "linux",
  ) as ReferencePack;
  const framework = referencePackFor(app("net48"), "linux") as ReferencePack;

  /** A source holding `versions` of every package, each with every folder, recording what it is asked. */
  function holding(
    name: PackageSource["name"],
    versions: readonly string[],
    asked: string[] = [],
  ): PackageSource {
    return {
      name,
      remote: name === "nuget.org",
      versions: (id) => {
        asked.push(`versions ${id}`);
        return Promise.resolve(versions);
      },
      assemblies: () => Promise.reject(new Error("not expected")),
      folder: (id, version, folder) => {
        asked.push(`folder ${id} ${version} ${folder}`);
        return Promise.resolve(`/${name}/${id}/${version}/${folder}`);
      },
    };
  }

  it("takes the latest stable version that will do from the first source that has one", async () => {
    const asked: string[] = [];

    const found = await findReferencePack(desktop, [
      holding("global-packages", ["9.0.1", "7.0.20"]),
      holding(
        "nuget.org",
        ["8.0.0", "8.0.31", "8.0.4", "8.0.40-preview.1", "9.0.0"],
        asked,
      ),
    ]);

    expect(found).toEqual({
      version: "8.0.31",
      folder: "/nuget.org/Microsoft.WindowsDesktop.App.Ref/8.0.31/ref/net8.0",
    });
    expect(asked).toEqual([
      "versions Microsoft.WindowsDesktop.App.Ref",
      "folder Microsoft.WindowsDesktop.App.Ref 8.0.31 ref/net8.0",
    ]);
  });

  it("asks no later source once one has it", async () => {
    const asked: string[] = [];

    const found = await findReferencePack(framework, [
      holding("global-packages", ["1.0.2", "1.0.3"]),
      holding("nuget.org", ["1.0.3"], asked),
    ]);

    expect(found).toEqual({
      version: "1.0.3",
      folder:
        "/global-packages/Microsoft.NETFramework.ReferenceAssemblies.net48/1.0.3/build/.NETFramework/v4.8",
    });
    expect(asked).toEqual([]);
  });

  it("prefers the version a project references, and else takes the latest", async () => {
    expect(
      await findReferencePack(framework, [
        holding("global-packages", ["1.0.0", "1.0.3", "1.0.4"]),
      ]),
    ).toMatchObject({ version: "1.0.3" });
    expect(
      await findReferencePack(framework, [
        holding("global-packages", ["1.0.0", "1.0.2"]),
      ]),
    ).toMatchObject({ version: "1.0.2" });
  });

  it("is null when no source has it, and rejects when one cannot be asked", async () => {
    expect(
      await findReferencePack(desktop, [holding("global-packages", [])]),
    ).toBeNull();
    await expect(
      findReferencePack(desktop, [
        holding("global-packages", []),
        {
          ...holding("nuget.org", []),
          versions: () =>
            Promise.reject(
              new Error("nuget.org could not be asked: fetch failed"),
            ),
        },
      ]),
    ).rejects.toThrow("nuget.org could not be asked: fetch failed");
  });
});
