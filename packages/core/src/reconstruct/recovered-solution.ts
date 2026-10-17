// What a Recovered Solution holds and where (FR-7, FR-9, FR-10.2–FR-10.4; ADR 0004):
// planned in memory from each Assembly's summary and its decompiled C#, before
// anything is written. The input Assembly's project comes first, then one for
// each Sibling Assembly, named after its own Assembly; then the binaries
// copied from beside the input, if any. Source files are laid out as the
// Assembly's PDB records them, where it was decompiled with one, else by
// namespace:
//
//   <Name>.sln
//   <Name>/<Name>.csproj
//   <Name>/Properties/AssemblyInfo.cs
//   <Name>/<its original path>.cs, or
//   <Name>/<one folder per namespace segment>/<Type>.cs
//   <Name>/<each resource, beside its type or in its namespace's folder>
//   <Sibling>/<Sibling>.csproj
//   …
//   Dependencies/<Binary>.dll

import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  AssemblySummary,
  OutputKind,
} from "../inspect/assembly-summary.js";
import type { NuGetPackage } from "./nuget-packages.js";
import {
  NO_RESOURCES,
  planResources,
  type AssemblyResources,
  type EmbeddedResourceItem,
  type RecoveredResource,
} from "./recovered-resources.js";
import { ReconstructionError } from "./reconstruction-error.js";
import {
  placeCodeBehind,
  planXaml,
  wpfResourcesToSplit,
  type WpfXaml,
  type XamlItem,
} from "./recovered-xaml.js";

/**
 * The C# version Xray decompiles to and compiles the Recovered Solution with:
 * the newest one the .NET SDK 8, the oldest SDK Xray supports, can compile.
 */
export const RECOVERED_LANGUAGE_VERSION = "12.0";

/**
 * The package of .NET Framework's reference assemblies, which a project that
 * targets .NET Framework references so it builds on any OS, not only on a
 * Windows machine with the framework's targeting pack (FR-9, ADR 0004). It is
 * the version the .NET SDK 8 would otherwise add itself, where no targeting
 * pack is installed.
 */
export const NET_FRAMEWORK_REFERENCE_ASSEMBLIES = {
  id: "Microsoft.NETFramework.ReferenceAssemblies",
  version: "1.0.3",
} as const;

/**
 * The package of `System.Resources.Extensions`, which reads a `.resources`
 * file the .NET SDK built holding anything but strings, `byte[]`s and
 * streams, such as a form's icon (FR-12). A project embedding such a file as
 * it is references it, where its framework does not hold it, so the rebuilt
 * program can read it: it is the version the .NET SDK 8, the oldest SDK Xray
 * supports, writes those files with, and it redirects the version they name
 * (4.0.0.0) to its own for .NET Framework.
 */
export const SYSTEM_RESOURCES_EXTENSIONS = {
  id: "System.Resources.Extensions",
  version: "8.0.0",
} as const;

/**
 * The type the Windows Forms source generator of .NET 6 and later writes into
 * a project that calls `ApplicationConfiguration.Initialize()`, in the global
 * namespace.
 */
const APPLICATION_CONFIGURATION = "ApplicationConfiguration";

/**
 * A top-level type, decompiled to C# by the engine, with the file-scoped types
 * it uses, which are visible only in their own file, and, decompiled with the
 * Assembly's PDB, every other type declared in the same source file.
 */
export interface DecompiledType {
  /** `""` for the global namespace. */
  readonly namespace: string;
  /** The metadata name, generic arity included, e.g. ``Pair`1``. */
  readonly name: string;
  readonly code: string;
  /**
   * If the code declares file-scoped types, the name of the file they were
   * declared in, without its extension, as their names record (`Greetings`
   * for `<Greetings>F1A2B…__Format`); otherwise `null`.
   */
  readonly sourceFile: string | null;
  /**
   * The path of the source file its types were declared in, as the
   * Assembly's PDB records it (`/src/App/Shapes/Circle.cs`, or
   * `C:\src\App\Shapes\Circle.cs`), if it was decompiled with one that does;
   * otherwise `null`.
   */
  readonly sourcePath: string | null;
  /** Every top-level type the code declares, this one first. */
  readonly declares: readonly DeclaredType[];
}

/** A top-level type, by name. */
export interface DeclaredType {
  /** `""` for the global namespace. */
  readonly namespace: string;
  /** The metadata name, generic arity included. */
  readonly name: string;
}

/** The engine's answer to `decompile` (engine/Xray.Engine/Session.cs). */
export interface DecompiledAssembly {
  /** C# declaring the assembly attributes the SDK would not generate. */
  readonly assemblyAttributes: string;
  /**
   * Whether the original was compiled with unsafe code allowed, as its
   * `[module: UnverifiableCode]` records.
   */
  readonly unsafeCode: boolean;
  /**
   * Whether any of the original was compiled with nullable annotations, as
   * its `NullableAttribute`s and `NullableContextAttribute`s record.
   */
  readonly nullableAnnotations: boolean;
  readonly types: readonly DecompiledType[];
  /**
   * The XAML of its WPF resources, decompiled from their BAML; `null`, or
   * absent, if it has none. The members the markup compiler generated of the
   * classes it names are left out of {@link types}.
   */
  readonly xaml?: WpfXaml | null;
}

/**
 * The folder of the Recovered Solution, beside its projects, that binaries
 * found beside the input are copied into (FR-10.4).
 */
export const DEPENDENCIES_FOLDER = "Dependencies";

