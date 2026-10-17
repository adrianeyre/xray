// The reference assemblies the engine decompiles an Assembly with where this
// machine has not the framework it uses (FR-7, FR-12). The decompiler finds
// an Assembly's references beside it, and in the frameworks this machine has;
// but Windows Forms and WPF are part of .NET Framework, and of .NET's Windows
// Desktop framework, only on Windows. Code using a type the decompiler cannot
// find is decompiled less precisely: a form's `Dispose(bool)`, calling its
// base class's, would call itself; and BAML naming a type of WPF's it cannot
// find is decompiled without the events and fields it hooks. So, anywhere
// else, the engine is also given the
// folder of the targeting pack the .NET SDK builds such a project against,
// from the global-packages cache, or, unless offline, from nuget.org:
//
//   Microsoft.WindowsDesktop.App.Ref/<8.0.x>/ref/net8.0                       net8.0-windows
//   Microsoft.NETFramework.ReferenceAssemblies.net48/1.0.3/build/.NETFramework/v4.8   net48

import type { AssemblySummary } from "../inspect/assembly-summary.js";
import { compareVersions, parseVersion } from "./nuget-packages.js";
import type { PackageSource } from "./package-sources.js";
import {
  isNetFramework,
  NET_FRAMEWORK_REFERENCE_ASSEMBLIES,
  usesWindowsForms,
  usesWpf,
} from "./recovered-solution.js";

/** A targeting pack: the NuGet package holding a framework's reference assemblies, and where in it. */
export interface ReferencePack {
  /** The package's id. */
  readonly id: string;
  /** The versions that will do: those starting with it (`8.0.`); any, if `null`. */
  readonly versionPrefix: string | null;
  /** The version to take, where it is there, before the latest that will do. */
  readonly preferredVersion: string | null;
  /** The folder in it holding the reference assemblies, with `/` between segments. */
  readonly folder: string;
  /** What it holds, for people: `Windows Forms for .NET 8.0`, `WPF for .NET 8.0`. */
  readonly holds: string;
}

/** A targeting pack found, and where it is on disk. */
export interface FoundReferencePack {
  readonly version: string;
  /** The folder holding its reference assemblies. */
  readonly folder: string;
}

/**
 * The targeting pack the engine needs to decompile an Assembly precisely on
 * `platform` (by default, this OS): none on Windows, which has .NET
 * Framework, and the Windows Desktop framework with .NET; elsewhere, for an
 * Assembly using Windows Forms or WPF, .NET's Windows Desktop framework's for its
 * version (`Microsoft.WindowsDesktop.App.Ref`, 8.0.x for `net8.0-windows`),
 * or .NET Framework's for its version
 * (`Microsoft.NETFramework.ReferenceAssemblies.net48`). `null` if it needs
 * none, or its target framework has none.
 */
export function referencePackFor(
  summary: AssemblySummary,
  platform: NodeJS.Platform = process.platform,
): ReferencePack | null {
  const moniker = summary.targetFramework.moniker;
  const uses = [
    ...(usesWindowsForms(summary) ? ["Windows Forms"] : []),
    ...(usesWpf(summary) ? ["WPF"] : []),
  ].join(" and ");
  if (platform === "win32" || moniker === null || uses === "") {
    return null;
  }
  if (isNetFramework(moniker)) {
    const version = /^net(\d)(\d)(\d)?$/i.exec(moniker);
    if (version === null) {
      return null;
    }
    const dotted = version.slice(1).filter(Boolean).join(".");
    return {
      id: `${NET_FRAMEWORK_REFERENCE_ASSEMBLIES.id}.${moniker.toLowerCase()}`,
      versionPrefix: null,
      preferredVersion: NET_FRAMEWORK_REFERENCE_ASSEMBLIES.version,
      folder: `build/.NETFramework/v${dotted}`,
      holds: `${uses} for .NET Framework ${dotted}`,
    };
  }
  const core = /^(net(?:coreapp)?)(\d+)\.(\d+)(?:-|$)/i.exec(moniker);
  if (core === null || Number(core[2]) < 3) {
    return null;
  }
  const [, prefix, major, minor] = core as unknown as [
    string,
    string,
    string,
    string,
  ];
  return {
    id: "Microsoft.WindowsDesktop.App.Ref",
    versionPrefix: `${major}.${minor}.`,
    preferredVersion: null,
    folder: `ref/${prefix.toLowerCase()}${major}.${minor}`,
    holds: `${uses} for .NET ${Number(major) < 5 ? "Core " : ""}${major}.${minor}`,
  };
}

/**
 * Finds a targeting pack in the first of `sources` that has a version that
 * will do: its preferred version, if that is there, else the latest stable
 * one. Rejects only if a source cannot be asked (nuget.org, unreachable),
 * with why.
 */
export async function findReferencePack(
  pack: ReferencePack,
  sources: readonly Pick<PackageSource, "versions" | "folder">[],
): Promise<FoundReferencePack | null> {
  for (const source of sources) {
    const versions = (await source.versions(pack.id)).filter(
      (version) =>
        (pack.versionPrefix === null ||
          version.startsWith(pack.versionPrefix)) &&
        parseVersion(version)?.prerelease.length === 0,
    );
    const chosen =
      versions.find((version) => version === pack.preferredVersion) ??
      versions.toSorted((a, b) => compareVersions(a, b)).at(-1);
    if (chosen === undefined) {
      continue;
    }
    const folder = await source.folder(pack.id, chosen, pack.folder);
    if (folder !== null) {
      return { version: chosen, folder };
    }
  }
  return null;
}
