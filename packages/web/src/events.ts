// What the web app reads from @xray/server's stream of a Reconstruction's
// events (docs/reference/xray-ui.md#the-api), declared here as the browser
// sees it: plain JSON, and only the fields it shows. @xray/server's tests
// hold what it sends to these types.

/** The stages of a Reconstruction, in the order they run. */
export const STAGES = [
  "analyse",
  "decompile",
  "resolve-dependencies",
  "generate",
  "build",
  "run",
] as const;

export type Stage = (typeof STAGES)[number];

/** One of @xray/core's progress events (docs/reference/progress-events.md). */
export type ProgressEvent =
  | {
      readonly kind: "stage-started";
      readonly stage: Stage;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "stage-progress";
      readonly stage: Stage;
      readonly elapsedMs: number;
      readonly done: number | null;
      readonly total: number | null;
      readonly current: string | null;
    }
  | {
      readonly kind: "stage-finished";
      readonly stage: Stage;
      readonly elapsedMs: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: "stage-skipped";
      readonly stage: Stage;
      readonly elapsedMs: number;
      readonly reason: string;
    }
  | {
      readonly kind: "stage-failed";
      readonly stage: Stage;
      readonly elapsedMs: number;
      readonly durationMs: number;
      readonly message: string;
    };

/** A build error or warning, at its file and line in the Recovered Solution. */
export interface BuildDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

/** How long each stage of a Reconstruction took, in whole milliseconds; `null` for a stage that did not run. */
export interface ReportTimings {
  readonly analyse: number;
  readonly decompile: number;
  readonly resolveDependencies: number | null;
  readonly generate: number;
  readonly build: number | null;
  readonly run: number | null;
  readonly total: number;
}

/**
 * A reference of the Recovered Solution's Assemblies, and how Dependency
 * Resolution satisfied it, or did not, as `xray-report.json` gives it.
 */
export interface ReportDependency {
  readonly reference: AssemblyIdentity;
  /** The names of the Assemblies making it. */
  readonly referencedBy: readonly string[];
  /**
   * `framework`, `nuget-package`, `sibling-assembly`, `copied-binary` or
   * `unresolved`. An enumeration that may gain values, so a string here.
   */
  readonly resolution: string;
  /** For a NuGet package, which. */
  readonly package: { readonly id: string; readonly version: string } | null;
  /** For a Sibling Assembly, the project that recovers it, relative to the Recovered Solution's folder. */
  readonly projectPath: string | null;
  /** For a copied binary, where in the Recovered Solution it was copied to. */
  readonly copiedTo: string | null;
  /** Why, for people. */
  readonly reason: string;
}

/** A resource of the original, and what became of it, as `xray-report.json` gives it. */
export interface ReportResource {
  readonly name: string;
  /** The culture of the satellite assembly it is in; `null` for the Assembly's own. */
  readonly culture: string | null;
  /**
   * `resx`, `file`, `not-recovered` or `xaml`. An enumeration that may gain values,
   * so a string here.
   */
  readonly recoveredAs: string;
}

/** What the web app shows of `xray-report.json` (docs/reference/xray-report-json.md). */
export interface ReportSummary {
  readonly outcome: "full" | "partial" | "unverified";
  readonly reasons: readonly (
    | {
        readonly kind: "unresolved-dependencies";
        readonly dependencies: readonly ReportDependency[];
      }
    | {
        readonly kind: "build-failed";
        readonly errors: readonly BuildDiagnostic[];
      }
    | { readonly kind: "run-failed" }
  )[];
  readonly solution: {
    readonly solutionPath: string;
    readonly projectPath: string;
    readonly targetFramework: string;
    readonly outputType: string;
    readonly typeCount: number;
    /** How many source files the input Assembly's types were decompiled to. */
    readonly sourceFileCount: number;
    /** Every project: the input Assembly's, then each Sibling Assembly's. */
    readonly projects: readonly {
      readonly assemblyName: string;
      readonly projectPath: string;
      readonly typeCount: number;
      /** The PDB beside its Assembly, and whether it was used, as `InspectJson["pdb"]` gives it. */
      readonly pdb: PdbCheck;
      /** Whether its Assembly shows signs of obfuscation, as `InspectJson["obfuscation"]` gives it. */
      readonly obfuscation: ObfuscationCheck;
      /** The projects it references, by their `projectPath`. */
      readonly projectReferences: readonly string[];
      /** What became of each resource of its Assembly, and of its satellite assemblies'. */
      readonly resources: readonly ReportResource[];
    }[];
    /** Every file Xray wrote, relative to the Recovered Solution's folder. */
    readonly files: readonly string[];
  };
  readonly inputs: {
    readonly options: {
      /** Whether Sibling Assemblies were to be reconstructed. */
      readonly siblings: boolean;
    };
  };
  /** Every reference of every Assembly of the solution, once by name, and how each was resolved. */
  readonly dependencies: readonly ReportDependency[];
  /** What went less well than it might have, each for people, such as a PDB ignored or an Assembly likely obfuscated. Its kinds may gain values, so they are strings here. */
  readonly warnings: readonly {
    readonly kind: string;
    readonly message: string;
  }[];
  /** What Xray worked around in the Sibling Assemblies, each for people. Its kinds may gain values, so they are strings here. */
  readonly siblingProblems: readonly {
    readonly kind: string;
    readonly message: string;
  }[];
  readonly build: {
    readonly succeeded: boolean;
    /** Every error and warning it printed, in the order printed. */
    readonly diagnostics: readonly BuildDiagnostic[];
  } | null;
  readonly timings: ReportTimings;
}

