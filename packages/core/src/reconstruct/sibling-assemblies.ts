// Dependency Resolution (FR-10): each reference of each Assembly of the
// Recovered Solution that is not the framework's (FR-10.1) is looked up first
// as a NuGet package, referenced with a `PackageReference` (FR-10.2); failing that, as an
// Assembly found beside the one being reconstructed. One that is the
// application's own is a Sibling Assembly (FR-10.3, FR-11), and becomes a
// project of its own, wired to those that reference it with a
// `ProjectReference`; its references are resolved in turn. One that is a third
// party's, or any, with Sibling Assemblies turned off, is a copied binary
// (FR-10.4), referenced with a `HintPath`. Anything else is an Unresolved
// Dependency (FR-10.5). How each reference was satisfied is recorded, with why.

import { readFile } from "node:fs/promises";

import type {
  AssemblyIdentity,
  AssemblySummary,
} from "../inspect/assembly-summary.js";
import type { CheckFramework } from "./framework-assemblies.js";
import {
  sameAssembly,
  type FindPackage,
  type NuGetPackage,
  type PackageLookup,
} from "./nuget-packages.js";
import { sha256 } from "./package-sources.js";

/** A Managed Assembly, and its metadata summary. */
export interface InspectedAssembly {
  /** The Assembly, as an absolute path. */
  readonly path: string;
  readonly summary: AssemblySummary;
  /** Its `AssemblyInformationalVersion`, if it has one; not part of its summary. */
  readonly informationalVersion?: string | null;
}

/**
 * The Managed Assemblies beside the input that a reference to the assembly
 * `name` could be: the files the runtime would look for it in, `<name>.dll`
 * and `<name>.exe`, that are Managed Assemblies of that name (ignoring case,
 * as .NET does). None if there are none.
 */
export type FindAssemblies = (
  name: string,
) => Promise<readonly InspectedAssembly[]>;

/** Something about the Sibling Assemblies that Xray worked around, and says so. */
export type SiblingProblem =
  | {
      /**
       * More than one Managed Assembly beside the input has the name a
       * reference asks for. One is chosen, as {@link chosen} says, and
       * reconstructed, or copied; the others are not.
       */
      readonly kind: "duplicate-assembly-name";
      /** The name, as the reference gives it. */
      readonly name: string;
      /** Each Assembly of that name, as an absolute path, in the order they were weighed. */
      readonly paths: readonly string[];
      /** The one reconstructed, or copied. */
      readonly chosen: string;
      /** What happened, for people. */
      readonly message: string;
    }
  | {
      /**
       * The Assemblies reference one another in a cycle, which projects
       * cannot: MSBuild refuses a `ProjectReference` cycle outright. The
       * reference that closes it, {@link omitted}, gets no `ProjectReference`,
       * so the project making it does not build.
       */
      readonly kind: "cyclic-reference";
      /** The names of the Assemblies in the cycle, each referencing the next, the first again last. */
      readonly cycle: readonly string[];
      /** The reference left out: the name of the Assembly making it, and of the one it names. */
      readonly omitted: { readonly from: string; readonly to: string };
      readonly message: string;
    };

/**
 * How Dependency Resolution satisfied a reference (FR-10), each step in the
 * order it is tried: the target framework, a NuGet package, a Sibling
 * Assembly reconstructed as a project, a binary beside the input copied into
 * the Recovered Solution, or nothing, which makes it an Unresolved Dependency.
 */
export type DependencyResolution =
  | "framework"
  | "nuget-package"
  | "sibling-assembly"
  | "copied-binary"
  | "unresolved";

/** A reference made by Assemblies of the solution, and how Dependency Resolution satisfied it. */
export interface ResolvedReference {
  /** The reference, as the first Assembly making it records it. */
  readonly reference: AssemblyIdentity;
  /** The names of the Assemblies making it, in the order they were looked through. */
  readonly referencedBy: readonly string[];
  readonly resolution: DependencyResolution;
  /** For `nuget-package`, the package; otherwise `null`. */
  readonly package: NuGetPackage | null;
  /** For `sibling-assembly`, its place in {@link SiblingGraph.assemblies} (0 for the input itself); otherwise `null`. */
  readonly assembly: number | null;
  /** For `copied-binary`, its place in {@link SiblingGraph.binaries}; otherwise `null`. */
  readonly binary: number | null;
  /** Why, for people. */
  readonly reason: string;
}

