import { describe, expect, it } from "vitest";

import type { AssemblyIdentity } from "../inspect/assembly-summary.js";
import type { DepsJson } from "./deps-json.js";
import {
  compareVersions,
  findPackageWith,
  MAX_DOWNLOADS_PER_REFERENCE,
  orderVersions,
  parseVersion,
  type CopyBeside,
  type PackageFinderOptions,
} from "./nuget-packages.js";
import type {
  PackageFile,
  PackageSource,
  PackageSourceName,
} from "./package-sources.js";

const newtonsoft: AssemblyIdentity = {
  name: "Newtonsoft.Json",
  version: "13.0.0.0",
  culture: null,
  publicKeyToken: "30ad4fe6b2a6aeed",
};

/** A file in a package: the assembly it is, and a hash standing for its contents. */
interface FakeFile {
  readonly path: string;
  readonly identity: AssemblyIdentity;
  readonly sha256: string;
}

/**
 * A source holding, for each version of each package, its `lib/` files,
 * recording each version whose assemblies are asked for. The file's
 * `localPath` is a key `identify` reads its identity from.
 */
function source(
  name: PackageSourceName,
  packages: Readonly<Record<string, Readonly<Record<string, FakeFile[]>>>>,
  identities: Map<string, AssemblyIdentity>,
) {
  const opened: string[] = [];
  const fake: PackageSource = {
    name,
    remote: name === "nuget.org",
    versions: (id) =>
      Promise.resolve(Object.keys(packages[id.toLowerCase()] ?? {})),
    assemblies: (id, version, fileName) => {
      opened.push(version);
      const files = packages[id.toLowerCase()]?.[version] ?? [];
      return Promise.resolve(
        files
          .filter(
            (file) =>
              file.path.split("/").at(-1)?.toLowerCase() ===
              fileName.toLowerCase(),
          )
          .map((file): PackageFile => {
            const localPath = `${name}:${id}:${version}:${file.path}`;
            identities.set(localPath, file.identity);
            return { path: file.path, localPath, sha256: file.sha256 };
          }),
      );
    },
    folder: () => Promise.reject(new Error("not expected")),
  };
  return { source: fake, opened };
}

/** Newtonsoft.Json's `lib/net6.0` assembly, of `version`, its contents `sha256`. */
function held(version = "13.0.0.0", sha256 = `hash of ${version}`): FakeFile[] {
  return [
    {
      path: "lib/net6.0/Newtonsoft.Json.dll",
      identity: { ...newtonsoft, version },
      sha256,
    },
  ];
}

function finder(
  sources: (identities: Map<string, AssemblyIdentity>) => PackageSource[],
  offline = false,
): PackageFinderOptions {
  const identities = new Map<string, AssemblyIdentity>();
  return {
    sources: sources(identities),
    identify: (path) => Promise.resolve(identities.get(path) ?? null),
    offline,
  };
}

const copy = (sha256: string, informationalVersion: string | null = null) =>
  ({
    path: "/app/Newtonsoft.Json.dll",
    sha256,
    informationalVersion,
  }) satisfies CopyBeside;

