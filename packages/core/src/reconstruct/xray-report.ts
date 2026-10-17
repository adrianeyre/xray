// The `xray-report.json` every Reconstruction writes into its Recovered
// Solution (FR-16), for scripts and CI to parse and the CLI to summarize
// (FR-17). Its schema is docs/reference/xray-report-json.md.

import type {
  AssemblySummary,
  ObfuscationCheck,
  PdbCheck,
} from "../inspect/assembly-summary.js";
import type { BuildDiagnostic } from "./build-diagnostics.js";
import type { Reconstruction, ReconstructionWarning } from "./reconstruct.js";
import type {
  PartialReason,
  ReconstructionOutcome,
} from "./reconstruction-outcome.js";
import type { RecoveredResource } from "./recovered-resources.js";
import type { ProjectOutputType } from "./recovered-solution.js";
import type { ProgramRun } from "./run-program.js";
import type { NuGetPackage } from "./nuget-packages.js";
import type {
  Dependency,
  PackageResolution,
  SiblingProblem,
} from "./sibling-assemblies.js";

/** The report's name, in the Recovered Solution's folder. */
export const XRAY_REPORT_FILE = "xray-report.json";

/**
 * The version of the `xray-report.json` document
 * (docs/reference/xray-report-json.md). Bump it when a field is removed,
 * renamed or changes meaning; adding a field or a new value of an enumeration
 * keeps it.
 */
export const XRAY_REPORT_SCHEMA_VERSION = 1;

/** How long each stage of a Reconstruction took, in whole milliseconds. */
export interface ReconstructionTimings {
  /** Starting the engine, classifying the input, checking the output directory and inspecting the Assembly. */
  readonly analyse: number;
  /** Decompiling every type of the Assembly to C#. */
  readonly decompile: number;
  /**
   * Dependency Resolution: looking references up as NuGet packages, finding
   * the Sibling Assemblies, decompiling each, and stopping the engine; `null`
   * if it was skipped, which it no longer is.
   */
  readonly resolveDependencies: number | null;
  /** Laying out the Recovered Solution and writing it. */
  readonly generate: number;
  /** `dotnet build`; `null` if building was skipped. */
  readonly build: number | null;
  /** Running the rebuilt program; `null` if it was not run. */
  readonly run: number | null;
  /** The whole Reconstruction, up to writing the report. */
  readonly total: number;
}

/** A Reconstruction that produced a Recovered Solution. */
export type AcceptedReconstruction = Extract<
  Reconstruction,
  { readonly accepted: true }
>;

/** The `xray-report.json` document. */
export interface XrayReport {
  readonly schemaVersion: typeof XRAY_REPORT_SCHEMA_VERSION;
  readonly outcome: ReconstructionOutcome;
  /** Why it is Partial; empty unless it is. */
  readonly reasons: readonly PartialReason[];
  readonly inputs: {
    /** The Assembly, as an absolute path. */
    readonly path: string;
    readonly options: {
      /** Whether the Recovered Solution was to be built (`false` with `--no-build`). */
      readonly build: boolean;
      /** Whether the rebuilt program was to be run (`true` with `--run`). */
      readonly run: boolean;
      /** Whether Sibling Assemblies were to be reconstructed (`false` with `--no-siblings`). */
      readonly siblings: boolean;
      /** Whether nuget.org was left alone (`true` with `--offline`). */
      readonly offline: boolean;
    };
  };
  /** The Assembly's metadata summary, as `xray inspect --json` gives it, without its `schemaVersion`. */
  readonly inspect: AssemblySummary;
  /**
   * Whether the Assembly is flagged as obfuscated (FR-3), its
   * `inspect.obfuscation` saying why; it is reconstructed all the same, as
   * it is.
   */
  readonly obfuscated: boolean;
  /**
   * Every reference of every Assembly of the solution, once by name, and how
   * Dependency Resolution satisfied it, or did not (FR-10): framework, NuGet
   * package, Sibling Assembly, copied binary, or unresolved.
   */
  readonly dependencies: readonly Dependency[];
  /** What Xray worked around in the Sibling Assemblies: duplicate names and cycles. */
  readonly siblingProblems: readonly SiblingProblem[];
  /** Each reference looked up as a NuGet package (FR-10.2): the package chosen, or why there is none. */
  readonly packages: readonly PackageResolution[];
  /**
   * What went less well than it might have, without making it Partial: each
   * PDB that was ignored, each Assembly that shows signs of obfuscation, and
   * each resource kept as it is or not recovered.
   */
  readonly warnings: readonly ReconstructionWarning[];
  readonly solution: {
    /** Relative to the Recovered Solution's folder, with `/` between segments. */
    readonly solutionPath: string;
    /** The input Assembly's project, as are the three fields after it. */
    readonly projectPath: string;
    readonly targetFramework: string;
    readonly outputType: ProjectOutputType;
    readonly typeCount: number;
    readonly sourceFileCount: number;
    /** Every project: the input Assembly's, then each Sibling Assembly's. */
    readonly projects: readonly {
      /** The Assembly it recovers, as an absolute path. */
      readonly assemblyPath: string;
      readonly assemblyName: string;
      readonly projectPath: string;
      readonly targetFramework: string;
      readonly outputType: ProjectOutputType;
      readonly typeCount: number;
      /** How many source files its types were decompiled to: one each, or one for each of the original's, laid out by its PDB. */
      readonly sourceFileCount: number;
      /** The PDB beside its Assembly, and whether it was used: only if it is the Assembly's own (FR-4). */
      readonly pdb: PdbCheck;
      /** Whether its Assembly shows signs of obfuscation (FR-3): if so, it was reconstructed as it is. */
      readonly obfuscation: ObfuscationCheck;
      /** The projects it references, by their `projectPath`. */
      readonly projectReferences: readonly string[];
      /** The NuGet packages it references. */
      readonly packageReferences: readonly NuGetPackage[];
      /** The binaries copied into the Recovered Solution it references with a `HintPath`, by where they were copied to. */
      readonly binaryReferences: readonly string[];
      /** What became of each resource of its Assembly, and of its satellite assemblies (FR-12). */
      readonly resources: readonly RecoveredResource[];
    }[];
    /** Every file Xray wrote, this report included. */
    readonly files: readonly string[];
  };
  /** How `dotnet build` verified it; `null` if building was skipped. */
  readonly build: {
    readonly succeeded: boolean;
    readonly diagnostics: readonly BuildDiagnostic[];
    /** Everything `dotnet build` printed, stdout then stderr. */
    readonly output: string;
  } | null;
  /** What the rebuilt program did when run, or why it was not; `null` if it was not asked to run. */
  readonly run: ProgramRun | null;
  readonly timings: ReconstructionTimings;
}

