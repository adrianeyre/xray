// Where Dependency Resolution's NuGet step looks for packages (FR-10.2): the
// local global-packages cache, then nuget.org. Only package identifiers and
// versions go over the network (PRD §8): nuget.org is asked which versions of
// a package there are, and for a version's `.nupkg`; never sent a file.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { nupkgEntries, readNupkgEntry } from "./nupkg.js";

/** Where a package was found: the global-packages cache, or nuget.org. */
export type PackageSourceName = "global-packages" | "nuget.org";

/** An assembly file a package holds in one of its `lib/` folders. */
export interface PackageFile {
  /** Its path in the package, with `/` between segments, e.g. `lib/net6.0/Newtonsoft.Json.dll`. */
  readonly path: string;
  /** Where it is on disk, for the engine to read. */
  readonly localPath: string;
  /** The SHA-256 of its contents, in lower-case hex. */
  readonly sha256: string;
}

/** Somewhere NuGet packages can be found. */
export interface PackageSource {
  readonly name: PackageSourceName;
  /** Whether looking in it goes over the network, so is worth doing sparingly. */
  readonly remote: boolean;
  /** Every version of the package `id` it has, as it names them; none if it has no such package. */
  versions(id: string): Promise<readonly string[]>;
  /** The files named `fileName` (ignoring case) in the `lib/` folders of a version of a package. */
  assemblies(
    id: string,
    version: string,
    fileName: string,
  ): Promise<readonly PackageFile[]>;
  /**
   * A folder on disk holding every file below `folder` (with `/` between
   * segments, e.g. `ref/net8.0`) in a version of a package, as it lays them
   * out, for the engine to read; `null` if it has no such package, or the
   * package no such folder.
   */
  folder(id: string, version: string, folder: string): Promise<string | null>;
}

/** nuget.org's service index (NuGet's V3 API), from which the rest is found. */
export const NUGET_ORG_SERVICE_INDEX = "https://api.nuget.org/v3/index.json";

/**
 * The global-packages folder NuGet restores into, and so the cache Xray
 * looks in: `NUGET_PACKAGES` if set, else `.nuget/packages` in the home
 * folder, as NuGet's own default is.
 */
export function defaultGlobalPackagesFolder(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env["NUGET_PACKAGES"];
  return configured === undefined || configured === ""
    ? join(homedir(), ".nuget", "packages")
    : configured;
}

/**
 * The global-packages cache at `root`, laid out as NuGet restores into it:
 * `<id>/<version>/`, both lower-case, a version counted only once NuGet has
 * finished extracting it.
 */
export function globalPackagesFolder(root: string): PackageSource {
  return {
    name: "global-packages",
    remote: false,
    async versions(id) {
      const folder = join(root, id.toLowerCase());
      const versions = await folders(folder);
      return versions.filter(
        (version) =>
          existsSync(join(folder, version, ".nupkg.metadata")) ||
          existsSync(
            join(
              folder,
              version,
              `${id.toLowerCase()}.${version}.nupkg.sha512`,
            ),
          ),
      );
    },
    async assemblies(id, version, fileName) {
      const lib = join(root, id.toLowerCase(), version, "lib");
      const files: PackageFile[] = [];
      for (const framework of await folders(lib)) {
        const entries = await readdir(join(lib, framework), {
          withFileTypes: true,
        }).catch(() => []);
        for (const entry of entries) {
          if (
            entry.isFile() &&
            entry.name.toLowerCase() === fileName.toLowerCase()
          ) {
            const localPath = join(lib, framework, entry.name);
            files.push({
              path: `lib/${framework}/${entry.name}`,
              localPath,
              sha256: sha256(await readFile(localPath)),
            });
          }
        }
      }
      return files;
    },
    async folder(id, version, folder) {
      const path = join(
        root,
        id.toLowerCase(),
        version.toLowerCase(),
        ...folder.split("/"),
      );
      return (await readdir(path).catch(() => [])).length > 0 ? path : null;
    },
  };
}

export interface NuGetOrgOptions {
  /** How it is asked. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Its service index. Defaults to {@link NUGET_ORG_SERVICE_INDEX}. */
  readonly serviceIndex?: string;
  /** Stops any request when aborted. */
  readonly signal?: AbortSignal;
}

/** nuget.org, as a {@link PackageSource} whose downloads are deleted by `dispose`. */
export interface NuGetOrg extends PackageSource {
  /** Deletes the files taken out of the packages it downloaded. */
  dispose(): Promise<void>;
}

// Per request: a .nupkg can be tens of MiB.
const REQUEST_TIMEOUT_MS = 2 * 60_000;
// A .nupkg can be at most 250 MB on nuget.org.
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/**
 * nuget.org, asked through its V3 API's package base address: a package's
 * versions, `<base>/<id>/index.json`, and a version's `.nupkg`,
 * `<base>/<id>/<version>/<id>.<version>.nupkg`, so only package identifiers
 * and versions are sent. The assemblies asked for are taken out of each
 * `.nupkg` into a temporary folder for the engine to read. Should a request
 * fail, every later one fails the same way at once, rather than wait for
 * nuget.org again.
 */