/**
 * A reference of the Recovered Solution's Assemblies, and how Dependency
 * Resolution satisfied it, with where that put it in the Recovered Solution,
 * as `xray-report.json` gives it.
 */
export interface Dependency {
  /** The reference, as the first Assembly making it records it. */
  readonly reference: AssemblyIdentity;
  /** The names of the Assemblies making it, in the order they were looked through. */
  readonly referencedBy: readonly string[];
  readonly resolution: DependencyResolution;
  /** For `nuget-package`, the package referenced; otherwise `null`. */
  readonly package: NuGetPackage | null;
  /** For `sibling-assembly`, the project that recovers it, relative to the Recovered Solution's folder with `/` between segments; otherwise `null`. */
  readonly projectPath: string | null;
  /** For `copied-binary`, where it was copied to, relative as {@link projectPath} is, e.g. `Dependencies/Vendor.dll`; otherwise `null`. */
  readonly copiedTo: string | null;
  /** For `sibling-assembly` and `copied-binary`, the Assembly beside the input, as an absolute path; otherwise `null`. */
  readonly path: string | null;
  /** Why, for people. */
  readonly reason: string;
}

/** A reference looked up as a NuGet package, and the Assemblies that make it. */
export interface PackageResolution extends PackageLookup {
  /** The names of the Assemblies making it, in the order they were looked through. */
  readonly referencedBy: readonly string[];
}

/**
 * The input Assembly and the Sibling Assemblies it references, how they
 * reference one another, and the NuGet packages they reference.
 */
export interface SiblingGraph {
  /** The input first, then each Sibling Assembly in the order it was found. */
  readonly assemblies: readonly InspectedAssembly[];
  /**
   * For each of {@link assemblies}, by its place there, those it references,
   * by theirs, in the order of its references; without the reference that
   * closes a cycle.
   */
  readonly references: readonly (readonly number[])[];
  /** What was worked around: duplicate names and cycles. */
  readonly problems: readonly SiblingProblem[];
  /** For each of {@link assemblies}, by its place there, the NuGet packages it references, in the order of its references. */
  readonly packageReferences: readonly (readonly NuGetPackage[])[];
  /** Each reference looked up as a NuGet package, in the order it was, whether one was found or not. */
  readonly packages: readonly PackageResolution[];
  /** The Assemblies beside the input to copy into the Recovered Solution, in the order they were found. */
  readonly binaries: readonly InspectedAssembly[];
  /** For each of {@link assemblies}, by its place there, the copied binaries it references, by their place in {@link binaries}. */
  readonly binaryReferences: readonly (readonly number[])[];
  /**
   * Every reference of every one of {@link assemblies}, once by name
   * (ignoring case), in the order they were met: each Assembly's references
   * in order, the input's first. Those to Microsoft's assemblies included.
   */
  readonly dependencies: readonly ResolvedReference[];
}

export interface DependencyOptions {
  /**
   * Tells whether the target framework of the Assembly making a reference to
   * one of Microsoft's assemblies provides it (FR-10.1): if it does not, the
   * reference is one of Microsoft's packages, and is looked up as any other,
   * though never reconstructed as a Sibling Assembly. Without it, or where it
   * cannot tell, every such reference is left to the target framework.
   */
  readonly checkFramework?: CheckFramework;
  /**
   * Looks each reference up as a NuGet package first (FR-10.2); one it finds
   * is referenced with a `PackageReference`, and is not a Sibling Assembly.
   * Without it, no reference is.
   */
  readonly findPackage?: FindPackage;
  /**
   * Whether to reconstruct Sibling Assemblies at all. Defaults to `true`;
   * without it (`--no-siblings`), only the input's references are looked
   * up, and an Assembly beside it that one names is a copied binary.
   */
  readonly siblings?: boolean;
}

/**
 * The keys Microsoft signs .NET's own assemblies, and its packages', with: the
 * ECMA key (`mscorlib`, `System`), Microsoft's (`System.Runtime`), the shared
 * framework's (`PresentationFramework`), `netstandard`'s, `System.Private.
 * CoreLib`'s, and ASP.NET Core's and `Microsoft.Extensions`'. An assembly
 * signed with one is the framework, or one of Microsoft's packages: never the
 * application's own, even when it is beside it, as in a self-contained app.
 */
