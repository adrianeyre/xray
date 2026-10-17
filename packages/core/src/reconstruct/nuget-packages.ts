// Dependency Resolution's NuGet step (FR-10.2): finding the NuGet package that
// holds the very assembly a reference names (its name, version and public key
// token), first in the global-packages cache, then on nuget.org unless
// offline, so the project can reference it with a `PackageReference` rather
// than have it reconstructed or copied. The packages the app's `.deps.json`
// says its assemblies came from are tried first. Which package was chosen,
// and why, is recorded for the report.

import type { AssemblyIdentity } from "../inspect/assembly-summary.js";
import { packagesHolding, type DepsJson } from "./deps-json.js";
import type { PackageSource, PackageSourceName } from "./package-sources.js";

/** A version of a NuGet package, as a `PackageReference` names it. */
export interface NuGetPackage {
  readonly id: string;
  readonly version: string;
}

/** A version of a package found to hold the assembly a reference names. */
export interface PackageCandidate extends NuGetPackage {
  /** Where it was found. */
  readonly source: PackageSourceName;
  /** The assembly in it, with `/` between segments, e.g. `lib/net6.0/Newtonsoft.Json.dll`. */
  readonly file: string;
  /** Whether that file is, byte for byte, the copy of the assembly beside the input. */
  readonly matchesCopyBeside: boolean;
}

/** What looking a reference up as a NuGet package found, and why. */
export interface PackageLookup {
  /** The reference, as the Assembly making it records it. */
  readonly reference: AssemblyIdentity;
  /** The package chosen, referenced with a `PackageReference`; `null` if there is none. */
  readonly package: PackageCandidate | null;
  /** Every package found to hold the assembly, in order of preference: the one chosen first. */
  readonly candidates: readonly PackageCandidate[];
  /** Where it was looked for, in order: nuget.org is not asked offline, or once the cache has it. */
  readonly searched: readonly PackageSourceName[];
  /** Why that package was chosen, or why there is none, for people. */
  readonly reason: string;
}

/** The copy of a referenced assembly found beside the input, if there is one of the same identity. */
export interface CopyBeside {
  /** As an absolute path. */
  readonly path: string;
  /** Its SHA-256, in lower-case hex. */
  readonly sha256: string;
  /** Its `AssemblyInformationalVersion`, often the version of the package it came from. */
  readonly informationalVersion: string | null;
}

/** Looks a reference up as a NuGet package, given the copy of it beside the input, if any. */
export type FindPackage = (
  reference: AssemblyIdentity,
  copyBeside: CopyBeside | null,
) => Promise<PackageLookup>;

/** Reads the identity of the assembly at a path; `null` if it is not a Managed Assembly. */
export type IdentifyAssembly = (
  path: string,
) => Promise<AssemblyIdentity | null>;

export interface PackageFinderOptions {
  /** Where to look, in order: the global-packages cache, then nuget.org unless offline. */
  readonly sources: readonly PackageSource[];
  readonly identify: IdentifyAssembly;
  /** Whether Xray was told not to use the network (`--offline`), so nuget.org is left out of `sources`. */
  readonly offline: boolean;
  /** The `.deps.json` beside the input, if there is one: the packages it names are tried first. */
  readonly deps?: DepsJson | null;
  /** Stops looking when aborted, rejecting with its reason. */
  readonly signal?: AbortSignal;
}

/**
 * How many versions of packages are downloaded from nuget.org, at most, for
 * one reference, whichever packages they are of. They are tried from the
 * likeliest down, so this is rarely reached; when it is, the reference falls
 * through to the next step.
 */
export const MAX_DOWNLOADS_PER_REFERENCE = 10;

/**
 * Finds packages with {@link findPackageWith}, as a {@link FindPackage}.
 */
export function packageFinder(options: PackageFinderOptions): FindPackage {
  return (reference, copyBeside) =>
    findPackageWith(reference, copyBeside, options);
}