export function nugetOrg(options: NuGetOrgOptions = {}): NuGetOrg {
  const fetch = options.fetch ?? globalThis.fetch;
  const serviceIndex = options.serviceIndex ?? NUGET_ORG_SERVICE_INDEX;
  let failure: Error | undefined;
  let baseAddress: Promise<string> | undefined;
  let scratch: Promise<string> | undefined;

  // Reads what `url` answers with `read`; null if there is no such thing.
  const get = async <T>(
    url: string,
    read: (response: Response) => Promise<T>,
  ): Promise<T | null> => {
    if (failure !== undefined) {
      throw failure;
    }
    try {
      const signal = AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(options.signal === undefined ? [] : [options.signal]),
      ]);
      const response = await fetch(url, { signal });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `${url} answered ${response.status} ${response.statusText}`.trim(),
        );
      }
      return await read(response);
    } catch (error) {
      options.signal?.throwIfAborted();
      failure = new Error(
        `nuget.org could not be asked: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
      throw failure;
    }
  };
  const json = (url: string): Promise<unknown> =>
    get(url, (response) => response.json() as Promise<unknown>);
  const packageBaseAddress = () => {
    baseAddress ??= json(serviceIndex).then((index) => {
      const resources = (index as { resources?: unknown } | null)?.resources;
      const resource = Array.isArray(resources)
        ? (resources as Record<string, unknown>[]).find(
            (r) =>
              typeof r["@type"] === "string" &&
              r["@type"].startsWith("PackageBaseAddress/3.0.0") &&
              typeof r["@id"] === "string",
          )
        : undefined;
      if (resource === undefined) {
        failure = new Error(
          `nuget.org could not be asked: its service index, ${serviceIndex}, names no PackageBaseAddress/3.0.0.`,
        );
        throw failure;
      }
      const id = resource["@id"] as string;
      return id.endsWith("/") ? id : `${id}/`;
    });
    return baseAddress;
  };

  // A version's .nupkg; null if nuget.org has no such package.
  const nupkg = (id: string, version: string): Promise<Buffer | null> =>
    packageBaseAddress().then((base) => {
      const [lowerId, lowerVersion] = [segment(id), segment(version)];
      return get(
        `${base}${lowerId}/${lowerVersion}/${lowerId}.${lowerVersion}.nupkg`,
        async (response) => {
          if (
            Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES
          ) {
            throw new Error(
              `${id} ${version}'s package is larger than Xray downloads.`,
            );
          }
          return Buffer.from(await response.arrayBuffer());
        },
      );
    });
  // Where what is taken out of a version's .nupkg goes.
  const scratchFor = async (id: string, version: string): Promise<string> => {
    scratch ??= mkdtemp(join(tmpdir(), "xray-nuget-"));
    return join(await scratch, segment(id), segment(version));
  };

  const dispose = async () => {
    if (scratch !== undefined) {
      const folder = await scratch.catch(() => undefined);
      if (folder !== undefined) {
        await rm(folder, { recursive: true, force: true, maxRetries: 5 });
      }
    }
  };
  return {
    name: "nuget.org",
    remote: true,
    async versions(id) {
      const index = await json(
        `${await packageBaseAddress()}${segment(id)}/index.json`,
      );
      const versions = (index as { versions?: unknown } | null)?.versions;
      return Array.isArray(versions)
        ? versions.filter(
            (version): version is string => typeof version === "string",
          )
        : [];
    },
    async assemblies(id, version, fileName) {
      const archive = await nupkg(id, version);
      if (archive === null) {
        return [];
      }
      const folder = await scratchFor(id, version);
      const files: PackageFile[] = [];
      for (const entry of nupkgEntries(archive)) {
        const [lib, framework, name, ...rest] = entry.path.split("/");
        if (
          lib?.toLowerCase() !== "lib" ||
          framework === undefined ||
          name?.toLowerCase() !== fileName.toLowerCase() ||
          rest.length > 0
        ) {
          continue;
        }
        const contents = readNupkgEntry(archive, entry);
        const localPath = join(folder, `${files.length}-${fileName}`);
        await mkdir(folder, { recursive: true });
        await writeFile(localPath, contents);
        files.push({
          path: `lib/${framework}/${name}`,
          localPath,
          sha256: sha256(contents),
        });
      }
      return files;
    },
    async folder(id, version, folder) {
      const archive = await nupkg(id, version);
      if (archive === null) {
        return null;
      }
      const prefix = `${folder.toLowerCase()}/`;
      const below = nupkgEntries(archive).filter(
        (entry) =>
          entry.path.toLowerCase().startsWith(prefix) &&
          !entry.path.endsWith("/"),
      );
      if (below.length === 0) {
        return null;
      }
      const target = join(await scratchFor(id, version), ...folder.split("/"));
      for (const entry of below) {
        const segments = entry.path.slice(prefix.length).split("/");
        if (
          segments.some((part) => part === "" || part === "." || part === "..")
        ) {
          continue;
        }
        const path = join(target, ...segments);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, readNupkgEntry(archive, entry));
      }
      return target;
    },
    dispose,
  };
}

/** The SHA-256 of `contents`, in lower-case hex. */
export function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** A package id or version as the package base address names it: lower-case, and escaped. */
function segment(text: string): string {
  return encodeURIComponent(text.toLowerCase());
}

async function folders(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
