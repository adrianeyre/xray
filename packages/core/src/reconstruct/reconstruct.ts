import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  startEngine,
  type EngineClient,
  type EngineOptions,
} from "../engine/engine-client.js";
import { EngineError } from "../engine/engine-error.js";
import type { EngineProgress } from "../engine/protocol.js";
import { inputAssemblyAt } from "../input/choose-input-assembly.js";
import {
  classifyWith,
  requestOnFile,
  type InputClassification,
} from "../input/classify-input.js";
import { InputError } from "../input/input-error.js";
import type {
  AssemblySummary,
  ObfuscationCheck,
  PdbCheck,
} from "../inspect/assembly-summary.js";
import { inspectWith, readAssemblyWith } from "../inspect/inspect-assembly.js";
import { buildSolution, type SolutionBuild } from "./build-solution.js";
import { readDepsJson } from "./deps-json.js";
import { dotnetPacks, frameworkChecker } from "./framework-assemblies.js";
import {
  checkOutputDirectory,
  prepareOutputDirectory,
} from "./output-directory.js";
import {
  packageFinder,
  type IdentifyAssembly,
  type NuGetPackage,
} from "./nuget-packages.js";
import {
  defaultGlobalPackagesFolder,
  globalPackagesFolder,
  nugetOrg,
  type NuGetOrgOptions,
  type PackageSource,
} from "./package-sources.js";
import {
  classifyOutcome,
  type PartialReason,
  type ReconstructionOutcome,
} from "./reconstruction-outcome.js";
import { StageTracker, type ProgressListener } from "./progress.js";
import {
  type AssemblyResources,
  type ManifestResource,
  type RecoveredResource,
  type ResourceEntry,
  type SatelliteResources,
} from "./recovered-resources.js";
import {
  planSolution,
  RECOVERED_LANGUAGE_VERSION,
  type AssemblyToRecover,
  type DecompiledAssembly,
  type DeclaredType,
  type PlannedProject,
  type ProjectOutputType,
} from "./recovered-solution.js";
import type { WpfXaml, XamlDocument } from "./recovered-xaml.js";
import { findReferencePack, referencePackFor } from "./reference-packs.js";
import {
  OS_NAMES,
  planRun,
  runProgram,
  type ProgramRun,
  type RunOptions,
} from "./run-program.js";
import {
  findSiblingAssemblies,
  type Dependency,
  type FindAssemblies,
  type InspectedAssembly,
  type PackageResolution,
  type SiblingGraph,
  type SiblingProblem,
} from "./sibling-assemblies.js";
import {
  toXrayReport,
  XRAY_REPORT_FILE,
  type AcceptedReconstruction,
  type ReconstructionTimings,
} from "./xray-report.js";

export interface ReconstructOptions extends EngineOptions {
  /**
   * Replace the contents of an output directory that is not empty. Without
   * it, such a directory is refused.
   */
  readonly force?: boolean;
  /**
   * Reconstruct each Sibling Assembly the Assembly references, found beside
   * it, as a project of its own, wired with `ProjectReference` (FR-10.3,
   * FR-11). Defaults to `true`; without it (`--no-siblings`) each Assembly
   * beside it that no NuGet package holds is a copied binary instead
   * (FR-10.4).
   */
  readonly siblings?: boolean;
  /**
   * Make no network calls (`--offline`): references are looked up as NuGet
   * packages only in the global-packages cache, not on nuget.org (FR-10.2),
   * and `dotnet build` restores packages only from that cache. Defaults to
   * `false`.
   */
  readonly offline?: boolean;
  /**
   * The global-packages folder: the cache NuGet packages are looked up in,
   * and that `dotnet build` restores into. Defaults to NuGet's own, as
   * {@link defaultGlobalPackagesFolder} finds it.
   */
  readonly globalPackagesFolder?: string;
  /** How nuget.org is asked: by default, at its own service index, with the global `fetch`. */
  readonly nugetOrg?: Omit<NuGetOrgOptions, "signal">;
  /**
   * Verify the Recovered Solution with `dotnet build` (FR-13). Defaults to
   * `true`; without it (`--no-build`) the Reconstruction is unverified.
   */
  readonly build?: boolean;
  /**
   * Run the rebuilt program once it builds, where its target framework can
   * run on this OS (FR-14). Defaults to `false`: running it executes
   * recovered code, so it is run only when asked (`--run`).
   */
  readonly run?: boolean;
  /** How long a console program may run before it is stopped; see {@link RunOptions}. */
  readonly runTimeoutMs?: RunOptions["timeoutMs"];
  /** How long a Windows GUI program is given to launch; see {@link RunOptions}. */
  readonly launchMs?: RunOptions["launchMs"];
  /** The `dotnet` host that builds the Recovered Solution, and runs its program. Defaults to {@link EngineOptions.dotnetPath}. */
  readonly buildDotnetPath?: string;
  /**
   * Told of each stage as it starts, progresses, and finishes, fails or is
   * skipped (FR-19): at least once a second while a stage runs.
   */
  readonly onProgress?: ProgressListener;
  /**
   * Told of the Assembly's metadata summary (FR-5, FR-20) as soon as
   * `analyse` has read it, before that stage finishes: the same summary
   * `xray inspect` gives. Only a Managed Assembly has one, so input that is
   * not one is never told of.
   */
  readonly onInspected?: (summary: AssemblySummary) => void;
  /**
   * Stops the Reconstruction when aborted, as when `xray ui` stops: the
   * engine, `dotnet build` and the rebuilt program are stopped at once, the
   * running stage fails, and it rejects with the signal's reason. What it has
   * written so far is left as it is.
   */
  readonly signal?: AbortSignal;
}

