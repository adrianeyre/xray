// The `.deps.json` beside a .NET (Core) app, as `dotnet build` writes it: which
// NuGet package, and which version of it, each of the app's assemblies came
// from. Dependency Resolution's NuGet step (FR-10.2) tries those packages
// first, as the likeliest to hold what a reference names, which the
// assembly's own name and versions do not always say: a package can be named
// otherwise than its assembly (`CommandLineParser`'s `CommandLine.dll`), and
// one assembly version can be shared by hundreds of a package's releases (the
// AWS SDK's `3.3.0.0`). It is a hint only: whatever it names is still checked
// against the reference, as any package is.

import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { NuGetPackage } from "./nuget-packages.js";

/** A NuGet package a `.deps.json` says the app uses, and the assemblies it says came from it. */
export interface DepsPackage extends NuGetPackage {
  /** The file name of each assembly, e.g. `CommandLine.dll`, as the `.deps.json` gives it. */
  readonly assemblies: readonly string[];
}

/** The `.deps.json` beside an Assembly, as far as the NuGet step reads it. */
export interface DepsJson {
  /** As an absolute path. */
  readonly path: string;
  /** Each package it names, once, in the order it names them. */
  readonly packages: readonly DepsPackage[];
}

/** Where the runtime looks for the `.deps.json` of `assembly`: beside it, `Watchman.deps.json` for `Watchman.dll`. */
export function depsJsonPath(assembly: string): string {
  return join(
    dirname(assembly),
    `${basename(assembly, extname(assembly))}.deps.json`,
  );
}

/**
 * The `.deps.json` beside `assembly`; `null` if there is none, or it cannot
 * be read as one, as then it says nothing the NuGet step can use.
 */
export async function readDepsJson(assembly: string): Promise<DepsJson | null> {
  const path = depsJsonPath(assembly);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let packages: DepsPackage[];
  try {
    packages = parseDepsJson(text);
  } catch {
    return null;
  }
  return { path, packages };
}

/**
 * The packages a `.deps.json` names: each library of `type` `package` in
 * `libraries`, as `<id>/<version>`, with the assemblies its entries in
 * `targets` give as `runtime` or `compile` assets, those of the
 * `runtimeTarget` first. A library whose id is not a NuGet package id, or
 * whose version is not a NuGet version, is left out: they are looked up by
 * them. Throws if the text is not JSON.
 */
export function parseDepsJson(text: string): DepsPackage[] {
  const deps = record(JSON.parse(text) as unknown);
  const libraries = record(deps?.["libraries"]);
  const targets = record(deps?.["targets"]);
  if (libraries === undefined || targets === undefined) {
    return [];
  }
  const runtimeTarget = record(deps?.["runtimeTarget"])?.["name"];
  const targetNames = Object.keys(targets).toSorted(
    (a, b) => Number(b === runtimeTarget) - Number(a === runtimeTarget),
  );
  const packages = new Map<
    string,
    { id: string; version: string; assemblies: string[] }
  >();
  for (const [key, library] of Object.entries(libraries)) {
    const slash = key.indexOf("/");
    const [id, version] = [key.slice(0, slash), key.slice(slash + 1)];
    if (
      slash < 0 ||
      record(library)?.["type"] !== "package" ||
      !NUGET_ID.test(id) ||
      !NUGET_VERSION.test(version)
    ) {
      continue;
    }
    const assemblies: string[] = [];
    for (const name of targetNames) {
      const entry = record(record(targets[name])?.[key]);
      for (const kind of ["runtime", "compile"]) {
        for (const asset of Object.keys(record(entry?.[kind]) ?? {})) {
          const file = asset.split("/").at(-1) ?? "";
          if (
            /\.(dll|exe)$/i.test(file) &&
            !assemblies.some((a) => a.toLowerCase() === file.toLowerCase())
          ) {
            assemblies.push(file);
          }
        }
      }
    }
    packages.set(key.toLowerCase(), { id, version, assemblies });
  }
  return [...packages.values()];
}

/** The packages in `deps` holding an assembly named `name` (ignoring case, as .NET does). */
export function packagesHolding(deps: DepsJson, name: string): DepsPackage[] {
  const fileNames = [`${name}.dll`, `${name}.exe`].map((f) => f.toLowerCase());
  return deps.packages.filter(({ assemblies }) =>
    assemblies.some((file) => fileNames.includes(file.toLowerCase())),
  );
}

// NuGet's own rule for a package id, so one is never a path.
const NUGET_ID = /^\w+(?:[.-]\w+)*$/;
// What a NuGet version can be made of; parsed as one when it is looked up.
const NUGET_VERSION = /^[0-9A-Za-z.+-]+$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