/**
 * Looks for the NuGet package holding the assembly `reference` names: a
 * package whose `lib/` holds an assembly of the same name, version and public
 * key token. The packages the `.deps.json` beside the input says hold an
 * assembly of that name are tried first, then the package of that name (as
 * assemblies and their packages usually share one). Each source is looked in
 * in turn, stopping at the first that has one, and in each, each package in
 * turn, stopping at the first that holds it. The cache's versions are all
 * weighed; nuget.org's are downloaded one by one, the likeliest first (the
 * version the `.deps.json` names, and the one the copy beside the input says
 * it is, then the newest stable down), until one holds it; or until one holds
 * an older assembly, as the rest would too; or until one holds no assembly of
 * that name at all, as then the package is not the assembly's.
 *
 * An assembly that is not strong-named could be in anyone's package of that
 * name, so only a package holding the very file beside the input is taken
 * for one, and without a copy beside it no package is looked for at all.
 *
 * Of several packages holding it (as patch releases often share an assembly
 * version), the one holding the very file beside the input is chosen, if one
 * does; otherwise the highest version, stable before prerelease. Either way,
 * the choice is explained in its {@link PackageLookup.reason}.
 */
export async function findPackageWith(
  reference: AssemblyIdentity,
  copyBeside: CopyBeside | null,
  options: PackageFinderOptions,
): Promise<PackageLookup> {
  const what = describeAssembly(reference);
  const signed = reference.publicKeyToken !== null;
  if (!signed && copyBeside === null) {
    return {
      reference,
      package: null,
      candidates: [],
      searched: [],
      reason: `${reference.name} is not strong-named, so a package of that name could be anyone's: Xray takes one only if it holds the very file beside the input, and there is no copy of ${what} beside it, so no package was looked for.`,
    };
  }

  const listed = options.deps
    ? packagesHolding(options.deps, reference.name)
    : [];
  const searches = packageSearches(reference, listed);
  const downloads = { count: 0 };
  const searched: PackageSourceName[] = [];
  const missed: string[] = [];
  for (const source of options.sources) {
    searched.push(source.name);
    let found: readonly PackageCandidate[] = [];
    try {
      for (const search of searches) {
        const result = await searchSource(
          source,
          search,
          reference,
          copyBeside,
          options,
          downloads,
        );
        if (result.candidates.length > 0) {
          found = result.candidates;
          break;
        }
        missed.push(result.explanation);
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof SourceFailure)) {
        throw error;
      }
      missed.push(error.message);
      continue;
    }
    const candidates = found.toSorted(byPreference);
    const [chosen] = candidates;
    if (chosen !== undefined) {
      return {
        reference,
        package: chosen,
        candidates,
        searched,
        reason: explainChoice(
          what,
          candidates,
          copyBeside,
          options.deps,
          listed,
        ),
      };
    }
  }
  if (options.offline) {
    missed.push("nuget.org was not asked (--offline).");
  }
  const says =
    options.deps && listed.length > 0
      ? ` ${depsSays(options.deps, reference.name, listed)}`
      : "";
  return {
    reference,
    package: null,
    candidates: [],
    searched,
    reason: `No package holds ${what}.${says} ${missed.join(" ")}`,
  };
}

/** A package the assembly a reference names could be in, and the versions of it the `.deps.json` names. */
interface PackageSearch {
  readonly id: string;
  readonly listed: readonly string[];
}

/** The packages to look in for `reference`: those the `.deps.json` names, in its order, then the package of its name. */
function packageSearches(
  reference: AssemblyIdentity,
  listed: readonly NuGetPackage[],
): PackageSearch[] {
  const searches: { id: string; listed: string[] }[] = [];
  for (const { id, version } of [
    ...listed,
    { id: reference.name, version: undefined },
  ]) {
    let search = searches.find((s) => s.id.toLowerCase() === id.toLowerCase());
    if (search === undefined) {
      search = { id, listed: [] };
      searches.push(search);
    }
    if (version !== undefined) {
      search.listed.push(version);
    }
  }
  return searches;
}