/** The Recovered Solution, as written. */
export interface RecoveredSolution {
  /** The folder it was written to, as an absolute path. */
  readonly directory: string;
  /** The `.sln`, relative to {@link directory} with `/` between segments. */
  readonly solutionPath: string;
  /** The input Assembly's `.csproj`, relative as {@link solutionPath} is. */
  readonly projectPath: string;
  /** The input Assembly's project's. */
  readonly targetFramework: string;
  /** The input Assembly's project's. */
  readonly outputType: ProjectOutputType;
  /** The `xray-report.json`, relative as {@link solutionPath} is. */
  readonly reportPath: string;
  /** Every file written, the report last, relative as {@link solutionPath} is. */
  readonly files: readonly string[];
  /** How many of the input Assembly's top-level types were decompiled. */
  readonly typeCount: number;
  /** How many source files the input Assembly's types were decompiled to; see {@link RecoveredProject.sourceFileCount}. */
  readonly sourceFileCount: number;
  /** Every project: the input Assembly's, then each Sibling Assembly's. */
  readonly projects: readonly RecoveredProject[];
}

/** A project of the Recovered Solution, and the Assembly it recovers. */
export interface RecoveredProject {
  /** The Assembly, as an absolute path. */
  readonly assemblyPath: string;
  readonly assemblyName: string;
  /** The `.csproj`, relative as {@link RecoveredSolution.solutionPath} is. */
  readonly projectPath: string;
  readonly targetFramework: string;
  readonly outputType: ProjectOutputType;
  /** How many top-level types were decompiled. */
  readonly typeCount: number;
  /**
   * How many source files they were decompiled to: one for each type, laid
   * out by namespace; or, where its PDB was used, one for each of the
   * original's source files, at its original path; and one for each file
   * declaring file-scoped types.
   */
  readonly sourceFileCount: number;
  /**
   * The PDB beside its Assembly: used for local variable names and source
   * file layout if it is the Assembly's own (FR-4), else ignored.
   */
  readonly pdb: PdbCheck;
  /**
   * Whether its Assembly shows signs of obfuscation (FR-3): if it does, it
   * was reconstructed as it is, not deobfuscated.
   */
  readonly obfuscation: ObfuscationCheck;
  /** The projects of the Sibling Assemblies it references, by their {@link projectPath}. */
  readonly projectReferences: readonly string[];
  /** The NuGet packages it references, each holding an assembly its Assembly references. */
  readonly packageReferences: readonly NuGetPackage[];
  /** The binaries copied into the Recovered Solution that it references with a `HintPath`, by where they were copied to, relative as {@link projectPath} is. */
  readonly binaryReferences: readonly string[];
  /**
   * What became of each resource of its Assembly, then of each of its
   * satellite assemblies' (FR-12), paths relative as {@link projectPath} is.
   */
  readonly resources: readonly RecoveredResource[];
}

/** What `xray reconstruct` did: a Recovered Solution, or why there is none. */
export type Reconstruction =
  | {
      /** Not a Managed Assembly, so it cannot be reconstructed (ADR 0002). */
      readonly accepted: false;
      readonly classification: InputClassification;
    }
  | {
      readonly accepted: true;
      readonly classification: InputClassification;
      readonly summary: AssemblySummary;
      readonly solution: RecoveredSolution;
      /** How `dotnet build` verified it; `null` if building was skipped. */
      readonly build: SolutionBuild | null;
      /** What its program did when run, or why it was not; `null` if it was not asked to run. */
      readonly run: ProgramRun | null;
      readonly outcome: ReconstructionOutcome;
      /** Why it is Partial; empty unless it is. */
      readonly reasons: readonly PartialReason[];
      /**
       * Whether the Sibling Assemblies it references were looked for, and
       * reconstructed: `false` when `siblings` was (`--no-siblings`).
       */
      readonly siblings: boolean;
      /** What Xray worked around in the Sibling Assemblies: duplicate names and cycles. */
      readonly siblingProblems: readonly SiblingProblem[];
      /** Whether nuget.org was left alone (`--offline`). */
      readonly offline: boolean;
      /**
       * Each reference looked up as a NuGet package (FR-10.2), in the order
       * it was: the package chosen, or why there is none.
       */
      readonly packages: readonly PackageResolution[];
      /**
       * Every reference of every Assembly of the solution, once by name, and
       * how Dependency Resolution satisfied it, or did not (FR-10, FR-16).
       */
      readonly dependencies: readonly Dependency[];
      /**
       * What its user should know of, though it does not make the
       * Reconstruction Partial: each PDB beside an Assembly that was ignored,
       * and each Assembly that shows signs of obfuscation.
       */
      readonly warnings: readonly ReconstructionWarning[];
      /** How long each stage took. */
      readonly timings: ReconstructionTimings;
    };

/**
 * Something that went less well than it might have, though it does not make
 * the Reconstruction Partial.
 */