/** A binary found beside the input, to copy into the Recovered Solution and reference with a `HintPath` (FR-10.4). */
export interface BinaryToCopy {
  /** The name of the assembly it is, which a `Reference` names. */
  readonly assemblyName: string;
  /** Where it is, as an absolute path. */
  readonly sourcePath: string;
}

/** A binary to copy into the Recovered Solution, and where. */
export interface CopiedBinary extends BinaryToCopy {
  /** Where it is copied to, relative, as in {@link PlannedFile.path}: `Dependencies/<its file name>`. */
  readonly path: string;
}

/** One file of a Recovered Solution. */
export interface PlannedFile {
  /** Relative to the Recovered Solution's folder, with `/` between segments. */
  readonly path: string;
  /** Text, written as UTF-8; or bytes, as a resource embedded as it is. */
  readonly contents: string | Uint8Array;
}

export interface SolutionPlan {
  /** The input Assembly's name, which the solution, project and its folder take. */
  readonly name: string;
  /** Relative, as in {@link PlannedFile.path}. */
  readonly solutionPath: string;
  /** The input Assembly's project. */
  readonly projectPath: string;
  /** What the input Assembly's project recovers of the original's. */
  readonly project: ProjectProperties;
  /** Every project: the input Assembly's, then each Sibling Assembly's. */
  readonly projects: readonly PlannedProject[];
  /**
   * Every file to write: the solution, then, project by project, the
   * project, its assembly attributes, each source file and each resource's
   * files.
   */
  readonly files: readonly PlannedFile[];
  /** Every binary to copy, after {@link files}, in the order given. */
  readonly binaries: readonly CopiedBinary[];
}

/** One project of a Recovered Solution: the one Assembly it recovers. */
export interface PlannedProject {
  /** The Assembly, as an absolute path. */
  readonly assemblyPath: string;
  /** Relative, as in {@link PlannedFile.path}. */
  readonly projectPath: string;
  /** What the project recovers of the original's. */
  readonly project: ProjectProperties;
  /** How many top-level types were decompiled. */
  readonly typeCount: number;
  /**
   * How many source files they were decompiled to: one for each type, but
   * one for each of the original's source files where its PDB records them,
   * and one for each file declaring file-scoped types.
   */
  readonly sourceFileCount: number;
  /**
   * What became of each resource of its Assembly, then of each of its
   * satellite assemblies, with paths relative to the Recovered Solution's
   * folder.
   */
  readonly resources: readonly RecoveredResource[];
  /**
   * Why its WPF resources were not split back into XAML files, if it has
   * them and they were not: they are then embedded as the BAML they are,
   * and their classes keep what the markup compiler generated of them.
   */
  readonly xamlNotRecovered?: string;
}

/** An Assembly to recover as a project of a Recovered Solution, and its C#. */
export interface AssemblyToRecover {
  readonly summary: AssemblySummary;
  readonly decompiled: DecompiledAssembly;
  /**
   * The other Assemblies of the solution it references, each by its place in
   * the list given to {@link planSolution}, wired with `ProjectReference`.
   */
  readonly references: readonly number[];
  /** The NuGet packages holding assemblies it references, wired with `PackageReference`. None if absent. */
  readonly packages?: readonly NuGetPackage[];
  /**
   * The binaries it references, each by its place in the list of binaries
   * given to {@link planSolution}, wired with a `Reference` and its
   * `HintPath`. None if absent.
   */
  readonly binaries?: readonly number[];
  /** Its resources, and its satellite assemblies'. None if absent. */
  readonly resources?: AssemblyResources;
}

/** The properties of the original's project that its Assembly records (FR-9). */
export interface ProjectProperties {
  /** The `<AssemblyName>`: the Assembly's name. */
  readonly assemblyName: string;
  /** The `<RootNamespace>`, as {@link recoverRootNamespace} tells it. */
  readonly rootNamespace: string;
  /** The `<TargetFramework>`, e.g. `net8.0`, or `net8.0-windows7.0`. */
  readonly targetFramework: string;
  /** The `<OutputType>`. */
  readonly outputType: ProjectOutputType;
  /**
   * Whether to build with `<UseWindowsForms>`: the Assembly references
   * Windows Forms, as an app or a library of controls does (FR-12). `false`
   * if absent.
   */
  readonly useWindowsForms?: boolean;
  /**
   * Whether the decompiled code declares the `ApplicationConfiguration` that
   * the Windows Forms source generator wrote into the original, which the
   * project then keeps the generator from writing again. `false` if absent.
   */
  readonly decompiledApplicationConfiguration?: boolean;
  /**
   * Whether to build with `<UseWPF>`: the Assembly references WPF, as an app
   * or a library of controls does, or holds BAML (FR-12). `false` if absent.
   */
  readonly useWpf?: boolean;
  /**
   * Its XAML files, which the markup compiler compiles, and the files it
   * embeds beside them, each listed as an `ApplicationDefinition`, `Page` or
   * `Resource` (see recovered-xaml.ts). None if absent.
   */
  readonly xamlItems?: readonly XamlItem[];
  /**
   * Whether to reference {@link SYSTEM_RESOURCES_EXTENSIONS}: a `.resources`
   * file embedded as it is needs it to be read, and the framework does not
   * hold it. `false` if absent.
   */
  readonly resourcesExtensions?: boolean;
  /** Whether to compile with `<AllowUnsafeBlocks>`, as the original was. */
  readonly allowUnsafeBlocks: boolean;
  /**
   * The `<Nullable>` context: `annotations` if the original has nullable
   * annotations, `null` (none, so oblivious) if not.
   */
  readonly nullable: "annotations" | null;
  /**
   * The projects of Sibling Assemblies it references, relative to its own
   * folder with `\` between segments, as Visual Studio writes them:
   * `..\Inventory\Inventory.csproj`. None if absent.
   */
  readonly projectReferences?: readonly string[];
  /** The NuGet packages it references, each holding an assembly the original references. None if absent. */
  readonly packageReferences?: readonly NuGetPackage[];
  /**
   * The binaries copied into the Recovered Solution that it references: the
   * assembly's name, and its `HintPath`, relative to the project's folder
   * with `\` between segments, as Visual Studio writes them:
   * `..\Dependencies\Vendor.dll`. None if absent.
   */
  readonly binaryReferences?: readonly {
    readonly assemblyName: string;
    readonly hintPath: string;
  }[];
  /**
   * Its embedded resources, each under the logical name the original's
   * manifest gives it, the Assembly's own, then each satellite assembly's.
   * None if absent.
   */
  readonly embeddedResources?: readonly EmbeddedResourceItem[];
}