/** An assembly's identity, as `xray inspect --json` gives it. */
export interface AssemblyIdentity {
  readonly name: string;
  readonly version: string;
  /** `null` for the neutral culture. */
  readonly culture: string | null;
  /** `null` when it is not strong-named. */
  readonly publicKeyToken: string | null;
}

/**
 * The Assembly's metadata summary: the `xray inspect --json` document
 * (docs/reference/xray-inspect-json.md), whole. Its enumerations may gain
 * values, so they are strings here.
 */
export interface InspectJson {
  readonly schemaVersion: number;
  readonly path: string;
  readonly assembly: AssemblyIdentity;
  readonly targetFramework: {
    readonly moniker: string | null;
    readonly frameworkName: string | null;
    readonly runtimeVersion: string;
    readonly inferredFrom: string | null;
    readonly support: string;
  };
  readonly architecture: {
    readonly platformTarget: string | null;
    readonly prefer32Bit: boolean;
    readonly bitness: string;
    readonly machine: string;
  };
  readonly entryPoint: {
    readonly type: string;
    readonly method: string;
  } | null;
  readonly outputKind: string;
  readonly references: readonly AssemblyIdentity[];
  readonly counts: {
    readonly types: number;
    readonly methods: number;
    readonly resources: number;
  };
  readonly pdb: PdbCheck;
  readonly obfuscation: ObfuscationCheck;
}

/**
 * Whether an Assembly shows signs of obfuscation: `status` `clean`, or
 * `obfuscated`, with each sign found, which says what in its `message`. Its
 * enumerations may gain values, so they are strings here.
 */
export interface ObfuscationCheck {
  readonly status: string;
  /** Empty when it is `clean`. */
  readonly indicators: readonly {
    /** `obfuscator-attribute`, `mangled-identifiers` or `encrypted-strings`. */
    readonly kind: string;
    /** What was found, as it is: an attribute's full name, names, or types holding string decoders. */
    readonly evidence: readonly string[];
    readonly message: string;
  }[];
}

/**
 * The PDB beside an Assembly, if any, and whether it is its own: `status`
 * `none` (and no more), `matching`, `mismatched` or `unreadable`, which say
 * why in `reason`.
 */
export interface PdbCheck {
  readonly status: string;
  /** Absent for `none`. */
  readonly path?: string;
  /** `portable` or `windows`; `null` for a file that is a PDB of neither; absent for `none`. */
  readonly format?: string | null;
  /** Why it is not used: for `mismatched` and `unreadable`. */
  readonly reason?: string;
}

/** How a Reconstruction ended: the last event of its stream. */
export type ReconstructionEnd =
  | {
      readonly kind: "reconstructed";
      readonly directory: string;
      readonly report: ReportSummary;
    }
  | {
      readonly kind: "rejected";
      readonly inputKind: string;
      readonly explanation: string;
    }
  | {
      readonly kind: "failed";
      readonly code: string | null;
      readonly message: string;
    };

/** One event of the stream, by the name it is sent with. */
export type ReconstructionEvent =
  | { readonly type: "started"; readonly data: { readonly path: string } }
  | { readonly type: "progress"; readonly data: ProgressEvent }
  | { readonly type: "inspected"; readonly data: InspectJson }
  | { readonly type: "ended"; readonly data: ReconstructionEnd };

/** The names of the events in the stream. */
export const EVENT_TYPES: readonly ReconstructionEvent["type"][] = [
  "started",
  "progress",
  "inspected",
  "ended",
];

/** What the server answers `POST /api/reconstructions` with. */
export interface StartedReconstruction {
  readonly id: string;
  readonly path: string;
  readonly events: string;
}

/** What the server answers a request it refuses with. */
export interface ApiError {
  readonly message: string;
}

/** What the server answers `POST /api/uploads` with. */
export interface StartedUpload {
  readonly id: string;
  /** Where each file is sent, by its place in the list: `<files>/<n>`. */
  readonly files: string;
  /** The files that may be Assemblies. */
  readonly assemblies: readonly string[];
  /** The one to reconstruct; `null` if the user must choose from {@link assemblies}. */
  readonly assembly: string | null;
}

/** One file of a Recovered Solution, as the server lists it. */
export interface RecoveredFile {
  /** Its path in the Recovered Solution, with `/` between names. */
  readonly path: string;
  /** How many bytes it is. */
  readonly size: number;
}

/** What the server answers `GET /api/reconstructions/<id>/files` with. */
export interface RecoveredFiles {
  readonly files: readonly RecoveredFile[];
}
