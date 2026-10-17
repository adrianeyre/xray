// Dependency Resolution's first step (FR-10.1): whether the target framework
// provides the assembly a reference names. Microsoft signs .NET's own
// assemblies and many of its NuGet packages' with the same keys
// (`System.Runtime` and `System.Collections.Immutable` 9.0, `netstandard` and
// `System.CommandLine`), so the key alone cannot tell them apart. A reference
// is the framework's only where the reference assemblies of the target
// framework of the Assembly making it hold an assembly of that name, at that
// version or later, as the list of them their package carries says:
//
//   Microsoft.NETCore.App.Ref/<8.0.x>/data/FrameworkList.xml                  net8.0
//   Microsoft.WindowsDesktop.App.Ref/<8.0.x>/data/FrameworkList.xml           net8.0-windows, with Windows Forms or WPF
//   NETStandard.Library.Ref/2.1.0/data/FrameworkList.xml                      netstandard2.1
//   NETStandard.Library/2.0.3/build/netstandard2.0/ref/*.dll                  netstandard2.0, which lists none
//   Microsoft.NETFramework.ReferenceAssemblies.net48/1.0.3/build/.NETFramework/v4.8/RedistList/FrameworkList.xml   net48
//
// each looked for in the .NET SDK's own packs folder, which it builds
// against, then in the global-packages cache, then, unless offline, on
// nuget.org. Anything else Microsoft signed is one of its packages, for the
// NuGet step to find.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { listDotnetSdks, type DotnetSdkLookup } from "../doctor/dotnet-sdks.js";
import type {
  AssemblyIdentity,
  AssemblySummary,
} from "../inspect/assembly-summary.js";
import {
  compareAssemblyVersions,
  type IdentifyAssembly,
} from "./nuget-packages.js";
import type { PackageSource } from "./package-sources.js";
import {
  isNetFramework,
  NET_FRAMEWORK_REFERENCE_ASSEMBLIES,
  usesWindowsForms,
  usesWpf,
} from "./recovered-solution.js";
import { findReferencePack, type ReferencePack } from "./reference-packs.js";

/** The package holding a target framework's reference assemblies, and the list of them in it. */
export interface FrameworkPack extends ReferencePack {
  /**
   * The file in {@link ReferencePack.folder} listing the assemblies,
   * `FrameworkList.xml`; `null` where there is none, when the assemblies are
   * the `.dll`s in the folder itself.
   */
  readonly list: string | null;
}

/** Where a {@link FrameworkPack} can be found: anything that has packages' versions and folders. */
export type PackSource = Pick<PackageSource, "versions" | "folder">;

/** An assembly a framework's reference assemblies hold. */
export interface FrameworkAssembly {
  readonly name: string;
  /** Its assembly version, e.g. `8.0.0.0`. */
  readonly version: string;
}

/**
 * Whether a target framework provides an assembly: `true` if its reference
 * assemblies hold one of that name at that version or later, `false` if they
 * do not, `null` if Xray could not tell, as when they were not found. Why,
 * for people, either way.
 */
export interface FrameworkCheck {
  readonly provided: boolean | null;
  readonly reason: string;
}

/** Tells whether the target framework of the Assembly `summary` describes provides the assembly `reference` names. */
export type CheckFramework = (
  summary: AssemblySummary,
  reference: AssemblyIdentity,
) => Promise<FrameworkCheck>;

/**
 * The packages holding the reference assemblies of the target framework of
 * an Assembly: .NET's (with its Windows Desktop framework's, for an
 * Assembly using Windows Forms or WPF), .NET Framework's or .NET Standard's,
 * for its version. `null` if Xray knows none for it: its target framework
 * could not be told, or is older than .NET Core 3.0 or .NET Standard 2.0.
 */