export type ProjectOutputType = "Exe" | "WinExe" | "Library";

const OUTPUT_TYPES: Readonly<Record<OutputKind, ProjectOutputType>> = {
  console: "Exe",
  winforms: "WinExe",
  wpf: "WinExe",
  windows: "WinExe",
  library: "Library",
};

const ASSEMBLY_INFO = "Properties/AssemblyInfo.cs";

/**
 * Lays out the Recovered Solution of an Assembly: an SDK-style project that
 * keeps its name, target framework, output type, root namespace, unsafe code
 * and nullable context, a solution holding it, and one source file per
 * top-level type in a folder per namespace below the root namespace (named
 * after the type, or after the file its file-scoped types were declared in, if
 * it declares any), and its resources and its satellite assemblies' beside
 * them, as {@link planResources} lays them out. An Assembly using Windows
 * Forms gets a project that uses it too, for a Windows target framework where
 * .NET 5 or later needs one. Throws a {@link ReconstructionError} if the
 * target framework cannot be told.
 */
export function planRecoveredSolution(
  summary: AssemblySummary,
  decompiled: DecompiledAssembly,
): SolutionPlan {
  return planSolution([{ summary, decompiled, references: [] }]);
}

/**
 * Lays out the Recovered Solution of several Assemblies, the input's first, as
 * {@link planRecoveredSolution} lays out one: a project each, in a folder
 * named after its Assembly, each referencing the projects of those it
 * references with a `ProjectReference`; and a solution, named after the
 * input's, holding them all. Each of `binaries` is copied into
 * `Dependencies/`, keeping its file name, and referenced by the projects of
 * the Assemblies that reference it with a `Reference` and its `HintPath`.
 * Folders and files are kept apart case-insensitively, as Windows and macOS
 * see them. Throws a {@link ReconstructionError} if any Assembly's target
 * framework cannot be told.
 */