describe("findPackageWith", () => {
  it("finds the package of the assembly's name holding the very assembly referenced, by name, version and public key token", async () => {
    const options = finder((identities) => [
      source(
        "global-packages",
        { "newtonsoft.json": { "13.0.3": held() } },
        identities,
      ).source,
    ]);

    expect(await findPackageWith(newtonsoft, null, options)).toEqual({
      reference: newtonsoft,
      package: {
        id: "Newtonsoft.Json",
        version: "13.0.3",
        source: "global-packages",
        file: "lib/net6.0/Newtonsoft.Json.dll",
        matchesCopyBeside: false,
      },
      candidates: [
        {
          id: "Newtonsoft.Json",
          version: "13.0.3",
          source: "global-packages",
          file: "lib/net6.0/Newtonsoft.Json.dll",
          matchesCopyBeside: false,
        },
      ],
      searched: ["global-packages"],
      reason:
        "Newtonsoft.Json 13.0.3, in the global-packages cache, holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed as lib/net6.0/Newtonsoft.Json.dll.",
    });
  });

  it.each([
    ["another version", { version: "12.0.0.0" }],
    ["another public key token", { publicKeyToken: "0000000000000000" }],
    ["no strong name", { publicKeyToken: null }],
    ["another culture", { culture: "fr" }],
  ])("does not take a package whose assembly has %s", async (_, difference) => {
    const options = finder((identities) => [
      source(
        "global-packages",
        {
          "newtonsoft.json": {
            "13.0.3": held().map((file) => ({
              ...file,
              identity: { ...newtonsoft, ...difference },
            })),
          },
        },
        identities,
      ).source,
    ]);

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup).toMatchObject({ package: null, candidates: [] });
    expect(lookup.reason).toBe(
      "No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. The one version of Newtonsoft.Json in the global-packages cache looked at does not hold it.",
    );
  });

  it("looks on nuget.org only when the global-packages cache has no package holding it", async () => {
    let cache!: ReturnType<typeof source>;
    let remote!: ReturnType<typeof source>;
    const options = finder((identities) => {
      cache = source(
        "global-packages",
        { "newtonsoft.json": { "12.0.3": held("12.0.0.0") } },
        identities,
      );
      remote = source(
        "nuget.org",
        { "newtonsoft.json": { "12.0.3": held("12.0.0.0"), "13.0.3": held() } },
        identities,
      );
      return [cache.source, remote.source];
    });

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup).toMatchObject({
      package: { version: "13.0.3", source: "nuget.org" },
      searched: ["global-packages", "nuget.org"],
    });
    // The newest first, and no further once one holds it.
    expect(remote.opened).toEqual(["13.0.3"]);
  });

  it("chooses the highest of several versions holding the same assembly, stable first, and says why", async () => {
    const options = finder((identities) => [
      source(
        "global-packages",
        {
          "newtonsoft.json": {
            "13.0.1": held(),
            "13.0.4-beta1": held(),
            "13.0.3": held(),
            "13.0.2": held(),
            "12.0.3": held("12.0.0.0"),
          },
        },
        identities,
      ).source,
    ]);

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup.package?.version).toBe("13.0.3");
    expect(lookup.candidates.map(({ version }) => version)).toEqual([
      "13.0.3",
      "13.0.2",
      "13.0.1",
      "13.0.4-beta1",
    ]);
    expect(lookup.reason).toBe(
      "4 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.3, 13.0.2, 13.0.1, 13.0.4-beta1. 13.0.3 is chosen, as it is the highest: the likeliest to be what the application was built with, and the least likely to be older than another package needs.",
    );
  });

  it("chooses the version holding the very file beside the input over a higher one, and says why", async () => {
    const options = finder((identities) => [
      source(
        "global-packages",
        {
          "newtonsoft.json": {
            "13.0.3": held(),
            "13.0.2": held("13.0.0.0", "the copy's hash"),
            "13.0.1": held(),
          },
        },
        identities,
      ).source,
    ]);

    const lookup = await findPackageWith(
      newtonsoft,
      copy("the copy's hash"),
      options,
    );

    expect(lookup.package).toMatchObject({
      version: "13.0.2",
      matchesCopyBeside: true,
    });
    expect(lookup.candidates.map(({ version }) => version)).toEqual([
      "13.0.2",
      "13.0.3",
      "13.0.1",
    ]);
    expect(lookup.reason).toBe(
      "3 versions of Newtonsoft.Json in the global-packages cache hold Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed: 13.0.2, 13.0.3, 13.0.1. 13.0.2 is chosen, as its lib/net6.0/Newtonsoft.Json.dll is the very file beside the input (/app/Newtonsoft.Json.dll).",
    );
  });

  it("chooses the same package whatever order the source lists its versions in", async () => {
    const versions = ["13.0.1", "13.0.3", "13.0.2", "13.0.3-beta1"];
    const chosen = new Set<string>();
    for (const order of [versions, versions.toReversed()]) {
      const options = finder((identities) => [
        source(
          "global-packages",
          {
            "newtonsoft.json": Object.fromEntries(
              order.map((version) => [version, held()]),
            ),
          },
          identities,
        ).source,
      ]);
      const lookup = await findPackageWith(newtonsoft, null, options);
      chosen.add(`${lookup.package?.version} ${lookup.reason}`);
    }

    expect(chosen.size).toBe(1);
  });

  it("downloads the version the copy beside the input says it is first, then the newest down, until one holds the very file", async () => {
    let remote!: ReturnType<typeof source>;
    const options = finder((identities) => {
      remote = source(
        "nuget.org",
        {
          "newtonsoft.json": {
            "13.0.4": held(),
            "13.0.3": held(),
            "13.0.2": held("13.0.0.0", "the copy's hash"),
            "13.0.1": held(),
          },
        },
        identities,
      );
      return [remote.source];
    });

    const hinted = await findPackageWith(
      newtonsoft,
      copy("the copy's hash", "13.0.2+4a5b6c"),
      options,
    );
    expect(hinted.package).toMatchObject({
      version: "13.0.2",
      matchesCopyBeside: true,
    });
    expect(remote.opened).toEqual(["13.0.2"]);

    remote.opened.length = 0;
    const unhinted = await findPackageWith(
      newtonsoft,
      copy("the copy's hash"),
      options,
    );
    expect(unhinted.package?.version).toBe("13.0.2");
    expect(remote.opened).toEqual(["13.0.4", "13.0.3", "13.0.2"]);
  });

  it("stops downloading once a version holds an older assembly than the one referenced", async () => {
    let remote!: ReturnType<typeof source>;
    const options = finder((identities) => {
      remote = source(
        "nuget.org",
        {
          "newtonsoft.json": {
            "14.0.0": held("14.0.0.0"),
            "12.0.3": held("12.0.0.0"),
            "12.0.2": held("12.0.0.0"),
          },
        },
        identities,
      );
      return [remote.source];
    });

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup.package).toBeNull();
    expect(remote.opened).toEqual(["14.0.0", "12.0.3"]);
    expect(lookup.reason).toBe(
      "No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. None of the 2 versions of Newtonsoft.Json on nuget.org looked at holds it.",
    );
  });

  it("stops downloading once a version holds no assembly of the name, as the package is not the assembly's", async () => {
    let remote!: ReturnType<typeof source>;
    const options = finder((identities) => {
      remote = source(
        "nuget.org",
        { "newtonsoft.json": { "2.0.0": [], "1.0.0": held() } },
        identities,
      );
      return [remote.source];
    });

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup.package).toBeNull();
    expect(remote.opened).toEqual(["2.0.0"]);
    expect(lookup.reason).toBe(
      "No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. Newtonsoft.Json 2.0.0 on nuget.org holds no Newtonsoft.Json.dll in its lib folders, so the package is not the assembly's.",
    );
  });

  it(`downloads at most ${MAX_DOWNLOADS_PER_REFERENCE} versions from nuget.org for a reference, and says so`, async () => {
    let remote!: ReturnType<typeof source>;
    const options = finder((identities) => {
      remote = source(
        "nuget.org",
        {
          "newtonsoft.json": Object.fromEntries(
            Array.from({ length: 30 }, (_, i) => [
              `14.0.${i}`,
              held("14.0.0.0"),
            ]),
          ),
        },
        identities,
      );
      return [remote.source];
    });

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup.package).toBeNull();
    expect(remote.opened).toHaveLength(MAX_DOWNLOADS_PER_REFERENCE);
    expect(lookup.reason).toContain(
      `Only the ${MAX_DOWNLOADS_PER_REFERENCE} likeliest of its 30 versions were downloaded.`,
    );
  });

  describe("an assembly that is not strong-named", () => {
    const own: AssemblyIdentity = {
      name: "Greetings",
      version: "1.0.0.0",
      culture: null,
      publicKeyToken: null,
    };
    const greetings = (sha256: string): FakeFile[] => [
      { path: "lib/net8.0/Greetings.dll", identity: own, sha256 },
    ];

    it("is not looked up at all without a copy beside the input to compare with", async () => {
      let remote!: ReturnType<typeof source>;
      const options = finder((identities) => {
        remote = source(
          "nuget.org",
          { greetings: { "1.0.0": greetings("anyone's") } },
          identities,
        );
        return [remote.source];
      });

      expect(await findPackageWith(own, null, options)).toEqual({
        reference: own,
        package: null,
        candidates: [],
        searched: [],
        reason:
          "Greetings is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of Greetings 1.0.0.0, not strong-named beside it, so no package was looked for.",
      });
      expect(remote.opened).toEqual([]);
    });

    it("is taken from a package only if it holds the very file beside the input", async () => {
      const options = finder((identities) => [
        source(
          "nuget.org",
          {
            greetings: {
              "1.0.1": greetings("anyone's"),
              "1.0.0": greetings("the copy's hash"),
            },
          },
          identities,
        ).source,
      ]);

      expect(
        await findPackageWith(
          own,
          { ...copy("the copy's hash"), path: "/app/Greetings.dll" },
          options,
        ),
      ).toMatchObject({
        package: { id: "Greetings", version: "1.0.0", matchesCopyBeside: true },
      });

      const lookup = await findPackageWith(
        own,
        { ...copy("another hash"), path: "/app/Greetings.dll" },
        options,
      );
      expect(lookup.package).toBeNull();
      expect(lookup.reason).toBe(
        "No package holds Greetings 1.0.0.0, not strong-named. 2 versions of Greetings on nuget.org hold Greetings 1.0.0.0, but, as it is not strong-named, only one holding the very file beside the input is taken, and none does.",
      );
    });
  });

  describe("with a .deps.json beside the input", () => {
    const commandLine: AssemblyIdentity = {
      name: "CommandLine",
      version: "2.9.1.0",
      culture: null,
      publicKeyToken: "5a870481e358d379",
    };
    const parser = (sha256: string): FakeFile[] => [
      {
        path: "lib/netstandard2.0/CommandLine.dll",
        identity: commandLine,
        sha256,
      },
    ];
    const deps = (
      ...packages: [id: string, version: string, assembly: string][]
    ): DepsJson => ({
      path: "/app/Watchman.deps.json",
      packages: packages.map(([id, version, assembly]) => ({
        id,
        version,
        assemblies: [assembly],
      })),
    });
    const theCopy = {
      ...copy("the copy's hash"),
      path: "/app/CommandLine.dll",
    };

    it("finds the assembly in the package it names, though the package is named otherwise, downloading only the version it names", async () => {
      let remote!: ReturnType<typeof source>;
      const options: PackageFinderOptions = {
        ...finder((identities) => {
          remote = source(
            "nuget.org",
            {
              // An old package of the assembly's name, but not the assembly's.
              commandline: { "1.9.7": [] },
              commandlineparser: {
                "2.9.2-ci-210": parser("another hash"),
                "2.9.1": parser("the copy's hash"),
                "2.8.0": [],
              },
            },
            identities,
          );
          return [remote.source];
        }),
        deps: deps(["CommandLineParser", "2.9.1", "CommandLine.dll"]),
      };

      const lookup = await findPackageWith(commandLine, theCopy, options);

      expect(lookup).toMatchObject({
        package: {
          id: "CommandLineParser",
          version: "2.9.1",
          source: "nuget.org",
          file: "lib/netstandard2.0/CommandLine.dll",
          matchesCopyBeside: true,
        },
        searched: ["nuget.org"],
        reason:
          "CommandLineParser 2.9.1, on nuget.org, holds CommandLine 2.9.1.0, public key token 5a870481e358d379 as lib/netstandard2.0/CommandLine.dll, the very file beside the input (/app/CommandLine.dll). /app/Watchman.deps.json says the application's CommandLine is from CommandLineParser 2.9.1.",
      });
      expect(remote.opened).toEqual(["2.9.1"]);
    });

    it("downloads the version it names first, where the assembly's own versions name no release", async () => {
      const core: AssemblyIdentity = {
        name: "AWSSDK.Core",
        version: "3.3.0.0",
        culture: null,
        publicKeyToken: "885c28607f98e604",
      };
      const release = (version: string): FakeFile[] => [
        {
          path: "lib/netcoreapp3.1/AWSSDK.Core.dll",
          identity: core,
          sha256: `hash of ${version}`,
        },
      ];
      let remote!: ReturnType<typeof source>;
      const options: PackageFinderOptions = {
        ...finder((identities) => {
          remote = source(
            "nuget.org",
            {
              "awssdk.core": Object.fromEntries(
                ["3.7.400.1", "3.7.300.2", "3.7.106.10", "3.7.106.9"].map(
                  (version) => [version, release(version)],
                ),
              ),
            },
            identities,
          );
          return [remote.source];
        }),
        deps: deps(["AWSSDK.Core", "3.7.106.10", "AWSSDK.Core.dll"]),
      };

      const lookup = await findPackageWith(
        core,
        // Every release's informational version is 1.0.0, which names none.
        {
          path: "/app/AWSSDK.Core.dll",
          sha256: "hash of 3.7.106.10",
          informationalVersion: "1.0.0",
        },
        options,
      );

      expect(lookup.package).toMatchObject({
        id: "AWSSDK.Core",
        version: "3.7.106.10",
        matchesCopyBeside: true,
      });
      expect(remote.opened).toEqual(["3.7.106.10"]);
    });

    it("still checks what the package it names holds against the reference, and falls back to the package of the assembly's name", async () => {
      let remote!: ReturnType<typeof source>;
      const options: PackageFinderOptions = {
        ...finder((identities) => {
          remote = source(
            "nuget.org",
            {
              commandlineparser: {
                "2.9.1": [
                  {
                    path: "lib/netstandard2.0/CommandLine.dll",
                    identity: { ...commandLine, publicKeyToken: null },
                    sha256: "a stranger's hash",
                  },
                ],
              },
              commandline: { "2.9.1": parser("the copy's hash") },
            },
            identities,
          );
          return [remote.source];
        }),
        deps: deps(["CommandLineParser", "2.9.1", "CommandLine.dll"]),
      };

      const lookup = await findPackageWith(commandLine, theCopy, options);

      expect(lookup.package).toMatchObject({
        id: "CommandLine",
        version: "2.9.1",
      });
      // Its own reason does not claim the .deps.json named it.
      expect(lookup.reason).toBe(
        "CommandLine 2.9.1, on nuget.org, holds CommandLine 2.9.1.0, public key token 5a870481e358d379 as lib/netstandard2.0/CommandLine.dll, the very file beside the input (/app/CommandLine.dll).",
      );
      expect(remote.opened).toEqual(["2.9.1", "2.9.1"]);
    });

    it("says what it names when no package holds the assembly", async () => {
      const options: PackageFinderOptions = {
        ...finder((identities) => [
          source("global-packages", {}, identities).source,
        ]),
        deps: deps(["CommandLineParser", "2.9.1", "CommandLine.dll"]),
        offline: true,
      };

      const lookup = await findPackageWith(commandLine, theCopy, options);

      expect(lookup).toMatchObject({ package: null });
      expect(lookup.reason).toBe(
        "No package holds CommandLine 2.9.1.0, public key token 5a870481e358d379. /app/Watchman.deps.json says the application's CommandLine is from CommandLineParser 2.9.1. There is no package named CommandLineParser in the global-packages cache. There is no package named CommandLine in the global-packages cache. nuget.org was not asked (--offline).",
      );
    });

    it(`downloads at most ${MAX_DOWNLOADS_PER_REFERENCE} versions for a reference, of every package it could be in`, async () => {
      let remote!: ReturnType<typeof source>;
      const options: PackageFinderOptions = {
        ...finder((identities) => {
          remote = source(
            "nuget.org",
            {
              commandlineparser: Object.fromEntries(
                // Each holding a newer assembly than the one referenced.
                Array.from({ length: 30 }, (_, i) => [
                  `2.9.${i}`,
                  parser(`hash ${i}`).map((file) => ({
                    ...file,
                    identity: { ...commandLine, version: "3.0.0.0" },
                  })),
                ]),
              ),
              commandline: { "2.9.1": parser("the copy's hash") },
            },
            identities,
          );
          return [remote.source];
        }),
        deps: deps(["CommandLineParser", "2.9.1", "CommandLine.dll"]),
      };

      const lookup = await findPackageWith(commandLine, theCopy, options);

      expect(lookup.package).toBeNull();
      expect(remote.opened).toHaveLength(MAX_DOWNLOADS_PER_REFERENCE);
      expect(lookup.reason).toContain(
        `None of the ${MAX_DOWNLOADS_PER_REFERENCE} versions of CommandLineParser on nuget.org looked at holds it. Only the ${MAX_DOWNLOADS_PER_REFERENCE} likeliest of its 30 versions were downloaded. No version of CommandLine on nuget.org was looked at. ${MAX_DOWNLOADS_PER_REFERENCE} versions of other packages had already been downloaded for it, as many as Xray downloads for a reference.`,
      );
    });
  });

  it("offline, looks only in the sources it is given and says nuget.org was not asked", async () => {
    const options = finder(
      (identities) => [source("global-packages", {}, identities).source],
      true,
    );

    const lookup = await findPackageWith(newtonsoft, null, options);

    expect(lookup).toMatchObject({
      package: null,
      searched: ["global-packages"],
      reason:
        "No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. There is no package named Newtonsoft.Json in the global-packages cache. nuget.org was not asked (--offline).",
    });
  });

  it("carries on when a source cannot be asked, saying why", async () => {
    const unreachable: PackageSource = {
      name: "nuget.org",
      remote: true,
      versions: () =>
        Promise.reject(new Error("nuget.org could not be asked: fetch failed")),
      assemblies: () => Promise.reject(new Error("not expected")),
      folder: () => Promise.reject(new Error("not expected")),
    };
    const options = finder((identities) => [
      source("global-packages", {}, identities).source,
      unreachable,
    ]);

    expect(await findPackageWith(newtonsoft, null, options)).toMatchObject({
      package: null,
      searched: ["global-packages", "nuget.org"],
      reason:
        "No package holds Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed. There is no package named Newtonsoft.Json in the global-packages cache. nuget.org could not be asked: fetch failed",
    });
  });

  it("fails as the engine does when it cannot read an assembly", async () => {
    const options: PackageFinderOptions = {
      ...finder((identities) => [
        source(
          "global-packages",
          { "newtonsoft.json": { "13.0.3": held() } },
          identities,
        ).source,
      ]),
      identify: () => Promise.reject(new Error("The engine stopped.")),
    };

    await expect(findPackageWith(newtonsoft, null, options)).rejects.toThrow(
      "The engine stopped.",
    );
  });
});