export function frameworkPacksFor(
  summary: AssemblySummary,
): FrameworkPack[] | null {
  const moniker = summary.targetFramework.moniker;
  if (moniker === null) {
    return null;
  }
  if (isNetFramework(moniker)) {
    const version = /^net(\d)(\d)(\d)?(-client)?$/i.exec(moniker);
    if (version === null) {
      return null;
    }
    const dotted = version.slice(1, 4).filter(Boolean).join(".");
    const client = version[4] === undefined ? "" : "/Profile/Client";
    return [
      {
        id: `${NET_FRAMEWORK_REFERENCE_ASSEMBLIES.id}.net${version.slice(1, 4).join("")}`,
        versionPrefix: null,
        preferredVersion: NET_FRAMEWORK_REFERENCE_ASSEMBLIES.version,
        folder: `build/.NETFramework/v${dotted}${client}/RedistList`,
        list: "FrameworkList.xml",
        holds: `.NET Framework ${dotted}${client === "" ? "" : " Client Profile"}`,
      },
    ];
  }
  const standard = /^netstandard(\d+)\.(\d+)$/i.exec(moniker);
  if (standard !== null) {
    const version = `${standard[1]}.${standard[2]}`;
    if (version === "2.0") {
      return [
        {
          id: "NETStandard.Library",
          versionPrefix: "2.0.",
          preferredVersion: "2.0.3",
          folder: "build/netstandard2.0/ref",
          list: null,
          holds: ".NET Standard 2.0",
        },
      ];
    }
    return version === "2.1"
      ? [
          {
            id: "NETStandard.Library.Ref",
            versionPrefix: "2.1.",
            preferredVersion: "2.1.0",
            folder: "data",
            list: "FrameworkList.xml",
            holds: ".NET Standard 2.1",
          },
        ]
      : null;
  }
  const core = /^net(?:coreapp)?(\d+)\.(\d+)(?:-|$)/i.exec(moniker);
  if (core === null || Number(core[1]) < 3) {
    return null;
  }
  const version = `${core[1]}.${core[2]}`;
  const net = `.NET ${Number(core[1]) < 5 ? "Core " : ""}${version}`;
  const pack = (id: string, holds: string): FrameworkPack => ({
    id,
    versionPrefix: `${version}.`,
    preferredVersion: null,
    folder: "data",
    list: "FrameworkList.xml",
    holds,
  });
  return [
    pack("Microsoft.NETCore.App.Ref", net),
    ...(usesWindowsForms(summary) || usesWpf(summary)
      ? [
          pack(
            "Microsoft.WindowsDesktop.App.Ref",
            `the Windows Desktop framework of ${net}`,
          ),
        ]
      : []),
  ];
}

/**
 * The assemblies a `FrameworkList.xml` lists, by their `AssemblyName` and
 * their `AssemblyVersion` (.NET's, .NET Standard's) or `Version` (.NET
 * Framework's); not the analyzers it lists beside them.
 */