export function planSolution(
  assemblies: readonly [AssemblyToRecover, ...AssemblyToRecover[]],
  binaries: readonly BinaryToCopy[] = [],
): SolutionPlan {
  const name = assemblies[0].summary.assembly.name;
  const solutionPath = safeSegment(`${name}.sln`);
  // The solution's own files share its folder with the projects' folders.
  const taken = new Set([solutionPath.toLowerCase(), "xray-report.json"]);
  if (binaries.length > 0) {
    taken.add(DEPENDENCIES_FOLDER.toLowerCase());
  }
  const copiedNames = new Set<string>();
  const copied = binaries.map((binary): CopiedBinary => ({
    ...binary,
    path: `${DEPENDENCIES_FOLDER}/${claimFileName(copiedNames, safeSegment(basename(binary.sourcePath)))}`,
  }));
  const folders = assemblies.map(({ summary }) =>
    claimSegment(taken, safeSegment(summary.assembly.name)),
  );
  const projectPaths = assemblies.map(
    ({ summary }, i) =>
      `${folders[i] as string}/${safeSegment(`${summary.assembly.name}.csproj`)}`,
  );

  const projects: PlannedProject[] = [];
  const files: PlannedFile[] = [];
  for (const [
    i,
    {
      summary,
      decompiled,
      references,
      packages = [],
      binaries: used = [],
      resources = NO_RESOURCES,
    },
  ] of assemblies.entries()) {
    const folder = folders[i] as string;
    const projectPath = projectPaths[i] as string;
    const properties: ProjectProperties = {
      ...projectProperties(summary, decompiled),
      ...(references.length === 0
        ? {}
        : {
            projectReferences: references.map(
              (reference) =>
                `..\\${(projectPaths[reference] as string).replaceAll("/", "\\")}`,
            ),
          }),
      ...(packages.length === 0 ? {} : { packageReferences: packages }),
      ...(used.length === 0
        ? {}
        : {
            binaryReferences: used.map((binary) => {
              const { assemblyName, path } = copied[binary] as CopiedBinary;
              return {
                assemblyName,
                hintPath: `..\\${path.replaceAll("/", "\\")}`,
              };
            }),
          }),
    };
    const sources = new SourceLayout(properties.rootNamespace, [ASSEMBLY_INFO]);
    const recorded = recordedSourcePaths(
      decompiled.types.map((type) => type.sourcePath),
    );
    const wpf = wpfResourcesToSplit(decompiled.xaml, resources.resources);
    const split = wpf !== null && "xaml" in wpf ? wpf : null;
    const codeBehind =
      split === null
        ? new Map()
        : placeCodeBehind(split, decompiled.types, recorded, sources);
    // A file-scoped type's name records its file's, so its file keeps it.
    const sourcePaths = decompiled.types.map((type, j) => {
      const placed = codeBehind.get(j);
      if (placed !== undefined) {
        return placed.source;
      }
      const original = recorded[j];
      return original === null || original === undefined
        ? sources.claim(type.namespace, type.sourceFile ?? type.name)
        : sources.claimPath(original);
    });
    const xaml =
      split === null
        ? null
        : planXaml(split, codeBehind, sources, [
            ...split.xaml.documents.map(({ code }) => code),
            ...decompiled.types.map(({ code }) => code),
          ]);
    // The markup compiler builds the WPF resources again, from the XAML.
    const splitAt =
      split === null
        ? -1
        : resources.resources.findIndex(
            ({ name }) => name === split.resource.name,
          );
    const planned = planResources(
      splitAt < 0
        ? resources
        : {
            ...resources,
            resources: resources.resources.filter((_, k) => k !== splitAt),
          },
      sources,
      {
        rootNamespace: properties.rootNamespace,
        namespaces: decompiled.types.flatMap((type) =>
          type.declares.map((declared) => declared.namespace),
        ),
        files: new Map(
          decompiled.types.flatMap((type, j) =>
            type.declares.map(
              (declared) =>
                [
                  declared.namespace === ""
                    ? declared.name
                    : `${declared.namespace}.${declared.name}`,
                  sourcePaths[j] as string,
                ] as const,
            ),
          ),
        ),
      },
    );
    const recovered =
      xaml === null
        ? planned.resources
        : planned.resources.toSpliced(splitAt, 0, xaml.resource);
    const resourced: ProjectProperties =
      planned.readByResourcesExtensions && !windowsDesktopHolds(properties)
        ? { ...properties, resourcesExtensions: true }
        : properties;
    const embedded: ProjectProperties =
      planned.items.length === 0
        ? resourced
        : { ...resourced, embeddedResources: planned.items };
    const project: ProjectProperties =
      xaml === null || xaml.items.length === 0
        ? embedded
        : { ...embedded, useWpf: true, xamlItems: xaml.items };
    projects.push({
      assemblyPath: summary.path,
      projectPath,
      project,
      typeCount: decompiled.types.reduce(
        (count, type) => count + type.declares.length,
        0,
      ),
      sourceFileCount: decompiled.types.length,
      resources: recovered.map((resource) => ({
        ...resource,
        path: resource.path === null ? null : `${folder}/${resource.path}`,
      })),
      ...(wpf !== null && "notRecovered" in wpf
        ? { xamlNotRecovered: wpf.notRecovered }
        : {}),
    });
    files.push(
      { path: projectPath, contents: projectFile(project) },
      {
        path: `${folder}/${ASSEMBLY_INFO}`,
        contents: decompiled.assemblyAttributes,
      },
      ...decompiled.types.map((type, j) => ({
        path: `${folder}/${sourcePaths[j] as string}`,
        contents: type.code,
      })),
      ...(xaml?.files ?? []).map(({ path, contents }) => ({
        path: `${folder}/${path}`,
        contents,
      })),
      ...planned.files.map(({ path, contents }) => ({
        path: `${folder}/${path}`,
        contents,
      })),
    );
  }

  const [main] = projects as [PlannedProject, ...PlannedProject[]];
  return {
    name,
    solutionPath,
    projectPath: main.projectPath,
    project: main.project,
    projects,
    files: [
      {
        path: solutionPath,
        contents: solutionFile(
          projects.map(({ project, projectPath }) => ({
            name: project.assemblyName,
            projectPath,
          })),
        ),
      },
      ...files,
    ],
    binaries: copied,
  };
}

/** What an Assembly's project recovers of the original's. */
function projectProperties(
  summary: AssemblySummary,
  decompiled: DecompiledAssembly,
): ProjectProperties {
  const name = summary.assembly.name;
  const targetFramework = summary.targetFramework.moniker;
  if (targetFramework === null) {
    const { frameworkName, runtimeVersion } = summary.targetFramework;
    const recorded =
      frameworkName !== null
        ? `its TargetFrameworkAttribute, "${frameworkName}", names no framework a project can target`
        : /^v1\./.test(runtimeVersion)
          ? `it has no TargetFrameworkAttribute, and its CLR, ${runtimeVersion}, is .NET Framework 1.x's, which no SDK-style project can target, as no reference assemblies of it are published`
          : "it has no TargetFrameworkAttribute";
    throw new ReconstructionError(
      "unknown-target-framework",
      `Cannot tell which framework ${summary.path} targets: ${recorded}.`,
    );
  }
  const useWindowsForms = usesWindowsForms(summary);
  const useWpf = usesWpf(summary) || (decompiled.xaml ?? null) !== null;
  const decompiledApplicationConfiguration =
    useWindowsForms &&
    !isNetFramework(targetFramework) &&
    decompiled.types.some((type) =>
      type.declares.some(
        (declared) =>
          declared.namespace === "" &&
          declared.name === APPLICATION_CONFIGURATION,
      ),
    );
  return {
    assemblyName: name,
    rootNamespace: recoverRootNamespace(
      name,
      decompiled.types.flatMap((type) =>
        type.declares.map((declared) => declared.namespace),
      ),
    ),
    targetFramework:
      useWindowsForms || useWpf ? forWindows(targetFramework) : targetFramework,
    outputType: OUTPUT_TYPES[summary.outputKind],
    ...(useWindowsForms ? { useWindowsForms } : {}),
    ...(useWpf ? { useWpf } : {}),
    ...(decompiledApplicationConfiguration
      ? { decompiledApplicationConfiguration }
      : {}),
    allowUnsafeBlocks: decompiled.unsafeCode,
    nullable: decompiled.nullableAnnotations ? "annotations" : null,
  };
}

