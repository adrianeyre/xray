import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AssemblyIdentity,
  AssemblySummary,
} from "../inspect/assembly-summary.js";
import {
  dotnetPacks,
  frameworkChecker,
  frameworkPacksFor,
  parseFrameworkList,
  type PackSource,
} from "./framework-assemblies.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-framework-"));
  temporary.push(folder);
  return folder;
}

const FORMS: AssemblyIdentity = {
  name: "System.Windows.Forms",
  version: "8.0.0.0",
  culture: null,
  publicKeyToken: "b77a5c561934e089",
};

/** A Microsoft-signed reference to `name` at `version`. */
function microsofts(name: string, version: string): AssemblyIdentity {
  return { name, version, culture: null, publicKeyToken: "b03f5f7f11d50a3a" };
}

/** An Assembly for `moniker`, referencing `references`. */
function app(
  moniker: string | null,
  references: readonly AssemblyIdentity[] = [],
): AssemblySummary {
  return {
    path: "/app/App.dll",
    assembly: {
      name: "App",
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
    entryPoint: null,
    outputKind: "library",
    references,
    counts: { types: 1, methods: 1, resources: 0 },
    pdb: { status: "none" },
    obfuscation: { status: "clean", indicators: [] },
  };
}

describe("frameworkPacksFor", () => {
  it("is .NET's targeting pack for its version, with its Windows Desktop framework's for an Assembly using Windows Forms or WPF", () => {
    expect(frameworkPacksFor(app("net8.0"))).toEqual([
      {
        id: "Microsoft.NETCore.App.Ref",
        versionPrefix: "8.0.",
        preferredVersion: null,
        folder: "data",
        list: "FrameworkList.xml",
        holds: ".NET 8.0",
      },
    ]);
    expect(frameworkPacksFor(app("netcoreapp3.1"))).toMatchObject([
      {
        id: "Microsoft.NETCore.App.Ref",
        versionPrefix: "3.1.",
        holds: ".NET Core 3.1",
      },
    ]);
    expect(frameworkPacksFor(app("net8.0-windows7.0", [FORMS]))).toMatchObject([
      { id: "Microsoft.NETCore.App.Ref", versionPrefix: "8.0." },
      {
        id: "Microsoft.WindowsDesktop.App.Ref",
        versionPrefix: "8.0.",
        folder: "data",
        list: "FrameworkList.xml",
        holds: "the Windows Desktop framework of .NET 8.0",
      },
    ]);
    expect(frameworkPacksFor(app("net8.0-windows7.0"))).toHaveLength(1);
  });

  it("is .NET Framework's reference assemblies' list for its version, and its Client Profile's", () => {
    expect(frameworkPacksFor(app("net48"))).toEqual([
      {
        id: "Microsoft.NETFramework.ReferenceAssemblies.net48",
        versionPrefix: null,
        preferredVersion: "1.0.3",
        folder: "build/.NETFramework/v4.8/RedistList",
        list: "FrameworkList.xml",
        holds: ".NET Framework 4.8",
      },
    ]);
    expect(frameworkPacksFor(app("net472"))).toMatchObject([
      {
        id: "Microsoft.NETFramework.ReferenceAssemblies.net472",
        folder: "build/.NETFramework/v4.7.2/RedistList",
      },
    ]);
    expect(frameworkPacksFor(app("net35"))).toMatchObject([
      {
        id: "Microsoft.NETFramework.ReferenceAssemblies.net35",
        folder: "build/.NETFramework/v3.5/RedistList",
      },
    ]);
    expect(frameworkPacksFor(app("net40-client"))).toMatchObject([
      {
        id: "Microsoft.NETFramework.ReferenceAssemblies.net40",
        folder: "build/.NETFramework/v4.0/Profile/Client/RedistList",
        holds: ".NET Framework 4.0 Client Profile",
      },
    ]);
  });

  it("is .NET Standard 2.1's list, and .NET Standard 2.0's reference assemblies themselves, which it lists nowhere", () => {
    expect(frameworkPacksFor(app("netstandard2.1"))).toEqual([
      {
        id: "NETStandard.Library.Ref",
        versionPrefix: "2.1.",
        preferredVersion: "2.1.0",
        folder: "data",
        list: "FrameworkList.xml",
        holds: ".NET Standard 2.1",
      },
    ]);
    expect(frameworkPacksFor(app("netstandard2.0"))).toEqual([
      {
        id: "NETStandard.Library",
        versionPrefix: "2.0.",
        preferredVersion: "2.0.3",
        folder: "build/netstandard2.0/ref",
        list: null,
        holds: ".NET Standard 2.0",
      },
    ]);
  });

  it("is none where the target framework could not be told, or Xray knows no pack for it", () => {
    expect(frameworkPacksFor(app(null))).toBeNull();
    expect(frameworkPacksFor(app("netcoreapp2.1"))).toBeNull();
    expect(frameworkPacksFor(app("netstandard1.6"))).toBeNull();
  });
});

describe("parseFrameworkList", () => {
  it("reads .NET's list, by AssemblyVersion, leaving out its analyzers", () => {
    expect(
      parseFrameworkList(
        [
          '<FileList TargetFrameworkIdentifier=".NETCoreApp" TargetFrameworkVersion="8.0" FrameworkName="Microsoft.NETCore.App" Name=".NET Runtime">',
          '  <File Type="Analyzer" Path="analyzers/dotnet/cs/System.Text.Json.SourceGeneration.dll" Language="cs" AssemblyName="System.Text.Json.SourceGeneration" PublicKeyToken="cc7b13ffcd2ddd51" AssemblyVersion="8.0.14.42015" FileVersion="8.0.14.42015" />',
          '  <File Type="Managed" Path="ref/net8.0/System.Runtime.dll" AssemblyName="System.Runtime" PublicKeyToken="b03f5f7f11d50a3a" AssemblyVersion="8.0.0.0" FileVersion="8.0.3126.42015" />',
          '  <File Type="Managed" Path="ref/net8.0/Microsoft.VisualBasic.Core.dll" AssemblyName="Microsoft.VisualBasic.Core" PublicKeyToken="b03f5f7f11d50a3a" AssemblyVersion="13.0.0.0" FileVersion="13.0.3126.42015" />',
          "</FileList>",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "System.Runtime", version: "8.0.0.0" },
      { name: "Microsoft.VisualBasic.Core", version: "13.0.0.0" },
    ]);
  });

  it("reads .NET Framework's list, by Version", () => {
    expect(
      parseFrameworkList(
        [
          '﻿<?xml version="1.0" encoding="utf-8"?>',
          '<FileList Redist="Microsoft-Windows-CLRCoreComp.4.8" Name=".NET Framework 4.8" RuntimeVersion="4.5" ToolsVersion="4.0" ShortName="Full">',
          '  <File AssemblyName="System.Net.Http" Version="4.2.0.0" PublicKeyToken="b03f5f7f11d50a3a" Culture="neutral" ProcessorArchitecture="MSIL" InGac="true" />',
          '  <File AssemblyName="netstandard" Version="2.0.0.0" PublicKeyToken="cc7b13ffcd2ddd51" Culture="neutral" ProcessorArchitecture="MSIL" InGac="true" />',
          "</FileList>",
        ].join("\r\n"),
      ),
    ).toEqual([
      { name: "System.Net.Http", version: "4.2.0.0" },
      { name: "netstandard", version: "2.0.0.0" },
    ]);
  });
});

describe("dotnetPacks", () => {
  /** A .NET installation at `root` whose packs folder holds `packs`, each at its versions. */
  async function installation(
    root: string,
    packs: Readonly<Record<string, readonly string[]>>,
  ): Promise<void> {
    for (const [id, versions] of Object.entries(packs)) {
      for (const version of versions) {
        const data = join(root, "packs", id, version, "data");
        await mkdir(data, { recursive: true });
        await writeFile(join(data, "FrameworkList.xml"), "<FileList />");
      }
    }
  }

  it("finds the packs in the packs folder beside each SDK's folder, ignoring the case of their ids", async () => {
    const [first, second] = [await scratch(), await scratch()];
    await installation(first, { "Microsoft.NETCore.App.Ref": ["8.0.31"] });
    await installation(second, {
      "Microsoft.NETCore.App.Ref": ["9.0.10"],
      "NETStandard.Library.Ref": ["2.1.0"],
    });
    const asked: string[] = [];
    const packs = dotnetPacks("/usr/bin/dotnet", (dotnetPath) => {
      asked.push(dotnetPath);
      return Promise.resolve([
        { version: "8.0.425", path: join(first, "sdk") },
        { version: "8.0.300", path: join(first, "sdk") },
        { version: "9.0.100", path: join(second, "sdk") },
      ]);
    });

    expect(await packs.versions("microsoft.netcore.app.ref")).toEqual([
      "8.0.31",
      "9.0.10",
    ]);
    expect(
      await packs.folder("Microsoft.NETCore.App.Ref", "9.0.10", "data"),
    ).toBe(
      join(second, "packs", "Microsoft.NETCore.App.Ref", "9.0.10", "data"),
    );
    expect(
      await packs.folder("Microsoft.NETCore.App.Ref", "8.0.31", "ref/net8.0"),
    ).toBeNull();
    expect(await packs.versions("Microsoft.WindowsDesktop.App.Ref")).toEqual(
      [],
    );
    // The SDKs are listed once, however often the packs are asked for.
    expect(asked).toEqual(["/usr/bin/dotnet"]);
  });

  it("has none where dotnet cannot be found, or cannot list its SDKs", async () => {
    expect(
      await dotnetPacks("dotnet", () => Promise.resolve(undefined)).versions(
        "Microsoft.NETCore.App.Ref",
      ),
    ).toEqual([]);
    expect(
      await dotnetPacks("dotnet", () =>
        Promise.reject(new Error("dotnet failed")),
      ).versions("Microsoft.NETCore.App.Ref"),
    ).toEqual([]);
  });
});

describe("frameworkChecker", () => {
  const NET8_LIST = [
    '<FileList Name=".NET Runtime">',
    '  <File Type="Managed" Path="ref/net8.0/System.Runtime.dll" AssemblyName="System.Runtime" PublicKeyToken="b03f5f7f11d50a3a" AssemblyVersion="8.0.0.0" />',
    '  <File Type="Managed" Path="ref/net8.0/System.Collections.Immutable.dll" AssemblyName="System.Collections.Immutable" PublicKeyToken="b03f5f7f11d50a3a" AssemblyVersion="8.0.0.0" />',
    "</FileList>",
  ].join("\n");
  const DESKTOP_LIST =
    '<FileList><File Type="Managed" AssemblyName="System.Windows.Forms" AssemblyVersion="8.0.0.0" /></FileList>';

  /**
   * A source holding, for each package id, a folder with `files`, at
   * `version`, recording what it is asked.
   */
  async function holding(
    packs: Readonly<
      Record<string, { version: string; files: Record<string, string> }>
    >,
    asked: string[] = [],
  ): Promise<PackSource> {
    const root = await scratch();
    for (const [id, { version, files }] of Object.entries(packs)) {
      for (const [file, contents] of Object.entries(files)) {
        await mkdir(join(root, id, version), { recursive: true });
        await writeFile(join(root, id, version, file), contents);
      }
    }
    return {
      versions: (id) => {
        asked.push(`versions ${id}`);
        const pack = packs[id];
        return Promise.resolve(pack === undefined ? [] : [pack.version]);
      },
      folder: (id, version) => {
        asked.push(`folder ${id} ${version}`);
        return Promise.resolve(join(root, id, version));
      },
    };
  }

  const noIdentify = () =>
    Promise.reject(new Error("Nothing should be identified."));

  it("says the framework provides an assembly its list holds at that version or later, and not one it holds older, or not at all", async () => {
    const check = frameworkChecker({
      sources: [
        await holding({
          "Microsoft.NETCore.App.Ref": {
            version: "8.0.31",
            files: { "FrameworkList.xml": NET8_LIST },
          },
        }),
      ],
      identify: noIdentify,
      offline: false,
    });
    const net8 = app("net8.0");

    expect(await check(net8, microsofts("System.Runtime", "8.0.0.0"))).toEqual({
      provided: true,
      reason:
        "Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Runtime 8.0.0.0",
    });
    // Ignoring case, as .NET does; an older version is held by a newer one.
    expect(
      await check(net8, microsofts("system.runtime", "4.2.0.0")),
    ).toMatchObject({ provided: true });
    expect(
      await check(net8, microsofts("System.Collections.Immutable", "9.0.0.0")),
    ).toEqual({
      provided: false,
      reason:
        "Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds System.Collections.Immutable only at 8.0.0.0, older than 9.0.0.0",
    });
    expect(
      await check(net8, {
        ...microsofts("System.CommandLine", "2.0.5.0"),
        publicKeyToken: "cc7b13ffcd2ddd51",
      }),
    ).toEqual({
      provided: false,
      reason:
        "Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds no assembly named System.CommandLine",
    });
  });

  it("finds and reads each pack once, from the first source that has it, and the Windows Desktop framework's beside .NET's", async () => {
    const asked: string[] = [];
    const check = frameworkChecker({
      sources: [
        await holding({}, asked),
        await holding(
          {
            "Microsoft.NETCore.App.Ref": {
              version: "8.0.31",
              files: { "FrameworkList.xml": NET8_LIST },
            },
            "Microsoft.WindowsDesktop.App.Ref": {
              version: "8.0.20",
              files: { "FrameworkList.xml": DESKTOP_LIST },
            },
          },
          asked,
        ),
      ],
      identify: noIdentify,
      offline: false,
    });
    const forms = app("net8.0-windows7.0", [FORMS]);

    expect(await check(forms, FORMS)).toEqual({
      provided: true,
      reason:
        "Microsoft.WindowsDesktop.App.Ref 8.0.20, the reference assemblies of the Windows Desktop framework of .NET 8.0, holds System.Windows.Forms 8.0.0.0",
    });
    expect(
      await check(forms, microsofts("System.Runtime", "8.0.0.0")),
    ).toMatchObject({ provided: true });
    expect(
      await check(
        app("net8.0"),
        microsofts("Microsoft.Extensions.Logging", "8.0.0.0"),
      ),
    ).toEqual({
      provided: false,
      reason:
        "Microsoft.NETCore.App.Ref 8.0.31, the reference assemblies of .NET 8.0, holds no assembly named Microsoft.Extensions.Logging",
    });
    expect(asked).toEqual([
      "versions Microsoft.NETCore.App.Ref",
      "versions Microsoft.NETCore.App.Ref",
      "folder Microsoft.NETCore.App.Ref 8.0.31",
      "versions Microsoft.WindowsDesktop.App.Ref",
      "versions Microsoft.WindowsDesktop.App.Ref",
      "folder Microsoft.WindowsDesktop.App.Ref 8.0.20",
    ]);
  });

  it("identifies only the reference assembly of the name asked about, in a pack that lists none", async () => {
    const identified: string[] = [];
    const check = frameworkChecker({
      sources: [
        await holding({
          "NETStandard.Library": {
            version: "2.0.3",
            files: { "netstandard.dll": "", "System.Runtime.dll": "" },
          },
        }),
      ],
      identify: (path) => {
        identified.push(path);
        return Promise.resolve({
          ...microsofts("netstandard", "2.0.0.0"),
          publicKeyToken: "cc7b13ffcd2ddd51",
        });
      },
      offline: false,
    });
    const standard = app("netstandard2.0");

    expect(await check(standard, microsofts("NETStandard", "2.0.0.0"))).toEqual(
      {
        provided: true,
        reason:
          "NETStandard.Library 2.0.3, the reference assemblies of .NET Standard 2.0, holds netstandard 2.0.0.0",
      },
    );
    expect(
      await check(standard, microsofts("System.Memory", "4.0.1.2")),
    ).toMatchObject({ provided: false });
    expect(identified).toHaveLength(1);
    expect(identified[0]).toMatch(/netstandard\.dll$/);
  });

  it("cannot tell where the pack is nowhere, saying where it was looked for, or Xray knows none", async () => {
    const offline = frameworkChecker({
      sources: [await holding({})],
      identify: noIdentify,
      offline: true,
    });
    const unreachable = frameworkChecker({
      sources: [
        await holding({}),
        {
          versions: () =>
            Promise.reject(
              new Error("nuget.org could not be asked: fetch failed"),
            ),
          folder: () => Promise.resolve(null),
        },
      ],
      identify: noIdentify,
      offline: false,
    });
    const runtime = microsofts("System.Runtime", "6.0.0.0");

    expect(await offline(app("net6.0"), runtime)).toEqual({
      provided: null,
      reason:
        "Microsoft.NETCore.App.Ref 6.0.x, the reference assemblies of .NET 6.0, is in neither the .NET SDK's packs folder nor the global-packages cache, and nuget.org was not asked (--offline)",
    });
    expect(await offline(app("net48"), runtime)).toMatchObject({
      reason:
        "Microsoft.NETFramework.ReferenceAssemblies.net48 1.0.3, the reference assemblies of .NET Framework 4.8, is in neither the .NET SDK's packs folder nor the global-packages cache, and nuget.org was not asked (--offline)",
    });
    expect(await unreachable(app("net6.0"), runtime)).toEqual({
      provided: null,
      reason:
        "Microsoft.NETCore.App.Ref 6.0.x, the reference assemblies of .NET 6.0, is in neither the .NET SDK's packs folder nor the global-packages cache, and nuget.org could not be asked: fetch failed",
    });
    expect(await offline(app("netcoreapp2.1"), runtime)).toEqual({
      provided: null,
      reason: "Xray knows no reference assemblies for netcoreapp2.1",
    });
    expect(await offline(app(null), runtime)).toEqual({
      provided: null,
      reason: "its target framework could not be told",
    });
  });

  it("cannot tell where a pack holds no list", async () => {
    const check = frameworkChecker({
      sources: [
        await holding({
          "Microsoft.NETCore.App.Ref": {
            version: "8.0.31",
            files: { "README.md": "" },
          },
        }),
      ],
      identify: noIdentify,
      offline: false,
    });

    expect(
      await check(app("net8.0"), microsofts("System.Runtime", "8.0.0.0")),
    ).toEqual({
      provided: null,
      reason:
        "Microsoft.NETCore.App.Ref 8.0.x, the reference assemblies of .NET 8.0, is there, at 8.0.31, but holds no data/FrameworkList.xml",
    });
  });
});