export type ReconstructionWarning =
  | {
      /**
       * `pdb-ignored`: the PDB beside an Assembly was not its own, or could
       * not be read, so it was not used, and that Assembly's locals are
       * named, and its files laid out, as without one.
       */
      readonly kind: "pdb-ignored";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      /** The PDB, as an absolute path. */
      readonly pdbPath: string;
      readonly message: string;
    }
  | {
      /**
       * `obfuscated`: an Assembly shows signs of obfuscation (FR-3), so its
       * project has the names and strings the obfuscator left, for Xray does
       * not undo it.
       */
      readonly kind: "obfuscated";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    }
  | {
      /**
       * `best-effort-target-framework`: an Assembly targets a framework FR-8
       * supports only as far as it can, such as .NET Framework 2.0 or 3.5, or
       * `netstandard`, so its project targets it as it is, but how far it
       * builds and behaves like the original is less certain.
       */
      readonly kind: "best-effort-target-framework";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    }
  | {
      /**
       * `resource-kept-as-is`: a `.resources` file of an Assembly, or of a
       * satellite assembly beside it, holds something a `.resx` cannot hold
       * again, so it is embedded as it is, byte for byte, rather than written
       * as a `.resx`.
       */
      readonly kind: "resource-kept-as-is";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    }
  | {
      /**
       * `resource-not-recovered`: a resource of an Assembly is linked, in
       * another file or assembly, rather than embedded, so the rebuilt
       * Assembly does not have it.
       */
      readonly kind: "resource-not-recovered";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    }
  | {
      /**
       * `reference-assemblies-not-found`: an Assembly uses a framework this
       * OS has not (Windows Forms or WPF, off Windows), and the targeting pack of
       * its reference assemblies was found neither in the global-packages
       * cache nor, unless offline, on nuget.org, so it was decompiled
       * without them, less precisely.
       */
      readonly kind: "reference-assemblies-not-found";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    }
  | {
      /**
       * `xaml-not-recovered`: an Assembly's WPF resources hold BAML that was
       * not decompiled to XAML, or could not be split back into XAML files,
       * so they are embedded as they are.
       */
      readonly kind: "xaml-not-recovered";
      /** The Assembly, as an absolute path. */
      readonly assemblyPath: string;
      readonly message: string;
    };

// Decompiling a large Assembly takes far longer than any other engine command.
const DECOMPILE_TIMEOUT_MS = 10 * 60_000;

/**
 * Reconstructs the Assembly at `path` into a Recovered Solution in
 * `outputDirectory` (FR-7, FR-9, FR-13): the engine decompiles every type to
 * C#, one file per type in a folder per namespace; an SDK-style project keeps
 * the original's target framework and output type, beside a `.sln`. `path`
 * may be a folder, when the Assembly reconstructed is the application's in
 * it, as {@link chooseInputAssembly} tells it. Each reference that is not
 * the framework's (FR-10.1), as the reference assemblies of the target
 * framework of the Assembly making it say, is looked up as a NuGet package, in the global-packages
 * cache, then, unless `offline`, on nuget.org, and one found is referenced
 * with a `PackageReference` (FR-10.2). Unless `siblings` is `false`,
 * each Sibling Assembly it references, found beside it, is reconstructed into
 * a project of its own in the same solution, as {@link findSiblingAssemblies}
 * finds them, and referenced with a `ProjectReference` (FR-10.3, FR-11). Any
 * other Assembly beside it that a reference names is copied into
 * `Dependencies/` and referenced with a `HintPath` (FR-10.4); a reference
 * nothing satisfies is an Unresolved Dependency, which makes the
 * Reconstruction Partial (FR-10.5). Then,
 * unless `build` is `false`, `dotnet build` verifies it and the outcome is
 * classified as Full or Partial (FR-15). With `run`, the program it built is
 * then run where its target framework can run on this OS, and what it did is
 * recorded (FR-14). Whatever the outcome, an
 * `xray-report.json` describing it is written beside the solution (FR-16).
 * Input that is not a Managed Assembly is not accepted, as
 * {@link classifyInput} explains, and nothing is written. Each stage reports
 * its progress to `onProgress` as it goes, the stage that fails included.
 *
 * Rejects with a {@link ReconstructionError} if the output directory is not
 * empty (without `force`) or an Assembly's target framework cannot be told;
 * with an {@link InputError} if there is no readable Assembly at `path`, or
 * the folder there does not say which to reconstruct; with
 * an {@link EngineError} if the engine fails; and with its `signal`'s reason
 * if that is aborted.
 */
export async function reconstruct(
  path: string,
  outputDirectory: string,
  options: ReconstructOptions = {},
): Promise<Reconstruction> {
  const stages = new StageTracker(options.onProgress);
  const { signal } = options;
  try {
    signal?.throwIfAborted();
    return await reconstructInStages(
      resolve(path),
      resolve(outputDirectory),
      options,
      stages,
    );
  } catch (error) {
    // Whatever failed as it was stopped, failed because it was stopped.
    const cause = signal?.aborted === true ? (signal.reason as unknown) : error;
    stages.fail(cause);
    throw cause;
  }
}