/**
 * Whether an Assembly uses Windows Forms: it references
 * `System.Windows.Forms`, which only the Windows Desktop framework of .NET,
 * and .NET Framework, hold.
 */
export function usesWindowsForms(summary: AssemblySummary): boolean {
  return summary.references.some(
    (reference) => reference.name.toLowerCase() === "system.windows.forms",
  );
}

/**
 * Whether an Assembly uses WPF: it references `PresentationFramework` or
 * `PresentationCore`, which only the Windows Desktop framework of .NET, and
 * .NET Framework, hold.
 */
export function usesWpf(summary: AssemblySummary): boolean {
  return summary.references.some((reference) =>
    ["presentationframework", "presentationcore"].includes(
      reference.name.toLowerCase(),
    ),
  );
}

/**
 * The target framework a project using the Windows Desktop framework needs:
 * as it is for .NET Framework and .NET Core 3.x, which name no platform, and
 * for a .NET 5 or later one that names it (`net8.0-windows7.0`); otherwise
 * with `-windows` (`net8.0` → `net8.0-windows`), as only a Windows target
 * framework can reference it.
 */
export function forWindows(targetFramework: string): string {
  const net5OrLater = /^net(\d+)\.\d+$/i.exec(targetFramework);
  return net5OrLater !== null && Number(net5OrLater[1]) >= 5
    ? `${targetFramework}-windows`
    : targetFramework;
}

/** Whether a target framework names Windows as its platform: `net8.0-windows7.0`. */
export function isWindowsTargetFramework(targetFramework: string): boolean {
  return /^net\d+\.\d+-windows/i.test(targetFramework);
}

/**
 * Whether a project's framework holds `System.Resources.Extensions`: .NET's
 * Windows Desktop framework does, which a project using Windows Forms or WPF
 * references, but not .NET Framework.
 */
function windowsDesktopHolds(project: ProjectProperties): boolean {
  return (
    (project.useWindowsForms === true || project.useWpf === true) &&
    !isNetFramework(project.targetFramework)
  );
}

/** `file`, or, if another has it (ignoring case), `file-2.ext`, `file-3.ext`…, claimed. */
function claimFileName(taken: Set<string>, file: string): string {
  const dot = file.lastIndexOf(".");
  const [stem, extension] =
    dot <= 0 ? [file, ""] : [file.slice(0, dot), file.slice(dot)];
  for (let n = 1; ; n++) {
    const claimed = n === 1 ? file : `${stem}-${n}${extension}`;
    if (!taken.has(claimed.toLowerCase())) {
      taken.add(claimed.toLowerCase());
      return claimed;
    }
  }
}

/** `segment`, or, if another has it (ignoring case), `segment-2`, `segment-3`…, claimed. */
function claimSegment(taken: Set<string>, segment: string): string {
  for (let n = 1; ; n++) {
    const claimed = n === 1 ? segment : `${segment}-${n}`;
    if (!taken.has(claimed.toLowerCase())) {
      taken.add(claimed.toLowerCase());
      return claimed;
    }
  }
}

/**
 * The root namespace the original's project most likely had, which is not
 * recorded in its Assembly, from the namespaces of its types: the Assembly's
 * name, the default, if every type is in that namespace or below it;
 * otherwise the longest namespace every type is in or below, if there is one;
 * otherwise the Assembly's name again. Types in the global namespace (`""`)
 * say nothing either way.
 */
export function recoverRootNamespace(
  assemblyName: string,
  namespaces: Iterable<string>,
): string {
  let shared: string[] | undefined;
  let allInAssemblyName = true;
  for (const namespace of namespaces) {
    if (namespace === "") {
      continue;
    }
    if (
      namespace !== assemblyName &&
      !namespace.startsWith(`${assemblyName}.`)
    ) {
      allInAssemblyName = false;
    }
    const segments = namespace.split(".");
    if (shared === undefined) {
      shared = segments;
      continue;
    }
    let common = 0;
    while (common < shared.length && shared[common] === segments[common]) {
      common++;
    }
    shared = shared.slice(0, common);
  }
  if (allInAssemblyName || shared === undefined || shared.length === 0) {
    return assemblyName;
  }
  return shared.join(".");
}

// Folders the build writes its own sources into, such as those source
// generators write, rather than the original's author.
const GENERATED_FOLDER = /^obj$/i;

/**
 * Where each of the source files a PDB records goes in a project folder (FR-4,
 * FR-7): at its path below the folder that holds every one of them, which
 * was most likely the original's project folder, as segments
 * (`/src/App/Shapes/Circle.cs` → `Shapes`, `Circle.cs`). Files below a folder
 * named `obj`, which the build generated, do not decide that folder, unless
 * every file is. `null` for each that is not a C# file (`.cs`), that lies
 * outside that folder or that the PDB does not record, which is laid out by
 * namespace instead.
 */