export const MICROSOFT_PUBLIC_KEY_TOKENS: ReadonlySet<string> = new Set([
  "b77a5c561934e089",
  "b03f5f7f11d50a3a",
  "31bf3856ad364e35",
  "cc7b13ffcd2ddd51",
  "7cec85d7bea7798e",
  "adb9793829ddae60",
]);

/**
 * Whether a reference is to an assembly signed by Microsoft: the framework's,
 * or one of Microsoft's packages, so never a Sibling Assembly.
 */
export function isMicrosoftAssembly(reference: AssemblyIdentity): boolean {
  return (
    reference.publicKeyToken !== null &&
    MICROSOFT_PUBLIC_KEY_TOKENS.has(reference.publicKeyToken.toLowerCase())
  );
}

/**
 * Resolves the dependencies of `input` (FR-10), finding the Sibling
 * Assemblies it references, and those they reference in turn, with `find`:
 * every reference that is not the framework's is looked for beside the input,
 * once, whichever Assembly makes it. A reference to one of Microsoft's
 * assemblies is the framework's where `checkFramework` says the target
 * framework of the Assembly making it provides it, or cannot tell, or is not
 * given; otherwise it is one of Microsoft's packages, looked for as any
 * other, but copied rather than reconstructed, being Microsoft's. With `findPackage`, each is first looked up as a NuGet package, given
 * the copy of it beside the input of the same identity, if there is one; a
 * reference to a package is not looked for further. Where more than one
 * Assembly has the name asked for, one is chosen as the runtime would (the
 * `.dll`, then the first by path) and the rest are reported. That one is a
 * Sibling Assembly if it is the application's own: not strong-named, or
 * strong-named with the input's key. Otherwise, being a third party's, or if
 * `siblings` is off, it is a copied binary, whose own references are not
 * looked through. A reference nothing beside the input satisfies is
 * unresolved. A reference back to the input, or to another Assembly already
 * found, adds no Assembly; one that closes a cycle is reported, and left out
 * of {@link SiblingGraph.references}. Told of each name as it looks for it.
 */
export async function findSiblingAssemblies(
  input: InspectedAssembly,
  find: FindAssemblies,
  onLookup: (name: string) => void = () => undefined,
  { findPackage, siblings = true, checkFramework }: DependencyOptions = {},
): Promise<SiblingGraph> {
  const assemblies: InspectedAssembly[] = [input];
  const binaries: InspectedAssembly[] = [];
  const references: number[][] = [];
  const packageReferences: NuGetPackage[][] = [];
  const binaryReferences: number[][] = [];
  const problems: SiblingProblem[] = [];
  const packages: PackageLookup[] = [];
  const dependencies: (ResolvedReference & { referencedBy: string[] })[] = [];
  // Every name met, ignoring case as .NET does, by its place in dependencies.
  const found = new Map<string, number>();
  const graph = {
    assemblies,
    binaries,
    packages,
    problems,
    inputKey: input.summary.assembly.publicKeyToken,
  };
  const resolve = async (
    reference: AssemblyIdentity,
    by: AssemblySummary,
  ): Promise<Omit<ResolvedReference, "reference" | "referencedBy">> => {
    if (nameKey(reference.name) === nameKey(input.summary.assembly.name)) {
      return {
        ...UNSATISFIED,
        resolution: "sibling-assembly",
        assembly: 0,
        reason: `It is the input Assembly itself, ${input.path}.`,
      };
    }
    const microsoft = isMicrosoftAssembly(reference);
    let notFramework = "";
    if (microsoft) {
      const signed = `${reference.name} ${reference.version} is signed with one of Microsoft's keys (public key token ${(reference.publicKeyToken ?? "").toLowerCase()})`;
      const check = await checkFramework?.(by, reference);
      const framework = `${by.targetFramework.moniker ?? "the target framework"}, the target framework of ${by.assembly.name},`;
      if (check?.provided !== false) {
        return {
          ...UNSATISFIED,
          resolution: "framework",
          reason:
            check === undefined
              ? `${reference.name} is signed with one of Microsoft's keys (public key token ${(reference.publicKeyToken ?? "").toLowerCase()}), so it is the framework's, or one of Microsoft's own packages, and is left to the target framework.`
              : check.provided
                ? `${signed}, and ${framework} provides it: ${check.reason}. It is left to the target framework.`
                : `${signed}, so it is taken to be the framework's, and left to the target framework, as Xray could not tell whether ${framework} provides it: ${check.reason}.`,
        };
      }
      notFramework = `${signed}, but ${framework} does not provide it: ${check.reason}. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly. `;
    }
    onLookup(reference.name);
    const resolved = await resolveReference(
      reference,
      find,
      findPackage,
      siblings,
      microsoft,
      graph,
    );
    return { ...resolved, reason: `${notFramework}${resolved.reason}` };
  };

  // An array's iterator goes on to what is pushed onto it as it goes, so each
  // Assembly found is looked through in turn.
  for (const { summary } of assemblies) {
    const referenced: number[] = [];
    const packaged: NuGetPackage[] = [];
    const copied: number[] = [];
    for (const reference of summary.references) {
      const key = nameKey(reference.name);
      let dependency = dependencies[found.get(key) ?? -1];
      if (dependency === undefined) {
        dependency = {
          reference,
          referencedBy: [],
          ...(await resolve(reference, summary)),
        };
        found.set(key, dependencies.push(dependency) - 1);
      }
      if (!dependency.referencedBy.includes(summary.assembly.name)) {
        dependency.referencedBy.push(summary.assembly.name);
      }
      const { assembly, binary, package: chosen } = dependency;
      if (assembly !== null && !referenced.includes(assembly)) {
        referenced.push(assembly);
      }
      if (binary !== null && !copied.includes(binary)) {
        copied.push(binary);
      }
      if (chosen !== null && !packaged.some(({ id }) => id === chosen.id)) {
        packaged.push(chosen);
      }
    }
    references.push(referenced);
    packageReferences.push(packaged);
    binaryReferences.push(copied);
  }

  breakCycles(assemblies, references, problems);
  return {
    assemblies,
    references,
    problems,
    packageReferences,
    // Each name is looked up once, so its package is referenced by whichever
    // Assemblies make the reference.
    packages: packages.map((lookup) => ({
      ...lookup,
      referencedBy:
        lookup.package === null
          ? []
          : (dependencies[found.get(nameKey(lookup.reference.name)) ?? -1]
              ?.referencedBy ?? []),
    })),
    binaries,
    binaryReferences,
    dependencies,
  };
}