/** The `xray-report.json` document for a Reconstruction. */
export function toXrayReport(
  reconstruction: AcceptedReconstruction,
): XrayReport {
  const {
    summary,
    solution,
    build,
    run,
    outcome,
    reasons,
    siblings,
    siblingProblems,
    offline,
    packages,
    dependencies,
    warnings,
    timings,
  } = reconstruction;
  return {
    schemaVersion: XRAY_REPORT_SCHEMA_VERSION,
    outcome,
    reasons,
    inputs: {
      path: summary.path,
      options: { build: build !== null, run: run !== null, siblings, offline },
    },
    inspect: summary,
    obfuscated: summary.obfuscation.status === "obfuscated",
    dependencies: dependencies.map((dependency) => ({
      reference: dependency.reference,
      referencedBy: dependency.referencedBy,
      resolution: dependency.resolution,
      package: dependency.package,
      projectPath: dependency.projectPath,
      copiedTo: dependency.copiedTo,
      path: dependency.path,
      reason: dependency.reason,
    })),
    siblingProblems,
    packages: packages.map((lookup) => ({
      reference: lookup.reference,
      referencedBy: lookup.referencedBy,
      package: lookup.package,
      candidates: lookup.candidates,
      searched: lookup.searched,
      reason: lookup.reason,
    })),
    warnings: warnings.map((warning) =>
      warning.kind === "pdb-ignored"
        ? {
            kind: warning.kind,
            assemblyPath: warning.assemblyPath,
            pdbPath: warning.pdbPath,
            message: warning.message,
          }
        : {
            kind: warning.kind,
            assemblyPath: warning.assemblyPath,
            message: warning.message,
          },
    ),
    solution: {
      solutionPath: solution.solutionPath,
      projectPath: solution.projectPath,
      targetFramework: solution.targetFramework,
      outputType: solution.outputType,
      typeCount: solution.typeCount,
      sourceFileCount: solution.sourceFileCount,
      projects: solution.projects.map((project) => ({
        assemblyPath: project.assemblyPath,
        assemblyName: project.assemblyName,
        projectPath: project.projectPath,
        targetFramework: project.targetFramework,
        outputType: project.outputType,
        typeCount: project.typeCount,
        sourceFileCount: project.sourceFileCount,
        pdb: project.pdb,
        obfuscation: project.obfuscation,
        projectReferences: project.projectReferences,
        packageReferences: project.packageReferences,
        binaryReferences: project.binaryReferences,
        resources: project.resources.map((resource) => ({
          name: resource.name,
          culture: resource.culture,
          public: resource.public,
          recoveredAs: resource.recoveredAs,
          path: resource.path,
          reason: resource.reason,
        })),
      })),
      files: solution.files,
    },
    build:
      build === null
        ? null
        : {
            succeeded: build.succeeded,
            diagnostics: build.diagnostics,
            output: build.output,
          },
    run:
      run === null
        ? null
        : {
            status: run.status,
            reason: run.reason,
            program: run.program,
            exitCode: run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
          },
    timings,
  };
}