export function recordedSourcePaths(
  sourcePaths: readonly (string | null)[],
): (string[] | null)[] {
  const segmented = sourcePaths.map((path) => {
    const segments = path?.split(/[\\/]+/).filter((segment) => segment !== "");
    return segments === undefined ||
      segments.length === 0 ||
      !/\.cs$/i.test(segments[segments.length - 1] as string) ||
      segments.some((segment) => segment === "." || segment === "..")
      ? null
      : segments;
  });
  const candidates = segmented.filter((path) => path !== null);
  const authored = candidates.filter(
    (path) =>
      !path.slice(0, -1).some((segment) => GENERATED_FOLDER.test(segment)),
  );
  const deciding = authored.length > 0 ? authored : candidates;
  let root: string[] | undefined;
  for (const path of deciding) {
    const folders = path.slice(0, -1);
    if (root === undefined) {
      root = folders;
      continue;
    }
    let common = 0;
    while (
      common < root.length &&
      common < folders.length &&
      sameSegment(root[common] as string, folders[common] as string)
    ) {
      common++;
    }
    root = root.slice(0, common);
  }
  return segmented.map((path) =>
    path === null ||
    root === undefined ||
    path.length <= root.length ||
    !root.every((segment, i) => sameSegment(segment, path[i] as string))
      ? null
      : path.slice(root.length),
  );
}