/** What a {@link ResolvedReference} satisfied by none of a package, an Assembly or a binary holds. */
const UNSATISFIED = { package: null, assembly: null, binary: null } as const;

/**
 * How a reference not looked up before is satisfied: by a NuGet package, with
 * `findPackage`; else by an Assembly beside the input: a Sibling Assembly,
 * added to `assemblies`, if `siblings` and it is the application's own (never
 * if it is `microsoft`'s), otherwise a copied binary, added to `binaries`;
 * else by nothing. A package
 * lookup is recorded in `packages` whatever it finds.
 */
async function resolveReference(
  reference: AssemblyIdentity,
  find: FindAssemblies,
  findPackage: FindPackage | undefined,
  siblings: boolean,
  microsoft: boolean,
  graph: {
    readonly assemblies: InspectedAssembly[];
    readonly binaries: InspectedAssembly[];
    readonly packages: PackageLookup[];
    readonly problems: SiblingProblem[];
    /** The input's public key token, which the application's own Assemblies share, if any have one. */
    readonly inputKey: string | null;
  },
): Promise<Omit<ResolvedReference, "reference" | "referencedBy">> {
  const candidates = await find(reference.name);
  // Why no package satisfies it, before saying what does.
  let notPackaged = "";
  if (findPackage !== undefined) {
    const lookup = await findPackage(
      reference,
      await copyBeside(reference, candidates),
    );
    graph.packages.push(lookup);
    if (lookup.package !== null) {
      const { id, version } = lookup.package;
      return {
        ...UNSATISFIED,
        resolution: "nuget-package",
        package: { id, version },
        reason: lookup.reason,
      };
    }
    notPackaged =
      candidates.length === 0
        ? `${lookup.reason} `
        : "No NuGet package was found to hold it. ";
  }
  const ordered = candidates.toSorted(
    (a, b) => extensionRank(a.path) - extensionRank(b.path) || byPath(a, b),
  );
  const [chosen] = ordered;
  if (chosen === undefined) {
    return {
      ...UNSATISFIED,
      resolution: "unresolved",
      reason: `${notPackaged}No Managed Assembly named ${reference.name} is beside the input to reconstruct or copy, so nothing satisfies it.`,
    };
  }
  const key = chosen.summary.assembly.publicKeyToken?.toLowerCase() ?? null;
  const own =
    !microsoft && (key === null || key === graph.inputKey?.toLowerCase());
  const copy = !siblings || !own;
  if (ordered.length > 1) {
    const paths = ordered.map((candidate) => candidate.path);
    graph.problems.push({
      kind: "duplicate-assembly-name",
      name: reference.name,
      paths,
      chosen: chosen.path,
      message: `${ordered.length} Assemblies beside the input are named ${reference.name}: ${paths.join(", ")}. Only ${chosen.path} is ${copy ? "copied" : "reconstructed"}, as the runtime would load it.`,
    });
  }
  if (!copy) {
    return {
      ...UNSATISFIED,
      resolution: "sibling-assembly",
      assembly: graph.assemblies.push(chosen) - 1,
      reason: `${notPackaged}${chosen.path}, beside the input, is the application's own, as it is ${key === null ? "not strong-named" : "strong-named with the input's own key"}, so it is a Sibling Assembly, reconstructed as a project of its own.`,
    };
  }
  const why = !siblings
    ? `Sibling Assemblies are not reconstructed (--no-siblings), so ${chosen.path}, beside the input, is copied`
    : microsoft
      ? `${chosen.path}, beside the input, is Microsoft's, not the application's own: it is copied, not reconstructed,`
      : `${chosen.path}, beside the input, is strong-named with ${graph.inputKey === null ? "a key" : "another key than the input's"} (public key token ${key as string}), so it is a third party's, not the application's own: it is copied, not reconstructed,`;
  return {
    ...UNSATISFIED,
    resolution: "copied-binary",
    binary: graph.binaries.push(chosen) - 1,
    reason: `${notPackaged}${why} into the Recovered Solution's Dependencies folder, and referenced with a HintPath.`,
  };
}