async function reconstructInStages(
  path: string,
  output: string,
  options: ReconstructOptions,
  stages: StageTracker,
): Promise<Reconstruction> {
  const { signal } = options;
  stages.start("analyse");
  const input = await inputAssemblyAt(path);
  const engine = await startEngine(options);
  // Stopping the Reconstruction kills the engine, failing what it is doing.
  const killEngine = () => void engine.stop({ kill: true });
  signal?.addEventListener("abort", killEngine, { once: true });
  let classification: InputClassification;
  let summary: AssemblySummary;
  let decompiled: DecompiledAssembly;
  let resources: AssemblyResources;
  let siblings: SiblingGraph;
  const siblingsDecompiled: DecompiledAssembly[] = [];
  const siblingsResources: AssemblyResources[] = [];
  let analyse: number;
  let decompile: number;
  const offline = options.offline === true;
  const packagesFolder =
    options.globalPackagesFolder ?? defaultGlobalPackagesFolder();
  const nuget = offline
    ? undefined
    : nugetOrg({
        ...options.nugetOrg,
        ...(signal === undefined ? {} : { signal }),
      });
  const sources: PackageSource[] = [
    globalPackagesFolder(packagesFolder),
    ...(nuget === undefined ? [] : [nuget]),
  ];
  const referencePacks = referencePacksFrom(sources, offline);
  try {
    signal?.throwIfAborted();
    classification = await classifyWith(engine, input);
    if (!classification.accepted) {
      stages.finish();
      return { accepted: false, classification };
    }
    await checkOutputDirectory(output, input, options.force ?? false);
    summary = await inspectWith(engine, input);
    options.onInspected?.(summary);
    analyse = stages.finish();
    stages.start("decompile");
    // Counted in types, which can be more than the units they are decompiled
    // to: file-scoped types share a unit with the types that use them.
    let total: number | undefined;
    decompiled = await decompileWith(
      engine,
      input,
      summary,
      (progress) => {
        total = progress.total;
        stages.progress(progress);
      },
      await referencePacks.directoriesFor(summary),
    );
    total ??= decompiled.types.length;
    resources = await resourcesWith(engine, input, summary.assembly.name);
    stages.progress({ done: total, total, current: null });
    signal?.throwIfAborted();
    decompile = stages.finish();

    stages.start("resolve-dependencies");
    siblings = await findSiblingAssemblies(
      { path: input, summary },
      assembliesBeside(engine, dirname(input)),
      (name) => stages.progress({ done: null, total: null, current: name }),
      {
        siblings: options.siblings !== false,
        // The SDK that builds the Recovered Solution builds against the
        // targeting packs it has, before any in the cache or on nuget.org.
        checkFramework: frameworkChecker({
          sources: [
            dotnetPacks(
              options.buildDotnetPath ?? options.dotnetPath ?? "dotnet",
            ),
            ...sources,
          ],
          identify: identifyWith(engine),
          offline,
        }),
        findPackage: packageFinder({
          sources,
          identify: identifyWith(engine),
          offline,
          deps: await readDepsJson(input),
          ...(signal === undefined ? {} : { signal }),
        }),
      },
    );
    const found = siblings.assemblies.slice(1);
    for (const [done, sibling] of found.entries()) {
      signal?.throwIfAborted();
      const current = basename(sibling.path);
      stages.progress({ done, total: found.length, current });
      // Counted in Sibling Assemblies, not in each one's types.
      siblingsDecompiled.push(
        await decompileWith(
          engine,
          sibling.path,
          sibling.summary,
          () => undefined,
          await referencePacks.directoriesFor(sibling.summary),
        ),
      );
      siblingsResources.push(
        await resourcesWith(
          engine,
          sibling.path,
          sibling.summary.assembly.name,
        ),
      );
    }
    stages.progress({
      done: found.length,
      total: found.length,
      current: null,
    });
  } finally {
    signal?.removeEventListener("abort", killEngine);
    await Promise.all([engine.stop(), nuget?.dispose()]);
  }
  signal?.throwIfAborted();
  const resolveDependencies = stages.finish();

  stages.start("generate");
  const assemblies = siblings.assemblies.map(
    ({ summary }, i): AssemblyToRecover => ({
      summary,
      decompiled:
        i === 0
          ? decompiled
          : (siblingsDecompiled[i - 1] as DecompiledAssembly),
      references: siblings.references[i] ?? [],
      packages: siblings.packageReferences[i] ?? [],
      binaries: siblings.binaryReferences[i] ?? [],
      resources:
        i === 0 ? resources : (siblingsResources[i - 1] as AssemblyResources),
    }),
  );
  const plan = planSolution(
    assemblies as [AssemblyToRecover, ...AssemblyToRecover[]],
    siblings.binaries.map(({ path, summary }) => ({
      assemblyName: summary.assembly.name,
      sourcePath: path,
    })),
  );
  await prepareOutputDirectory(output);
  const writes = [
    ...plan.files.map((file) => ({ path: file.path, contents: file.contents })),
    ...plan.binaries.map(({ path, sourcePath }) => ({ path, sourcePath })),
  ];
  for (const [done, file] of writes.entries()) {
    signal?.throwIfAborted();
    stages.progress({ done, total: writes.length, current: file.path });
    const target = join(output, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await ("contents" in file
      ? writeFile(target, file.contents)
      : copyFile(file.sourcePath, target));
  }
  const generate = stages.finish();
  const dependencies = siblings.dependencies.map(
    ({ assembly, binary, ...dependency }): Dependency => ({
      reference: dependency.reference,
      referencedBy: dependency.referencedBy,
      resolution: dependency.resolution,
      package: dependency.package,
      projectPath:
        assembly === null
          ? null
          : (plan.projects[assembly]?.projectPath as string),
      copiedTo:
        binary === null ? null : (plan.binaries[binary]?.path as string),
      path:
        assembly !== null
          ? (siblings.assemblies[assembly]?.path as string)
          : binary !== null
            ? (siblings.binaries[binary]?.path as string)
            : null,
      reason: dependency.reason,
    }),
  );

  const dotnetPath = options.buildDotnetPath ?? options.dotnetPath;
  let build: SolutionBuild | null = null;
  let buildTime: number | null = null;
  if (options.build === false) {
    stages.skip(
      "build",
      "Building was skipped, so the Recovered Solution is not verified.",
    );
  } else {
    stages.start("build");
    build = await buildSolution(join(output, plan.solutionPath), {
      ...(dotnetPath === undefined ? {} : { dotnetPath }),
      ...(signal === undefined ? {} : { signal }),
      ...(options.globalPackagesFolder === undefined
        ? {}
        : { globalPackagesFolder: options.globalPackagesFolder }),
      ...(offline ? { offlineSource: packagesFolder } : {}),
    });
    buildTime = stages.finish();
  }

  let run: ProgramRun | null = null;
  let runTime: number | null = null;
  if (options.run !== true) {
    stages.skip(
      "run",
      "Running the rebuilt program executes recovered code, so it is run only when asked.",
    );
  } else {
    const runPlan = planRun(
      {
        projectPath: plan.projectPath,
        assemblyName: plan.project.assemblyName,
        targetFramework: plan.project.targetFramework,
        outputKind: summary.outputKind,
      },
      build,
    );
    if (runPlan.runnable) {
      stages.start("run");
      stages.progress({ done: null, total: null, current: runPlan.program });
      run = await runProgram(output, runPlan, {
        ...(dotnetPath === undefined ? {} : { dotnetPath }),
        ...(options.runTimeoutMs === undefined
          ? {}
          : { timeoutMs: options.runTimeoutMs }),
        ...(options.launchMs === undefined
          ? {}
          : { launchMs: options.launchMs }),
        ...(signal === undefined ? {} : { signal }),
      });
      // A program stopped with the Reconstruction did not fail to start.
      signal?.throwIfAborted();
      runTime = stages.finish();
    } else {
      stages.skip("run", runPlan.reason);
      run = {
        status: "skipped",
        reason: runPlan.reason,
        program: null,
        exitCode: null,
        stdout: null,
        stderr: null,
      };
    }
  }

  const reconstruction: AcceptedReconstruction = {
    accepted: true,
    classification,
    summary,
    solution: {
      directory: output,
      solutionPath: plan.solutionPath,
      projectPath: plan.projectPath,
      targetFramework: plan.project.targetFramework,
      outputType: plan.project.outputType,
      reportPath: XRAY_REPORT_FILE,
      files: [...writes.map((file) => file.path), XRAY_REPORT_FILE],
      typeCount: plan.projects[0]?.typeCount as number,
      sourceFileCount: plan.projects[0]?.sourceFileCount as number,
      projects: plan.projects.map((project, i) => ({
        assemblyPath: project.assemblyPath,
        assemblyName: project.project.assemblyName,
        projectPath: project.projectPath,
        targetFramework: project.project.targetFramework,
        outputType: project.project.outputType,
        typeCount: project.typeCount,
        sourceFileCount: project.sourceFileCount,
        pdb: (siblings.assemblies[i]?.summary as AssemblySummary).pdb,
        obfuscation: (siblings.assemblies[i]?.summary as AssemblySummary)
          .obfuscation,
        projectReferences: (siblings.references[i] ?? []).map(
          (reference) => plan.projects[reference]?.projectPath as string,
        ),
        packageReferences: siblings.packageReferences[i] ?? [],
        binaryReferences: (siblings.binaryReferences[i] ?? []).map(
          (binary) => plan.binaries[binary]?.path as string,
        ),
        resources: project.resources,
      })),
    },
    build,
    run,
    ...classifyOutcome(build, run, dependencies),
    siblings: options.siblings !== false,
    siblingProblems: siblings.problems,
    offline,
    packages: siblings.packages,
    dependencies,
    warnings: siblings.assemblies.flatMap(({ summary }, i) => [
      ...pdbWarnings(summary),
      ...obfuscationWarnings(summary),
      ...targetFrameworkWarnings(summary),
      ...referencePacks.warningsFor(summary),
      ...xamlWarnings(summary, plan.projects[i]),
      ...resourceWarnings(
        summary,
        plan.projects[i]?.resources ?? [],
        i === 0 ? resources : (siblingsResources[i - 1] as AssemblyResources),
      ),
    ]),
    timings: {
      analyse,
      decompile,
      resolveDependencies,
      generate,
      build: buildTime,
      run: runTime,
      total: stages.elapsed(),
    },
  };
  await writeFile(
    join(output, XRAY_REPORT_FILE),
    `${JSON.stringify(toXrayReport(reconstruction), null, 2)}\n`,
  );
  return reconstruction;
}

/**
 * Finds the Managed Assemblies a reference names in `folder`, with an engine
 * already running: each `<name>.dll` and `<name>.exe` there (ignoring case)
 * that is a Managed Assembly of that name. A file that is not one, or whose
 * metadata cannot be read, is not what the reference names.
 */
function assembliesBeside(
  engine: EngineClient,
  folder: string,
): FindAssemblies {
  // Read once, as the folder is looked in for every reference.
  const files = readdir(folder, { withFileTypes: true }).then(
    (entries) =>
      entries
        .filter((entry) => entry.isFile() && /\.(dll|exe)$/i.test(entry.name))
        .map((entry) => entry.name),
    () => [],
  );
  return async (name) => {
    const found: InspectedAssembly[] = [];
    for (const file of await files) {
      if (file.slice(0, -".dll".length).toLowerCase() !== name.toLowerCase()) {
        continue;
      }
      const path = join(folder, file);
      try {
        if (!(await classifyWith(engine, path)).accepted) {
          continue;
        }
        const { summary, informationalVersion } = await readAssemblyWith(
          engine,
          path,
        );
        if (summary.assembly.name.toLowerCase() === name.toLowerCase()) {
          found.push({ path, summary, informationalVersion });
        }
      } catch (error) {
        if (!(error instanceof InputError)) {
          throw error;
        }
      }
    }
    return found;
  };
}

/**
 * Reads the identity of an assembly in a NuGet package with an engine
 * already running; `null` if it is not a Managed Assembly, or its metadata
 * cannot be read.
 */
function identifyWith(engine: EngineClient): IdentifyAssembly {
  return async (path) => {
    try {
      if (!(await classifyWith(engine, path)).accepted) {
        return null;
      }
      return (await inspectWith(engine, path)).assembly;
    } catch (error) {
      if (error instanceof InputError) {
        return null;
      }
      throw error;
    }
  };
}

/** Why the PDB beside an Assembly was ignored, if it was. */
function pdbWarnings(summary: AssemblySummary): ReconstructionWarning[] {
  const { pdb } = summary;
  if (pdb.status !== "mismatched" && pdb.status !== "unreadable") {
    return [];
  }
  return [
    {
      kind: "pdb-ignored",
      assemblyPath: summary.path,
      pdbPath: pdb.path,
      message: `Ignored the PDB beside ${basename(summary.path)}, ${pdb.path}. ${pdb.reason} So ${summary.assembly.name}'s local variables are named, and its source files laid out, as without a PDB.`,
    },
  ];
}

/** That an Assembly shows signs of obfuscation, if it does, and was reconstructed as it is. */
function obfuscationWarnings(
  summary: AssemblySummary,
): ReconstructionWarning[] {
  const { obfuscation } = summary;
  if (obfuscation.status !== "obfuscated") {
    return [];
  }
  return [
    {
      kind: "obfuscated",
      assemblyPath: summary.path,
      message: `${basename(summary.path)} is likely obfuscated. ${obfuscation.indicators.map(({ message }) => message).join(" ")} It was reconstructed as it is, not deobfuscated: ${summary.assembly.name}'s names and strings are the obfuscator's.`,
    },
  ];
}

/**
 * That an Assembly targets a framework Xray supports only as far as it can
 * (FR-8), if it does, and how that framework was told, if its Assembly does
 * not say.
 */
function targetFrameworkWarnings(
  summary: AssemblySummary,
): ReconstructionWarning[] {
  const { moniker, support, inferredFrom } = summary.targetFramework;
  if (support !== "best-effort") {
    return [];
  }
  return [
    {
      kind: "best-effort-target-framework",
      assemblyPath: summary.path,
      message: `${basename(summary.path)} targets ${moniker as string}, which Xray supports only on a best-effort basis, not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later: ${summary.assembly.name}'s project targets it as it is, but it is less certain to build and behave like the original.${
        inferredFrom === null
          ? ""
          : ` It records no TargetFrameworkAttribute, as nothing built before .NET Framework 4.0 does, so ${moniker as string} was told from ${inferredFrom}.`
      }`,
    },
  ];
}

/** The reference assemblies each Assembly is decompiled with, found once for a Reconstruction. */
interface ReferencePacks {
  /**
   * The folders holding the reference assemblies of the framework an
   * Assembly uses that this OS has not, as {@link referencePackFor} tells
   * it; none if it needs none, or they were not found.
   */
  directoriesFor(summary: AssemblySummary): Promise<string[]>;
  /** That an Assembly was decompiled without the reference assemblies it needs, if it was. */
  warningsFor(summary: AssemblySummary): ReconstructionWarning[];
}

/**
 * Finds the targeting packs Assemblies need in `sources`, each only once,
 * however many Assemblies need it, noting each Assembly that needs one not
 * found.
 */
function referencePacksFrom(
  sources: readonly PackageSource[],
  offline: boolean,
): ReferencePacks {
  const found = new Map<
    string,
    Promise<{ folder: string } | { folder: null; why: string }>
  >();
  const warnings = new Map<string, ReconstructionWarning>();
  return {
    async directoriesFor(summary) {
      const pack = referencePackFor(summary);
      if (pack === null) {
        return [];
      }
      const key = `${pack.id}/${pack.folder}`;
      let finding = found.get(key);
      if (finding === undefined) {
        const wanted =
          pack.versionPrefix === null
            ? pack.id
            : `${pack.id} ${pack.versionPrefix}x`;
        finding = findReferencePack(pack, sources).then(
          (pack) =>
            pack === null
              ? {
                  folder: null,
                  why: `${wanted} is not in the global-packages folder${offline ? ", and nuget.org was not asked, as Xray is offline" : ", nor on nuget.org"}`,
                }
              : { folder: pack.folder },
          (error: unknown) => ({
            folder: null,
            why: `${wanted} is not in the global-packages folder, and ${error instanceof Error ? error.message : String(error)}`,
          }),
        );
        found.set(key, finding);
      }
      const result = await finding;
      if (result.folder !== null) {
        return [result.folder];
      }
      warnings.set(summary.path, {
        kind: "reference-assemblies-not-found",
        assemblyPath: summary.path,
        message: `${basename(summary.path)} was decompiled without the reference assemblies of ${pack.holds}, which ${OS_NAMES[process.platform] ?? process.platform} does not have: ${result.why}. Code using them may be decompiled less precisely, so its project may not build or behave like the original: a call to a method of their base classes may call the override itself.`,
      });
      return [];
    },
    warningsFor(summary) {
      const warning = warnings.get(summary.path);
      return warning === undefined ? [] : [warning];
    },
  };
}

/** That an Assembly's WPF resources were not split back into XAML files, if they were not. */
function xamlWarnings(
  summary: AssemblySummary,
  project: PlannedProject | undefined,
): ReconstructionWarning[] {
  const why = project?.xamlNotRecovered;
  return why === undefined
    ? []
    : [
        {
          kind: "xaml-not-recovered",
          assemblyPath: summary.path,
          message: `The WPF resources of ${basename(summary.path)} were not recovered as XAML: ${why}`,
        },
      ];
}

/**
 * That a resource of an Assembly, or of one of its satellite assemblies, was
 * embedded as it is rather than written as a `.resx`, or was not recovered,
 * for each that was.
 */
function resourceWarnings(
  summary: AssemblySummary,
  recovered: readonly RecoveredResource[],
  resources: AssemblyResources,
): ReconstructionWarning[] {
  const satellites = new Map(
    resources.satellites.map(({ culture, path }) => [culture, path]),
  );
  return recovered.flatMap(
    ({ name, culture, recoveredAs, path, reason }): ReconstructionWarning[] => {
      const of = `${name}, a resource of ${
        culture === null
          ? basename(summary.path)
          : relative(dirname(summary.path), satellites.get(culture) ?? "")
              .split(sep)
              .join("/")
      }`;
      if (recoveredAs === "not-recovered") {
        return [
          {
            kind: "resource-not-recovered",
            assemblyPath: summary.path,
            message: `${of}, was not recovered. ${reason ?? ""}`.trimEnd(),
          },
        ];
      }
      if (recoveredAs === "file" && reason !== null) {
        return [
          {
            kind: "resource-kept-as-is",
            assemblyPath: summary.path,
            message: `${of}, is embedded as it is, as ${path as string}, rather than written as a .resx. ${reason} A .resx the .NET SDK builds holds only strings, and byte[]s and streams in files it refers to, without System.Resources.Extensions; the rebuilt Assembly holds this resource byte for byte all the same.`,
          },
        ];
      }
      return [];
    },
  );
}

// Satellite assemblies are named after their Assembly, in a folder of their culture's.
const SATELLITE_SUFFIX = ".resources";

/**
 * The resources of the Managed Assembly at `path` (absolute), named `name`,
 * read by an engine already running, and those of each of its satellite
 * assemblies: `<culture>/<name>.resources.dll` beside it, ignoring case, a
 * Managed Assembly that says it is `<name>.resources` of that culture, as
 * the runtime loads them. A file that is not one is no satellite assembly.
 */
async function resourcesWith(
  engine: EngineClient,
  path: string,
  name: string,
): Promise<AssemblyResources> {
  const own = asAssemblyResources(
    await requestOnFile(engine, "resources", path),
  );
  const folder = dirname(path);
  const cultures = (
    await readdir(folder, { withFileTypes: true }).catch(() => [])
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const satellites: SatelliteResources[] = [];
  const file = `${name}${SATELLITE_SUFFIX}.dll`.toLowerCase();
  for (const culture of cultures) {
    const found = (await readdir(join(folder, culture)).catch(() => [])).find(
      (entry) => entry.toLowerCase() === file,
    );
    if (found === undefined) {
      continue;
    }
    const satellitePath = join(folder, culture, found);
    try {
      if (!(await classifyWith(engine, satellitePath)).accepted) {
        continue;
      }
      const read = asAssemblyResources(
        await requestOnFile(engine, "resources", satellitePath),
      );
      if (
        read.assembly.name.toLowerCase() !==
          `${name}${SATELLITE_SUFFIX}`.toLowerCase() ||
        read.assembly.culture?.toLowerCase() !== culture.toLowerCase()
      ) {
        continue;
      }
      satellites.push({
        culture: read.assembly.culture,
        path: satellitePath,
        resources: read.resources,
      });
    } catch (error) {
      if (!(error instanceof InputError)) {
        throw error;
      }
    }
  }
  return { resources: own.resources, satellites };
}

/** Narrows the engine's answer to `resources`, decoding its base64; throws a protocol violation if it is malformed. */
function asAssemblyResources(value: Record<string, unknown>): {
  readonly assembly: { readonly name: string; readonly culture: string | null };
  readonly resources: readonly ManifestResource[];
} {
  const malformed = () =>
    new EngineError(
      "protocol-violation",
      `The Xray engine's answer to "resources" was malformed: ${JSON.stringify(value).slice(0, 1_000)}`,
    );
  const { assembly, resources } = value;
  if (
    typeof assembly !== "object" ||
    assembly === null ||
    typeof (assembly as Record<string, unknown>)["name"] !== "string" ||
    !Array.isArray(resources)
  ) {
    throw malformed();
  }
  const culture = (assembly as Record<string, unknown>)["culture"];
  const read: ManifestResource[] = [];
  for (const resource of resources as unknown[]) {
    if (typeof resource !== "object" || resource === null) {
      throw malformed();
    }
    const {
      name,
      public: isPublic,
      location,
      linkedTo,
      data,
      entries,
      notDecoded,
    } = resource as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      name === "" ||
      typeof isPublic !== "boolean" ||
      (location !== "embedded" &&
        location !== "file" &&
        location !== "assembly") ||
      (linkedTo !== null && typeof linkedTo !== "string") ||
      (data !== null && typeof data !== "string") ||
      (notDecoded !== null && typeof notDecoded !== "string") ||
      (entries !== null && !Array.isArray(entries))
    ) {
      throw malformed();
    }
    let decoded: ResourceEntry[] | null = null;
    if (Array.isArray(entries)) {
      decoded = [];
      for (const entry of entries as unknown[]) {
        const {
          name: entryName,
          kind,
          value: entryValue,
        } = (entry ?? {}) as Record<string, unknown>;
        if (
          typeof entryName !== "string" ||
          (kind !== "string" && kind !== "bytes" && kind !== "stream") ||
          typeof entryValue !== "string"
        ) {
          throw malformed();
        }
        decoded.push({
          name: entryName,
          kind,
          value:
            kind === "string"
              ? entryValue
              : new Uint8Array(Buffer.from(entryValue, "base64")),
        });
      }
    }
    read.push({
      name,
      public: isPublic,
      location,
      linkedTo,
      data: data === null ? null : new Uint8Array(Buffer.from(data, "base64")),
      entries: decoded,
      notDecoded,
    });
  }
  return {
    assembly: {
      name: (assembly as Record<string, unknown>)["name"] as string,
      culture: typeof culture === "string" ? culture : null,
    },
    resources: read,
  };
}

/**
 * The C# of the Managed Assembly at `path` (absolute), decompiled by an
 * engine already running, with the PDB beside it if `summary` says that is
 * its own (FR-4), finding the assemblies it references in
 * `referenceDirectories` too.
 */
async function decompileWith(
  engine: EngineClient,
  path: string,
  summary: AssemblySummary,
  onProgress: (progress: EngineProgress) => void,
  referenceDirectories: readonly string[],
): Promise<DecompiledAssembly> {
  const result = await requestOnFile(
    engine,
    "decompile",
    path,
    {
      languageVersion: RECOVERED_LANGUAGE_VERSION,
      ...(summary.pdb.status === "matching"
        ? { pdbPath: summary.pdb.path }
        : {}),
      ...(referenceDirectories.length === 0 ? {} : { referenceDirectories }),
    },
    { timeoutMs: DECOMPILE_TIMEOUT_MS, onProgress },
  );
  const decompiled = asDecompiledAssembly(result);
  if (decompiled === undefined) {
    throw new EngineError(
      "protocol-violation",
      `The Xray engine's answer to "decompile" was malformed: ${JSON.stringify(result).slice(0, 1_000)}`,
    );
  }
  return decompiled;
}

/** Narrows the engine's answer to `decompile`, keeping only the fields Xray reads. */
function asDecompiledAssembly(
  value: Record<string, unknown>,
): DecompiledAssembly | undefined {
  const {
    assemblyAttributes,
    unsafeCode,
    nullableAnnotations,
    types,
    xaml = null,
  } = value;
  if (
    typeof assemblyAttributes !== "string" ||
    typeof unsafeCode !== "boolean" ||
    typeof nullableAnnotations !== "boolean" ||
    !Array.isArray(types)
  ) {
    return undefined;
  }
  const wpf = xaml === null ? null : asWpfXaml(xaml);
  if (wpf === undefined) {
    return undefined;
  }
  const decompiled = [];
  for (const type of types as unknown[]) {
    if (typeof type !== "object" || type === null) {
      return undefined;
    }
    const {
      namespace,
      name,
      code,
      sourceFile = null,
      sourcePath = null,
      declares = [{ namespace, name }],
    } = type as Record<string, unknown>;
    if (
      typeof namespace !== "string" ||
      typeof name !== "string" ||
      name === "" ||
      typeof code !== "string" ||
      (sourceFile !== null &&
        (typeof sourceFile !== "string" || sourceFile === "")) ||
      (sourcePath !== null &&
        (typeof sourcePath !== "string" || sourcePath === "")) ||
      !Array.isArray(declares) ||
      declares.length === 0 ||
      !declares.every(isDeclaredType)
    ) {
      return undefined;
    }
    decompiled.push({
      namespace,
      name,
      code,
      sourceFile,
      sourcePath,
      declares: declares.map(({ namespace, name }) => ({ namespace, name })),
    });
  }
  return {
    assemblyAttributes,
    unsafeCode,
    nullableAnnotations,
    types: decompiled,
    xaml: wpf,
  };
}

/** Narrows the XAML of the engine's answer to `decompile`. */
function asWpfXaml(value: unknown): WpfXaml | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { resource, documents, notDecompiled } = value as Record<
    string,
    unknown
  >;
  if (
    typeof resource !== "string" ||
    resource === "" ||
    !Array.isArray(documents) ||
    (notDecompiled !== null && typeof notDecompiled !== "string")
  ) {
    return undefined;
  }
  const decompiled: XamlDocument[] = [];
  for (const document of documents as unknown[]) {
    if (typeof document !== "object" || document === null) {
      return undefined;
    }
    const {
      entry,
      class: type,
      applicationDefinition,
      code,
    } = document as Record<string, unknown>;
    if (
      typeof entry !== "string" ||
      !entry.toLowerCase().endsWith(".baml") ||
      (type !== null && (typeof type !== "string" || type === "")) ||
      typeof applicationDefinition !== "boolean" ||
      typeof code !== "string"
    ) {
      return undefined;
    }
    decompiled.push({ entry, class: type, applicationDefinition, code });
  }
  return { resource, documents: decompiled, notDecompiled };
}

function isDeclaredType(value: unknown): value is DeclaredType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { namespace, name } = value as Record<string, unknown>;
  return (
    typeof namespace === "string" && typeof name === "string" && name !== ""
  );
}