/** As Windows and macOS compare a path's segments, ignoring case. */
function sameSegment(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Where each type's source file goes in the project folder, as Visual Studio
 * lays out a project with the given root namespace: a type in that namespace
 * at the top, one in `<Root>.A.B` (or any other `A.B`) in `A/B/`; or, laid out
 * by its PDB, at its original path. Paths are kept apart case-insensitively,
 * as Windows and macOS see them.
 */
export class SourceLayout {
  readonly #rootNamespace: string;
  readonly #claimed = new Set<string>();
  // The case each folder was first claimed in, by its path, lowercased.
  readonly #folderCase = new Map<string, string>();

  /** `reserved` are project-relative paths already taken. */
  constructor(rootNamespace: string, reserved: readonly string[] = []) {
    this.#rootNamespace = rootNamespace;
    for (const path of reserved) {
      this.#claimed.add(path.toLowerCase());
    }
  }

  /**
   * The path of the file for the type `name` (its metadata name) in
   * `namespace`: the type's name without its generic arity, made safe for
   * every OS. Should another type already have it, `-2`, `-3`… is added,
   * which no C# type name can contain.
   */
  claim(namespace: string, name: string): string {
    return this.#claimFile(
      this.folders(namespace),
      safeSegment(name.replace(/`\d+$/, "")),
      ".cs",
    );
  }

  /**
   * The path of the file at `segments` below the project folder, as
   * {@link recordedSourcePaths} gives it (`Shapes`, `Circle.cs`), made safe
   * for every OS. Should another file already have it, `-2`, `-3`… is added
   * before its extension.
   */
  claimPath(segments: readonly string[]): string {
    const folders = segments.slice(0, -1).map(safeSegment);
    const file = safeSegment(segments[segments.length - 1] ?? "_.cs");
    const dot = file.lastIndexOf(".");
    return dot <= 0
      ? this.#claimFile(folders, file, "")
      : this.#claimFile(folders, file.slice(0, dot), file.slice(dot));
  }

  /**
   * As {@link claimPath}, but each folder that a path already claimed has,
   * ignoring case, keeps the case it was claimed in, so no folder is two
   * folders on an OS that tells case apart.
   */
  claimInFolders(segments: readonly string[]): string {
    const folders: string[] = [];
    for (const segment of segments.slice(0, -1).map(safeSegment)) {
      const prefix = [...folders, segment].join("/").toLowerCase();
      folders.push(this.#folderCase.get(prefix) ?? segment);
    }
    return this.claimPath([...folders, segments[segments.length - 1] ?? "_"]);
  }

  #claimFile(folders: readonly string[], base: string, extension: string) {
    for (let n = 1; ; n++) {
      const file = n === 1 ? `${base}${extension}` : `${base}-${n}${extension}`;
      const path = [...folders, file].join("/");
      if (!this.#claimed.has(path.toLowerCase())) {
        this.#claimed.add(path.toLowerCase());
        for (let i = 1; i <= folders.length; i++) {
          const prefix = folders.slice(0, i).join("/").toLowerCase();
          if (!this.#folderCase.has(prefix)) {
            this.#folderCase.set(prefix, folders[i - 1] as string);
          }
        }
        return path;
      }
    }
  }

  /**
   * The folders a type of `namespace` is in, below the project folder, made
   * safe for every OS: none for the root namespace or the global one, `A`,
   * `B` for `<Root>.A.B`, or for `A.B`.
   */
  folders(namespace: string): string[] {
    const root = this.#rootNamespace;
    if (namespace === "" || namespace === root) {
      return [];
    }
    const relative = namespace.startsWith(`${root}.`)
      ? namespace.slice(root.length + 1)
      : namespace;
    return relative.split(".").map(safeSegment);
  }
}

// Characters Windows does not allow in a file name, and control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
// Names Windows keeps for devices, with or without an extension.
const DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
// Folders the SDK leaves out of a project's sources: its build output, and
// any whose name starts with a dot.
const EXCLUDED_FOLDER = /^(bin|obj)$|^\./i;

/**
 * A name made safe as one segment of a path on every OS, and as a folder the
 * SDK compiles: unsafe characters become `_`, as does a trailing dot or space
 * (which Windows drops); a device name, `bin`, `obj` or a leading dot gets a
 * leading `_`.
 */
export function safeSegment(name: string): string {
  let safe = name.replace(UNSAFE_CHARACTERS, "_").replace(/[. ]$/, "_");
  if (safe === "") {
    return "_";
  }
  if (DEVICE_NAME.test(safe) || EXCLUDED_FOLDER.test(safe)) {
    safe = `_${safe}`;
  }
  return safe;
}

/**
 * An SDK-style project (ADR 0004) with the original's properties. The SDK
 * generates no assembly attributes of its own, so the build declares only the
 * original's, from `Properties/AssemblyInfo.cs`, and those the compiler adds
 * itself, such as the `UnverifiableCode` of a project that allows unsafe
 * code. The nullable context is `annotations`, not `enable`: an Assembly
 * records its nullable annotations but not whether its build warned, and
 * decompiled code draws warnings the original's source did not. A project for
 * .NET Framework references {@link NET_FRAMEWORK_REFERENCE_ASSEMBLIES}, so it
 * builds on any OS. A project recovering an Assembly that references Sibling
 * Assemblies references their projects; one that references assemblies held
 * by NuGet packages references those packages; one that references binaries
 * copied into the Recovered Solution references each by its `HintPath`. A
 * project with resources lists each `EmbeddedResource` under the logical name
 * the original's manifest gives it, private ones `Access="Private"`, rather
 * than embedding every `.resx` under a name of the SDK's making; a file
 * embedded as it is that the SDK would otherwise compile (a `.cs`, or a
 * `.resx`) is kept from that. A project whose Assembly uses Windows Forms
 * builds with `UseWindowsForms` (FR-12); one for a Windows target framework
 * (`net8.0-windows7.0`) sets `EnableWindowsTargeting`, so it builds on any OS
 * though it runs only on Windows (ADR 0004); one whose decompiled code holds
 * the `ApplicationConfiguration` the Windows Forms source generator wrote
 * removes that generator, which would write it again. One embedding as it is
 * a `.resources` file that `System.Resources.Extensions` reads, where its
 * framework does not hold it, references
 * {@link SYSTEM_RESOURCES_EXTENSIONS}.
 */
export function projectFile(project: ProjectProperties): string {
  const { id, version } = NET_FRAMEWORK_REFERENCE_ASSEMBLIES;
  const {
    targetFramework,
    embeddedResources: resources = [],
    xamlItems = [],
  } = project;
  const xaml = xamlItems.filter(({ itemType }) => itemType !== "Resource");
  const wpfResources = xamlItems.filter(
    ({ itemType }) => itemType === "Resource",
  );
  const compiled = resources.filter(
    ({ include, kind }) => kind === "file" && /\.cs$/i.test(include),
  );
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "",
    "  <PropertyGroup>",
    `    <AssemblyName>${escapeXml(project.assemblyName)}</AssemblyName>`,
    `    <RootNamespace>${escapeXml(project.rootNamespace)}</RootNamespace>`,
    `    <OutputType>${project.outputType}</OutputType>`,
    `    <TargetFramework>${escapeXml(targetFramework)}</TargetFramework>`,
    ...(project.useWindowsForms === true
      ? ["    <UseWindowsForms>true</UseWindowsForms>"]
      : []),
    ...(project.useWpf === true ? ["    <UseWPF>true</UseWPF>"] : []),
    ...(isWindowsTargetFramework(targetFramework)
      ? [
          "    <!-- A Windows app builds on any OS, though it runs only on Windows. -->",
          "    <EnableWindowsTargeting>true</EnableWindowsTargeting>",
        ]
      : []),
    `    <LangVersion>${RECOVERED_LANGUAGE_VERSION}</LangVersion>`,
    ...(project.allowUnsafeBlocks
      ? ["    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>"]
      : []),
    ...(project.nullable === null
      ? []
      : [
          "    <!-- The original's nullable annotations; its Assembly does not record whether its build warned. -->",
          `    <Nullable>${project.nullable}</Nullable>`,
        ]),
    "    <!-- Properties/AssemblyInfo.cs declares the original's assembly attributes. -->",
    "    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>",
    ...(resources.length === 0
      ? []
      : [
          "    <!-- Each resource is listed below, under the name the original gives it. -->",
          "    <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>",
        ]),
    ...(xaml.length === 0
      ? []
      : [
          "    <!-- Each XAML file is listed below, as the original's project had it. -->",
          "    <EnableDefaultPageItems>false</EnableDefaultPageItems>",
          "    <EnableDefaultApplicationDefinition>false</EnableDefaultApplicationDefinition>",
        ]),
    "  </PropertyGroup>",
    "",
    ...(isNetFramework(targetFramework)
      ? [
          "  <ItemGroup>",
          "    <!-- The framework's reference assemblies, so this builds on any OS. -->",
          `    <PackageReference Include="${id}" Version="${version}" PrivateAssets="all" />`,
          "  </ItemGroup>",
          "",
        ]
      : []),
    ...(project.resourcesExtensions === true
      ? [
          "  <ItemGroup>",
          "    <!-- Reads the resources embedded as they are that hold more than strings, byte[]s and streams. -->",
          `    <PackageReference Include="${SYSTEM_RESOURCES_EXTENSIONS.id}" Version="${SYSTEM_RESOURCES_EXTENSIONS.version}" />`,
          "  </ItemGroup>",
          "",
        ]
      : []),
    ...(project.packageReferences === undefined ||
    project.packageReferences.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- NuGet packages, each holding an assembly the original references. -->",
          ...project.packageReferences.map(
            ({ id, version }) =>
              `    <PackageReference Include="${escapeXml(id)}" Version="${escapeXml(version)}" />`,
          ),
          "  </ItemGroup>",
          "",
        ]),
    ...(project.binaryReferences === undefined ||
    project.binaryReferences.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- Binaries found beside the original, copied into Dependencies and referenced as they are. -->",
          ...project.binaryReferences.flatMap(({ assemblyName, hintPath }) => [
            `    <Reference Include="${escapeXml(assemblyName)}">`,
            `      <HintPath>${escapeXml(hintPath)}</HintPath>`,
            "    </Reference>",
          ]),
          "  </ItemGroup>",
          "",
        ]),
    ...(project.projectReferences === undefined ||
    project.projectReferences.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- Sibling Assemblies, each recovered as a project of its own. -->",
          ...project.projectReferences.map(
            (reference) =>
              `    <ProjectReference Include="${escapeXml(reference)}" />`,
          ),
          "  </ItemGroup>",
          "",
        ]),
    ...(resources.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- The original's resources: each .resx compiles back to the .resources file it was; any other file is embedded as it is. -->",
          ...resources.map(
            ({ include, logicalName, public: isPublic, kind }) =>
              `    <EmbeddedResource Include="${msbuildAttribute(include.replaceAll("/", "\\"))}" LogicalName="${msbuildAttribute(logicalName)}"${isPublic ? "" : ' Access="Private"'}${kind === "file" && /\.resx$/i.test(include) ? ' Type="Non-Resx"' : ""} />`,
          ),
          "  </ItemGroup>",
          "",
          ...(compiled.length === 0
            ? []
            : [
                "  <ItemGroup>",
                "    <!-- Resources, not sources. -->",
                ...compiled.map(
                  ({ include }) =>
                    `    <Compile Remove="${msbuildAttribute(include.replaceAll("/", "\\"))}" />`,
                ),
                "  </ItemGroup>",
                "",
              ]),
        ]),
    ...(xaml.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- The original's XAML, decompiled from its BAML: the markup compiler compiles each file back, and generates the code its code-behind leaves out. -->",
          ...xaml.map(
            ({ itemType, include }) =>
              `    <${itemType} Include="${msbuildAttribute(include.replaceAll("/", "\\"))}" />`,
          ),
          "  </ItemGroup>",
          "",
        ]),
    ...(wpfResources.length === 0
      ? []
      : [
          "  <ItemGroup>",
          "    <!-- The files the original's WPF resources held beside its BAML, which the build puts back beside it. -->",
          ...wpfResources.map(
            ({ include }) =>
              `    <Resource Include="${msbuildAttribute(include.replaceAll("/", "\\"))}" />`,
          ),
          "  </ItemGroup>",
          "",
        ]),
    ...(project.decompiledApplicationConfiguration === true
      ? [
          "  <!--",
          "    ApplicationConfiguration is decompiled from the original, into which the",
          "    Windows Forms source generator wrote it; keep the generator from writing it again.",
          "  -->",
          '  <Target Name="KeepDecompiledApplicationConfiguration" AfterTargets="ResolveTargetingPackAssets">',
          "    <ItemGroup>",
          "      <Analyzer Remove=\"@(Analyzer)\" Condition=\"'%(Filename)' == 'System.Windows.Forms.Analyzers.CSharp'\" />",
          "    </ItemGroup>",
          "  </Target>",
          "",
        ]
      : []),
    "</Project>",
    "",
  ].join("\n");
}

/**
 * Whether a target framework moniker names .NET Framework: `net` and a
 * version without dots (`net48`, `net481`, `net40-client`), where .NET 5 and
 * later have one (`net8.0`).
 */
export function isNetFramework(targetFramework: string): boolean {
  return /^net\d+(-client)?$/i.test(targetFramework);
}

// The project type Visual Studio and `dotnet sln` give C# projects.
const CSHARP_PROJECT_TYPE = "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}";
const CONFIGURATIONS = ["Debug|Any CPU", "Release|Any CPU"];

/** A project of a solution: its name, and where it is, relative to the solution's folder. */
export interface SolutionProject {
  readonly name: string;
  /** With `/` between segments. */
  readonly projectPath: string;
}

/** A Visual Studio solution holding the projects, in order, as `dotnet sln` writes one. */
export function solutionFile(projects: readonly SolutionProject[]): string {
  const ids = projects.map(({ name }) => projectGuid(name));
  return [
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio Version 17",
    "VisualStudioVersion = 17.0.31903.59",
    "MinimumVisualStudioVersion = 10.0.40219.1",
    ...projects.flatMap(({ name, projectPath }, i) => [
      `Project("${CSHARP_PROJECT_TYPE}") = "${name}", "${projectPath.replaceAll("/", "\\")}", "${ids[i] as string}"`,
      "EndProject",
    ]),
    "Global",
    "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
    ...CONFIGURATIONS.map((c) => `\t\t${c} = ${c}`),
    "\tEndGlobalSection",
    "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
    ...ids.flatMap((id) =>
      CONFIGURATIONS.flatMap((c) => [
        `\t\t${id}.${c}.ActiveCfg = ${c}`,
        `\t\t${id}.${c}.Build.0 = ${c}`,
      ]),
    ),
    "\tEndGlobalSection",
    "\tGlobalSection(SolutionProperties) = preSolution",
    "\t\tHideSolutionNode = FALSE",
    "\tEndGlobalSection",
    "EndGlobal",
    "",
  ].join("\n");
}

/** The same for the same name, so reconstructing an Assembly again changes nothing. */
function projectGuid(name: string): string {
  const hex = createHash("sha256").update(`xray:${name}`).digest("hex");
  // A name-based (version 5 layout) GUID of the RFC 4122 variant.
  const variant = ((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}}`.toUpperCase();
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Text as an attribute of an MSBuild item, as given: the characters MSBuild
 * reads as its own (`%`, `$`, `@`, `;`, `'`, `*`, `?`) escaped as `%XX`, then
 * escaped for XML.
 */
function msbuildAttribute(text: string): string {
  return escapeXml(
    text.replace(
      /[%$@;'*?]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  )
    .replaceAll('"', "&quot;")
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f]/g,
      (c) => `&#x${c.charCodeAt(0).toString(16).toUpperCase()};`,
    );
}