interface SourceSearch {
  readonly candidates: readonly PackageCandidate[];
  /** Why none was found there, if none was. */
  readonly explanation: string;
}

async function searchSource(
  source: PackageSource,
  { id, listed }: PackageSearch,
  reference: AssemblyIdentity,
  copyBeside: CopyBeside | null,
  { identify }: PackageFinderOptions,
  // How many versions have been downloaded for the reference, of any package.
  downloads: { count: number },
): Promise<SourceSearch> {
  const where = SOURCE_NAMES[source.name];
  const versions = await asked(source.versions(id));
  if (versions.length === 0) {
    return {
      candidates: [],
      explanation: `There is no package named ${id} ${where}.`,
    };
  }

  const signed = reference.publicKeyToken !== null;
  const hinted = hintedVersions(versions, listed, copyBeside);
  const ordered = orderVersions(versions, hinted);
  const fileName = `${reference.name}.dll`;
  const candidates: PackageCandidate[] = [];
  // Of a package not strong-named: versions holding the assembly, but not the very file.
  let notTheFile = 0;
  let tried = 0;
  let capped = false;
  // A version holding no assembly of the name, if one stopped the downloads.
  let unnamed: string | undefined;
  for (const version of ordered) {
    if (source.remote && downloads.count === MAX_DOWNLOADS_PER_REFERENCE) {
      capped = true;
      break;
    }
    tried++;
    if (source.remote) {
      downloads.count++;
    }
    let match: PackageCandidate | undefined;
    let older = false;
    const files = await asked(source.assemblies(id, version, fileName));
    if (source.remote && files.length === 0 && !hinted.includes(version)) {
      // A package that does not hold an assembly of the name is not its package.
      unnamed = version;
      break;
    }
    for (const file of files) {
      const identity = await identify(file.localPath);
      if (identity === null) {
        continue;
      }
      if (sameAssembly(identity, reference)) {
        const matchesCopyBeside = file.sha256 === copyBeside?.sha256;
        if (
          match === undefined ||
          (matchesCopyBeside && !match.matchesCopyBeside)
        ) {
          match = {
            id,
            version,
            source: source.name,
            file: file.path,
            matchesCopyBeside,
          };
        }
      } else if (
        identity.name.toLowerCase() === reference.name.toLowerCase() &&
        compareAssemblyVersions(identity.version, reference.version) < 0
      ) {
        older = true;
      }
    }
    if (match !== undefined && !signed && !match.matchesCopyBeside) {
      notTheFile++;
      match = undefined;
    }
    if (match !== undefined) {
      candidates.push(match);
      // Downloading more could only find a version less likely to be the one.
      if (source.remote && (copyBeside === null || match.matchesCopyBeside)) {
        break;
      }
    } else if (source.remote && older && !hinted.includes(version)) {
      // Versions are tried newest first, so the rest hold older ones still.
      break;
    }
  }
  if (candidates.length > 0) {
    return { candidates, explanation: "" };
  }
  const explanation =
    notTheFile > 0
      ? `${notTheFile === 1 ? "A version" : `${notTheFile} versions`} of ${id} ${where} ${notTheFile === 1 ? "holds" : "hold"} ${reference.name} ${reference.version}, but, as it is not strong-named, only one holding the very file beside the input is taken, and ${notTheFile === 1 ? "it does not" : "none does"}.`
      : unnamed !== undefined
        ? `${id} ${unnamed} ${where} holds no ${fileName} in its lib folders, so the package is not the assembly's.`
        : tried === 0
          ? `No version of ${id} ${where} was looked at.`
          : tried === 1
            ? `The one version of ${id} ${where} looked at does not hold it.`
            : `None of the ${tried} versions of ${id} ${where} looked at holds it.`;
  return {
    candidates: [],
    explanation: !capped
      ? explanation
      : tried === 0
        ? `${explanation} ${MAX_DOWNLOADS_PER_REFERENCE} versions of other packages had already been downloaded for it, as many as Xray downloads for a reference.`
        : `${explanation} Only the ${tried} likeliest of its ${versions.length} versions were downloaded.`,
  };
}

