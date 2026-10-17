import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  depsJsonPath,
  packagesHolding,
  parseDepsJson,
  readDepsJson,
} from "./deps-json.js";

/** A `.deps.json` as `dotnet build` writes it, cut down to what is read: Watchman's, with a few of its libraries. */
const WATCHMAN_DEPS = {
  runtimeTarget: { name: ".NETCoreApp,Version=v8.0", signature: "" },
  targets: {
    ".NETCoreApp,Version=v8.0": {
      "Watchman/2.0.0": {
        dependencies: { CommandLineParser: "2.9.1" },
        runtime: { "Watchman.dll": {} },
      },
      "AWSSDK.Core/3.7.106.10": {
        runtime: {
          "lib/netcoreapp3.1/AWSSDK.Core.dll": {
            assemblyVersion: "3.3.0.0",
            fileVersion: "3.7.106.10",
          },
        },
      },
      "CommandLineParser/2.9.1": {
        runtime: {
          "lib/netstandard2.0/CommandLine.dll": {
            assemblyVersion: "2.9.1.0",
            fileVersion: "2.9.1.0",
          },
        },
      },
      "Watchman.Engine/2.0.0": { runtime: { "Watchman.Engine.dll": {} } },
    },
  },
  libraries: {
    "Watchman/2.0.0": { type: "project", serviceable: false, sha512: "" },
    "AWSSDK.Core/3.7.106.10": {
      type: "package",
      serviceable: true,
      sha512: "sha512-…",
      path: "awssdk.core/3.7.106.10",
    },
    "CommandLineParser/2.9.1": {
      type: "package",
      serviceable: true,
      sha512: "sha512-…",
      path: "commandlineparser/2.9.1",
    },
    "Watchman.Engine/2.0.0": { type: "project", serviceable: false },
  },
};

describe("parseDepsJson", () => {
  it("reads each package library, with the assemblies its target says came from it, and not the app's projects", () => {
    expect(parseDepsJson(JSON.stringify(WATCHMAN_DEPS))).toEqual([
      {
        id: "AWSSDK.Core",
        version: "3.7.106.10",
        assemblies: ["AWSSDK.Core.dll"],
      },
      {
        id: "CommandLineParser",
        version: "2.9.1",
        assemblies: ["CommandLine.dll"],
      },
    ]);
  });

  it("reads compile assets too, and each assembly once over every target, the runtime target's first", () => {
    const deps = {
      runtimeTarget: { name: ".NETCoreApp,Version=v8.0/linux-x64" },
      targets: {
        ".NETCoreApp,Version=v8.0": {
          "Vendor.Tools/1.0.0": {
            compile: { "ref/net8.0/Vendor.Contracts.dll": {} },
            runtime: { "lib/net8.0/vendor.tools.dll": {} },
          },
        },
        ".NETCoreApp,Version=v8.0/linux-x64": {
          "Vendor.Tools/1.0.0": {
            runtime: { "lib/net8.0/Vendor.Tools.dll": {} },
            resources: { "lib/net8.0/fr/Vendor.Tools.resources.dll": {} },
          },
        },
      },
      libraries: { "Vendor.Tools/1.0.0": { type: "package" } },
    };

    expect(parseDepsJson(JSON.stringify(deps))).toEqual([
      {
        id: "Vendor.Tools",
        version: "1.0.0",
        assemblies: ["Vendor.Tools.dll", "Vendor.Contracts.dll"],
      },
    ]);
  });

  it("leaves out a library whose id or version could not be a package's, as they are looked up by them", () => {
    const deps = {
      targets: {},
      libraries: {
        "../../escape/1.0.0": { type: "package" },
        "Vendor/1.0.0/../..": { type: "package" },
        NoVersion: { type: "package" },
        "Vendor/1.0.0": { type: "package" },
      },
    };

    expect(
      parseDepsJson(JSON.stringify(deps)).map(({ id, version }) => [
        id,
        version,
      ]),
    ).toEqual([["Vendor", "1.0.0"]]);
  });

  it("reads nothing from JSON that is not a .deps.json, and throws on what is not JSON", () => {
    expect(parseDepsJson("{}")).toEqual([]);
    expect(parseDepsJson("[1, 2]")).toEqual([]);
    expect(parseDepsJson('{"targets": 1, "libraries": "no"}')).toEqual([]);
    expect(() => parseDepsJson("not json")).toThrow();
  });
});

describe("packagesHolding", () => {
  it("finds the packages holding an assembly of a name, ignoring case, whatever the package is named", () => {
    const deps = {
      path: "/app/Watchman.deps.json",
      packages: parseDepsJson(JSON.stringify(WATCHMAN_DEPS)),
    };

    expect(packagesHolding(deps, "commandline")).toMatchObject([
      { id: "CommandLineParser", version: "2.9.1" },
    ]);
    expect(packagesHolding(deps, "AWSSDK.Core")).toMatchObject([
      { id: "AWSSDK.Core", version: "3.7.106.10" },
    ]);
    expect(packagesHolding(deps, "Watchman.Engine")).toEqual([]);
  });
});

describe("readDepsJson", () => {
  let folder: string | undefined;
  afterEach(async () => {
    if (folder !== undefined) {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("reads the .deps.json the runtime would, beside the Assembly and named after it", async () => {
    folder = await mkdtemp(join(tmpdir(), "xray-deps-"));
    const path = join(folder, "Watchman.deps.json");
    await writeFile(path, JSON.stringify(WATCHMAN_DEPS));

    expect(depsJsonPath(join(folder, "Watchman.dll"))).toBe(path);
    expect(await readDepsJson(join(folder, "Watchman.dll"))).toMatchObject({
      path,
      packages: [{ id: "AWSSDK.Core" }, { id: "CommandLineParser" }],
    });
  });

  it("is null when there is no .deps.json, or it is not JSON", async () => {
    folder = await mkdtemp(join(tmpdir(), "xray-deps-"));

    expect(await readDepsJson(join(folder, "Watchman.dll"))).toBeNull();
    await writeFile(join(folder, "Watchman.deps.json"), "{ not json");
    expect(await readDepsJson(join(folder, "Watchman.dll"))).toBeNull();
  });
});