describe("NuGet versions", () => {
  it.each([
    ["1.0.0", "1.0.0.0", 0],
    ["1.0", "1.0.0", 0],
    ["1.0.0", "1.0.1", -1],
    ["1.10.0", "1.9.0", 1],
    ["1.0.0-beta", "1.0.0", -1],
    ["1.0.0-alpha", "1.0.0-beta", -1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0-BETA", "1.0.0-beta", 0],
    ["1.0.0+build.5", "1.0.0", 0],
  ])("compares %s with %s as %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
    expect(compareVersions(b, a)).toBe(-expected || 0);
  });

  it("orders versions stable first, highest first, putting the hinted ones first, in order, and leaving out what is not a version", () => {
    expect(
      orderVersions(
        ["1.0.0", "2.0.0-rc.1", "1.10.0", "not a version", "1.9.0"],
        ["1.0.0"],
      ),
    ).toEqual(["1.0.0", "1.10.0", "1.9.0", "2.0.0-rc.1"]);
    expect(
      orderVersions(["1.0.0", "1.10.0", "1.9.0"], ["1.9.0", "1.0.0"]),
    ).toEqual(["1.9.0", "1.0.0", "1.10.0"]);
  });

  it("parses SemVer 2.0 and four-part versions, not anything else", () => {
    expect(parseVersion("13.0.3.1-beta.2+abc")).toEqual({
      release: [13, 0, 3, 1],
      prerelease: ["beta", "2"],
    });
    expect(parseVersion("v1.0")).toBeNull();
    expect(parseVersion("1.0.0.0.0")).toBeNull();
  });
});