/** A source that could not be looked in, as when nuget.org cannot be reached. */
class SourceFailure extends Error {}

/** What `request` of a source resolves; if it rejects, a {@link SourceFailure} saying why. */
async function asked<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw new SourceFailure(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

const SOURCE_NAMES: Readonly<Record<PackageSourceName, string>> = {
  "global-packages": "in the global-packages cache",
  "nuget.org": "on nuget.org",
};

/**
 * Why `candidates[0]` was chosen, of all of `candidates` (in order of
 * preference), and that the `.deps.json` names it, if it does.
 */
function explainChoice(
  what: string,
  candidates: readonly PackageCandidate[],
  copyBeside: CopyBeside | null,
  deps: DepsJson | null | undefined,
  listed: readonly NuGetPackage[],
): string {
  const [chosen, ...others] = candidates as [
    PackageCandidate,
    ...PackageCandidate[],
  ];
  const where = SOURCE_NAMES[chosen.source];
  const says =
    deps &&
    listed.some(
      ({ id, version }) =>
        id.toLowerCase() === chosen.id.toLowerCase() &&
        compareVersions(version, chosen.version) === 0,
    )
      ? ` ${depsSays(deps, fileNameOf(chosen.file), [chosen])}`
      : "";
  const holds = `${chosen.id} ${chosen.version}, ${where}, holds ${what} as ${chosen.file}`;
  const theFile = chosen.matchesCopyBeside
    ? `, the very file beside the input${copyBeside === null ? "" : ` (${copyBeside.path})`}`
    : "";
  if (others.length === 0) {
    return `${holds}${theFile}.${says}`;
  }
  const versions = candidates.map(({ version }) => version).join(", ");
  const why = chosen.matchesCopyBeside
    ? `its ${chosen.file} is the very file beside the input${copyBeside === null ? "" : ` (${copyBeside.path})`}`
    : `it is the highest${copyBeside === null ? "" : ", as none holds the very file beside the input"}: the likeliest to be what the application was built with, and the least likely to be older than another package needs`;
  return `${candidates.length} versions of ${chosen.id} ${where} hold ${what}: ${versions}. ${chosen.version} is chosen, as ${why}.${says}`;
}

/** `/app/Watchman.deps.json says the application's CommandLine is from CommandLineParser 2.9.1.` */
function depsSays(
  deps: DepsJson,
  name: string,
  packages: readonly NuGetPackage[],
): string {
  const from = packages
    .map(({ id, version }) => `${id} ${version}`)
    .join(", or ");
  return `${deps.path} says the application's ${name} is from ${from}.`;
}

/** `CommandLine` for `lib/netstandard2.0/CommandLine.dll`. */
function fileNameOf(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.(dll|exe)$/i, "");
}

/** `Newtonsoft.Json 13.0.0.0, public key token 30ad4fe6b2a6aeed`, or `…, not strong-named`. */
function describeAssembly(reference: AssemblyIdentity): string {
  const culture =
    reference.culture === null ? "" : `, culture ${reference.culture}`;
  const key =
    reference.publicKeyToken === null
      ? "not strong-named"
      : `public key token ${reference.publicKeyToken}`;
  return `${reference.name} ${reference.version}${culture}, ${key}`;
}

/** Whether two identities name the same assembly: name (ignoring case), version, culture and public key token. */
export function sameAssembly(
  a: AssemblyIdentity,
  b: AssemblyIdentity,
): boolean {
  return (
    a.name.toLowerCase() === b.name.toLowerCase() &&
    a.version === b.version &&
    (a.culture ?? "").toLowerCase() === (b.culture ?? "").toLowerCase() &&
    (a.publicKeyToken ?? "").toLowerCase() ===
      (b.publicKeyToken ?? "").toLowerCase()
  );
}