export function parseFrameworkList(xml: string): FrameworkAssembly[] {
  const assemblies: FrameworkAssembly[] = [];
  for (const [element] of xml.matchAll(/<File\b[^>]*>/g)) {
    const attributes = new Map(
      [...element.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(
        ([, name, value]) => [name as string, value as string],
      ),
    );
    const type = attributes.get("Type");
    const name = attributes.get("AssemblyName");
    const version =
      attributes.get("AssemblyVersion") ?? attributes.get("Version");
    if (
      (type !== undefined && type !== "Managed") ||
      name === undefined ||
      version === undefined
    ) {
      continue;
    }
    assemblies.push({ name, version });
  }
  return assemblies;
}

/**
 * The packs folders of the .NET SDKs the `dotnet` host at `dotnetPath` has,
 * each beside its `sdk` folder, as a {@link PackSource}: the targeting packs
 * an SDK builds against without restoring them, laid out as
 * `packs/<id>/<version>/`. It has none if `dotnet` cannot list its SDKs.
 */
export function dotnetPacks(
  dotnetPath: string,
  listSdks: DotnetSdkLookup = listDotnetSdks,
): PackSource {
  let roots: Promise<string[]> | undefined;
  const packsFolders = () => {
    roots ??= listSdks(dotnetPath).then(
      (sdks) => [
        ...new Set(
          (sdks ?? []).map(({ path }) => join(dirname(path), "packs")),
        ),
      ],
      () => [],
    );
    return roots;
  };
  // The folder of the pack `id` in each packs folder, as it is cased there.
  const packFolders = async (id: string) => {
    const found: string[] = [];
    for (const root of await packsFolders()) {
      for (const entry of await subfolders(root)) {
        if (entry.toLowerCase() === id.toLowerCase()) {
          found.push(join(root, entry));
        }
      }
    }
    return found;
  };
  return {
    async versions(id) {
      const versions = new Set<string>();
      for (const folder of await packFolders(id)) {
        for (const version of await subfolders(folder)) {
          versions.add(version);
        }
      }
      return [...versions];
    },
    async folder(id, version, folder) {
      for (const pack of await packFolders(id)) {
        const path = join(pack, version, ...folder.split("/"));
        if ((await readdir(path).catch(() => [])).length > 0) {
          return path;
        }
      }
      return null;
    },
  };
}

export interface FrameworkCheckerOptions {
  /** Where to look for each pack, in order: the .NET SDK's packs folders, the global-packages cache, then nuget.org unless offline. */
  readonly sources: readonly PackSource[];
  /** Reads an assembly's identity, for a pack that lists none: only the one asked about is read. */
  readonly identify: IdentifyAssembly;
  /** Whether Xray was told not to use the network (`--offline`), so nuget.org is left out of `sources`. */
  readonly offline: boolean;
}

/**
 * Tells, as a {@link CheckFramework}, whether the reference assemblies of an
 * Assembly's target framework hold the assembly a reference names, at that
 * version or later. Each pack is found and read once, whatever Assemblies
 * and references need it.
 */
export function frameworkChecker({
  sources,
  identify,
  offline,
}: FrameworkCheckerOptions): CheckFramework {
  const reading = new Map<string, Promise<ReadPack>>();
  const read = (pack: FrameworkPack) => {
    const key = `${pack.id}/${pack.versionPrefix ?? ""}/${pack.folder}`;
    let found = reading.get(key);
    if (found === undefined) {
      found = readPack(pack, sources, offline);
      reading.set(key, found);
    }
    return found;
  };
  return async (summary, reference) => {
    const packs = frameworkPacksFor(summary);
    if (packs === null) {
      const moniker = summary.targetFramework.moniker;
      return {
        provided: null,
        reason:
          moniker === null
            ? "its target framework could not be told"
            : `Xray knows no reference assemblies for ${moniker}`,
      };
    }
    const lacking: string[] = [];
    const missing: string[] = [];
    for (const pack of packs) {
      const found = await read(pack);
      if (found.kind === "not-found") {
        missing.push(found.why);
        continue;
      }
      const holder = `${pack.id} ${found.version}, the reference assemblies of ${pack.holds},`;
      const assembly = await found.find(reference.name, identify);
      if (assembly === null) {
        lacking.push(`${holder} holds no assembly named ${reference.name}`);
      } else if (
        compareAssemblyVersions(assembly.version, reference.version) >= 0
      ) {
        return {
          provided: true,
          reason: `${holder} holds ${assembly.name} ${assembly.version}`,
        };
      } else {
        lacking.push(
          `${holder} holds ${assembly.name} only at ${assembly.version}, older than ${reference.version}`,
        );
      }
    }
    return missing.length > 0
      ? { provided: null, reason: [...missing, ...lacking].join("; ") }
      : { provided: false, reason: lacking.join("; ") };
  };
}

/** A pack read, with how to find an assembly in it; or why it was not found. */
type ReadPack =
  | {
      readonly kind: "found";
      readonly version: string;
      find(
        name: string,
        identify: IdentifyAssembly,
      ): Promise<FrameworkAssembly | null>;
    }
  | { readonly kind: "not-found"; readonly why: string };

async function readPack(
  pack: FrameworkPack,
  sources: readonly PackSource[],
  offline: boolean,
): Promise<ReadPack> {
  const wanted =
    `${pack.id} ${pack.versionPrefix === null ? (pack.preferredVersion ?? "") : `${pack.versionPrefix}x`}`.trim();
  const notFound = (why: string): ReadPack => ({
    kind: "not-found",
    why: `${wanted}, the reference assemblies of ${pack.holds}, ${why}`,
  });
  let found;
  try {
    found = await findReferencePack(pack, sources);
  } catch (error) {
    return notFound(
      `is in neither the .NET SDK's packs folder nor the global-packages cache, and ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (found === null) {
    return notFound(
      `is in neither the .NET SDK's packs folder nor the global-packages cache${offline ? ", and nuget.org was not asked (--offline)" : ", nor on nuget.org"}`,
    );
  }
  const { version, folder } = found;
  if (pack.list === null) {
    // The `.dll`s in the folder, by name, each read only once asked about.
    const files = (await readdir(folder).catch(() => [])).filter((file) =>
      /\.dll$/i.test(file),
    );
    return {
      kind: "found",
      version,
      async find(name, identify) {
        const file = files.find(
          (file) => file.toLowerCase() === `${name.toLowerCase()}.dll`,
        );
        const identity =
          file === undefined ? null : await identify(join(folder, file));
        return identity === null
          ? null
          : { name: identity.name, version: identity.version };
      },
    };
  }
  let xml: string;
  try {
    xml = await readFile(join(folder, pack.list), "utf8");
  } catch {
    return notFound(
      `is there, at ${version}, but holds no ${pack.folder}/${pack.list}`,
    );
  }
  // The highest version listed of each name, ignoring case as .NET does.
  const assemblies = new Map<string, FrameworkAssembly>();
  for (const assembly of parseFrameworkList(xml)) {
    const key = assembly.name.toLowerCase();
    const listed = assemblies.get(key);
    if (
      listed === undefined ||
      compareAssemblyVersions(assembly.version, listed.version) > 0
    ) {
      assemblies.set(key, assembly);
    }
  }
  return {
    kind: "found",
    version,
    find: (name) => Promise.resolve(assemblies.get(name.toLowerCase()) ?? null),
  };
}

async function subfolders(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