/** The copy of the very assembly `reference` names among `candidates`, beside the input, if there is one. */
async function copyBeside(
  reference: AssemblyIdentity,
  candidates: readonly InspectedAssembly[],
): Promise<Parameters<FindPackage>[1]> {
  const copy = candidates
    .filter(({ summary }) => sameAssembly(summary.assembly, reference))
    .toSorted(
      (a, b) => extensionRank(a.path) - extensionRank(b.path) || byPath(a, b),
    )[0];
  if (copy === undefined) {
    return null;
  }
  return {
    path: copy.path,
    sha256: sha256(await readFile(copy.path)),
    informationalVersion: copy.informationalVersion ?? null,
  };
}

/**
 * Takes out of `references` each one that closes a cycle, as a depth-first
 * walk from the input meets it, reporting the cycle. What is left references
 * no Assembly that references it back, however indirectly.
 */
function breakCycles(
  assemblies: readonly InspectedAssembly[],
  references: number[][],
  problems: SiblingProblem[],
): void {
  const nameOf = (index: number) =>
    (assemblies[index] as InspectedAssembly).summary.assembly.name;
  // Walking: on the path from the input; done: everything it reaches is walked.
  const state = new Map<number, "walking" | "done">();
  const path: number[] = [];
  const walk = (from: number) => {
    state.set(from, "walking");
    path.push(from);
    const kept: number[] = [];
    for (const to of references[from] ?? []) {
      if (state.get(to) === "walking") {
        const cycle = [...path.slice(path.indexOf(to)), to].map(nameOf);
        problems.push({
          kind: "cyclic-reference",
          cycle,
          omitted: { from: nameOf(from), to: nameOf(to) },
          message: `${cycle.join(" references ")}, a cycle projects cannot have. The reference from ${nameOf(from)} to ${nameOf(to)} is left out, so ${nameOf(from)} does not build.`,
        });
        continue;
      }
      kept.push(to);
      if (!state.has(to)) {
        walk(to);
      }
    }
    references[from] = kept;
    path.pop();
    state.set(from, "done");
  };
  walk(0);
}

function nameKey(name: string): string {
  return name.toLowerCase();
}

/** A `.dll` before an `.exe`, as the runtime probes for them. */
function extensionRank(path: string): number {
  return /\.dll$/i.test(path) ? 0 : 1;
}

/** Not `localeCompare`, whose order depends on the ICU data Node was built with. */
function byPath(a: InspectedAssembly, b: InspectedAssembly): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