/**
 * The versions of `versions` the application says the assembly came from, as
 * each names it, in order: those the `.deps.json` names (`listed`), then the
 * one the copy beside the input names in its `AssemblyInformationalVersion`,
 * without any `+` build metadata.
 */
function hintedVersions(
  versions: readonly string[],
  listed: readonly string[],
  copyBeside: CopyBeside | null,
): string[] {
  const informational = copyBeside?.informationalVersion?.split("+")[0];
  const hinted: string[] = [];
  for (const hint of [...listed, informational]) {
    if (hint === undefined || parseVersion(hint) === null) {
      continue;
    }
    const version = versions.find((v) => compareVersions(v, hint) === 0);
    if (version !== undefined && !hinted.includes(version)) {
      hinted.push(version);
    }
  }
  return hinted;
}

/** `versions` that are NuGet versions, `hinted` first, in order, then the rest from most preferred down. */
export function orderVersions(
  versions: readonly string[],
  hinted: readonly string[] = [],
): string[] {
  const ordered = versions
    .filter(
      (version) => parseVersion(version) !== null && !hinted.includes(version),
    )
    .toSorted((a, b) => -compareVersions(a, b, { stableFirst: true }));
  return [...hinted, ...ordered];
}

/** The most preferred first: the very file beside the input, then the highest version, stable first. */
function byPreference(a: PackageCandidate, b: PackageCandidate): number {
  return (
    Number(b.matchesCopyBeside) - Number(a.matchesCopyBeside) ||
    -compareVersions(a.version, b.version, { stableFirst: true })
  );
}

interface ParsedVersion {
  /** Major, minor, patch and revision, missing parts 0. */
  readonly release: readonly [number, number, number, number];
  /** The dot-separated labels after `-`; none for a stable version. */
  readonly prerelease: readonly string[];
}

/** A NuGet version (SemVer 2.0, or the four-part versions NuGet also allows); `null` if it is not one. */
export function parseVersion(version: string): ParsedVersion | null {
  const match =
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]*)?$/.exec(
      version.trim(),
    );
  if (match === null) {
    return null;
  }
  const part = (i: number) => Number(match[i] ?? "0");
  return {
    release: [part(1), part(2), part(3), part(4)],
    prerelease: match[5] === undefined ? [] : match[5].split("."),
  };
}

/**
 * Compares NuGet versions as NuGet does: by release, then a stable version
 * above any prerelease of it, then label by label. With `stableFirst`, any
 * stable version is above any prerelease, as when choosing one. A version
 * that is not one sorts below every version.
 */
export function compareVersions(
  a: string,
  b: string,
  { stableFirst = false }: { readonly stableFirst?: boolean } = {},
): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  if (x === null || y === null) {
    return Number(x !== null) - Number(y !== null);
  }
  const stable = (v: ParsedVersion) => Number(v.prerelease.length === 0);
  if (stableFirst && stable(x) !== stable(y)) {
    return stable(x) - stable(y);
  }
  for (let i = 0; i < 4; i++) {
    const difference = (x.release[i] as number) - (y.release[i] as number);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (stable(x) !== stable(y)) {
    return stable(x) - stable(y);
  }
  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const [p, q] = [x.prerelease[i], y.prerelease[i]];
    if (p === undefined || q === undefined) {
      return p === undefined ? -1 : 1;
    }
    const [pNumber, qNumber] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    const difference =
      pNumber && qNumber
        ? Number(p) - Number(q)
        : pNumber !== qNumber
          ? Number(qNumber) - Number(pNumber)
          : ordinal(p.toLowerCase(), q.toLowerCase());
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

/** Compares two four-part assembly versions, part by part. */
export function compareAssemblyVersions(a: string, b: string): number {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

/** Not `localeCompare`, whose order depends on the ICU data Node was built with. */
function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
