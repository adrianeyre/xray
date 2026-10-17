// What the web app shows of `xray-report.json`
// (docs/reference/xray-report-json.md) in its report panel (FR-22): the
// outcome, how Dependency Resolution satisfied each reference, how long each
// stage took, and the build's diagnostics, each linked to its file and line
// in the Recovered Solution. Nothing here needs a page, so @xray/server's
// tests hold it to what a Reconstruction writes.

import type {
  BuildDiagnostic,
  ReportDependency,
  ReportSummary,
} from "./events.js";

/** How each outcome reads: its title, and what it means. */
export const OUTCOMES: Readonly<
  Record<
    ReportSummary["outcome"],
    { readonly title: string; readonly says: string }
  >
> = {
  full: {
    title: "Full Reconstruction",
    says: "The Recovered Solution builds.",
  },
  partial: {
    title: "Partial Reconstruction",
    says: "The Recovered Solution was written, but falls short of a Full Reconstruction, for the reasons below.",
  },
  unverified: {
    title: "Unverified",
    says: "The Recovered Solution was written, but not built, so it is neither a Full nor a Partial Reconstruction.",
  },
};

/** Where in the Recovered Solution a diagnostic is about: the file, and, where it says, the line and column. */
export interface DiagnosticTarget {
  /** The file, relative to the Recovered Solution's folder, with `/` between names. */
  readonly path: string;
  /** 1-based; `null` when the diagnostic gives none, so the file opens at its top. */
  readonly line: number | null;
  /** 1-based; `null` when the diagnostic gives none. */
  readonly column: number | null;
}

/** A diagnostic, and where it leads, if anywhere. */
export interface ReportDiagnostic {
  readonly diagnostic: BuildDiagnostic;
  /**
   * The file of the Recovered Solution it is about, to open in the viewer;
   * `null` when it names no file, or one outside the Recovered Solution, such
   * as an SDK targets file.
   */
  readonly target: DiagnosticTarget | null;
}

/**
 * Every error and warning `dotnet build` printed: the errors, then the
 * warnings, each in the order printed, with the file of the Recovered
 * Solution each is about, if it is about one. None if it was not built.
 */
export function reportDiagnostics(report: ReportSummary): ReportDiagnostic[] {
  const files = new Set(report.solution.files);
  const diagnostics = report.build?.diagnostics ?? [];
  return [
    ...diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    ...diagnostics.filter((diagnostic) => diagnostic.severity !== "error"),
  ].map((diagnostic) => ({
    diagnostic,
    target:
      diagnostic.file === undefined || !files.has(diagnostic.file)
        ? null
        : {
            path: diagnostic.file,
            line: diagnostic.line ?? null,
            column: diagnostic.column ?? null,
          },
  }));
}

/** `file:line:column: severity code: message`, leaving out what it does not say, as the CLI does. */
export function formatDiagnostic(diagnostic: BuildDiagnostic): string {
  const location =
    diagnostic.file === undefined
      ? ""
      : `${[diagnostic.file, diagnostic.line, diagnostic.column]
          .filter((part) => part !== undefined)
          .join(":")}: `;
  const code = diagnostic.code === "" ? "" : ` ${diagnostic.code}`;
  return `${location}${diagnostic.severity}${code}: ${diagnostic.message}`;
}

/** `850 ms`, or `4.2 s`, as the CLI gives durations. */
export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/** `succeeded`, or `failed with 4 errors and 1 warning`, as the CLI says how it built. */
export function buildResult(build: ReportSummary["build"]): string {
  if (build === null) {
    return "not built, so the Recovered Solution was not verified";
  }
  const errors = count(build.diagnostics, "error");
  const warnings = count(build.diagnostics, "warning");
  const counted = [
    ...(errors === 0 ? [] : [plural(errors, "error")]),
    ...(warnings === 0 ? [] : [plural(warnings, "warning")]),
  ].join(" and ");
  const result = build.succeeded ? "succeeded" : "failed";
  return counted === "" ? result : `${result} with ${counted}`;
}

/**
 * How long each stage took, as a label and the time shown for it, in the
 * order they run, then the whole Reconstruction's.
 */
export function reportTimings(
  timings: ReportSummary["timings"],
): [string, string][] {
  return [
    ["Analyse", formatDuration(timings.analyse)],
    ["Decompile", formatDuration(timings.decompile)],
    [
      "Resolve dependencies",
      timings.resolveDependencies === null
        ? "skipped"
        : formatDuration(timings.resolveDependencies),
    ],
    ["Generate solution", formatDuration(timings.generate)],
    [
      "Build",
      timings.build === null ? "not built" : formatDuration(timings.build),
    ],
    [
      "Run the rebuilt program",
      timings.run === null ? "not run" : formatDuration(timings.run),
    ],
    ["Total", formatDuration(timings.total)],
  ];
}

/** How each way Dependency Resolution satisfies a reference reads, in the order it tries them. */
export const RESOLUTIONS: Readonly<Record<string, string>> = {
  framework: "Framework",
  "nuget-package": "NuGet package",
  "sibling-assembly": "Sibling Assembly",
  "copied-binary": "Copied binary",
  unresolved: "Unresolved",
};

/** How each way reads when counted, one then several; a way not here is counted as the report gives it. */
const COUNTED: Readonly<Record<string, readonly [string, string]>> = {
  framework: ["framework", "framework"],
  "nuget-package": ["NuGet package", "NuGet packages"],
  "sibling-assembly": ["Sibling Assembly", "Sibling Assemblies"],
  "copied-binary": ["copied binary", "copied binaries"],
  unresolved: ["unresolved", "unresolved"],
};

/** One row of the Dependency Resolution table: a reference, and how it was satisfied. */
export interface DependencyRow {
  /** The assembly's name. */
  readonly name: string;
  /** `1.0.0.0`, then its public key token, if it is strong-named. */
  readonly identity: string;
  /** As the report gives it: `framework`, `copied-binary`… */
  readonly resolution: string;
  /** How that reads: `Framework`, `Copied binary`… */
  readonly resolvedAs: string;
  /**
   * What satisfies it in the Recovered Solution: the package, the project,
   * or the file it was copied to; `null` for the framework, or nothing.
   */
  readonly satisfiedBy: string | null;
  /** The Assemblies making it, by name. */
  readonly referencedBy: string;
  /** Why, as the report says it. */
  readonly reason: string;
}

/**
 * The Dependency Resolution table: every reference of every Assembly of the
 * solution, once, in the order the report lists them, with how it was
 * satisfied, by what, and why. A resolution the web app does not know is
 * shown as the report gives it.
 */
export function dependencyRows(report: ReportSummary): DependencyRow[] {
  return report.dependencies.map((dependency) => ({
    name: dependency.reference.name,
    identity: identityOf(dependency),
    resolution: dependency.resolution,
    resolvedAs: RESOLUTIONS[dependency.resolution] ?? dependency.resolution,
    satisfiedBy: satisfiedBy(dependency),
    referencedBy: dependency.referencedBy.join(", "),
    reason: dependency.reason,
  }));
}

/**
 * How many references there are, and how many were resolved each way, in the
 * order Dependency Resolution tries them: `3 references: 2 framework, 1
 * unresolved`.
 */
export function dependencyResult(report: ReportSummary): string {
  const { dependencies } = report;
  if (dependencies.length === 0) {
    return "none";
  }
  const counts = new Map<string, number>();
  for (const { resolution } of dependencies) {
    counts.set(resolution, (counts.get(resolution) ?? 0) + 1);
  }
  const known = Object.keys(RESOLUTIONS);
  const order = [
    ...known,
    ...[...counts.keys()].filter((resolution) => !known.includes(resolution)),
  ];
  const each = order.flatMap((resolution) => {
    const n = counts.get(resolution);
    if (n === undefined) {
      return [];
    }
    const [one, several] = COUNTED[resolution] ?? [resolution, resolution];
    return [`${n} ${n === 1 ? one : several}`];
  });
  return `${plural(dependencies.length, "reference")}: ${each.join(", ")}`;
}

function identityOf({ reference }: ReportDependency): string {
  return reference.publicKeyToken === null
    ? reference.version
    : `${reference.version}, ${reference.publicKeyToken}`;
}

function satisfiedBy(dependency: ReportDependency): string | null {
  if (dependency.package !== null) {
    return `${dependency.package.id} ${dependency.package.version}`;
  }
  return dependency.projectPath ?? dependency.copiedTo;
}

/**
 * What became of the Sibling Assemblies, as the CLI says it: none found, not
 * looked for, or how many, each a project of its own.
 */
/**
 * How many of the input Assembly's top-level types were decompiled, and to
 * how many files, as the CLI says: one each, or, laid out by its PDB, one for
 * each of its source files.
 */
export function typesResult(solution: ReportSummary["solution"]): string {
  const { typeCount, sourceFileCount } = solution;
  return typeCount === sourceFileCount
    ? `${typeCount}, each decompiled to a file of its own`
    : `${typeCount}, decompiled to ${plural(sourceFileCount, "file")}`;
}

/** Whether the input Assembly was decompiled with the PDB beside it, as the CLI says. */
export function pdbResult(report: ReportSummary): string {
  const pdb = report.solution.projects[0]?.pdb;
  if (pdb === undefined || pdb.status === "none" || pdb.path === undefined) {
    return "none beside the Assembly";
  }
  return pdb.status === "matching"
    ? `${pdb.path}, used for local names and source layout`
    : `${pdb.path}, ignored, as it is not the Assembly's own`;
}

/** What each sign of obfuscation is, in a word or two, as the CLI says it. */
const OBFUSCATION_SIGNS: Readonly<Record<string, string>> = {
  "obfuscator-attribute": "an obfuscator's attribute",
  "mangled-identifiers": "mangled names",
  "encrypted-strings": "hidden strings",
};

/**
 * Whether the input Assembly shows signs of obfuscation, and which, as it was
 * reconstructed as it is, as the CLI says.
 */
export function obfuscationResult(report: ReportSummary): string {
  const obfuscation = report.solution.projects[0]?.obfuscation;
  if (obfuscation === undefined || obfuscation.status === "clean") {
    return "clean: no sign of it found";
  }
  if (obfuscation.status !== "obfuscated") {
    // A status added since, shown as it is.
    return obfuscation.status;
  }
  const signs = obfuscation.indicators.map(({ kind }) =>
    Object.hasOwn(OBFUSCATION_SIGNS, kind)
      ? (OBFUSCATION_SIGNS[kind] as string)
      : kind,
  );
  return `likely obfuscated (${signs.join(", ")}): reconstructed as it is, not deobfuscated`;
}

/**
 * How many resources the input Assembly and its satellite assemblies have,
 * and what became of them, as the CLI says.
 */
export function resourcesResult(report: ReportSummary): string {
  const resources = report.solution.projects[0]?.resources ?? [];
  if (resources.length === 0) {
    return "none";
  }
  const as = (kind: string) =>
    resources.filter(({ recoveredAs }) => recoveredAs === kind).length;
  const files = as("file");
  const each = [
    ...(as("xaml") === 0 ? [] : [`${as("xaml")} recovered as XAML`]),
    ...(as("resx") === 0 ? [] : [`${as("resx")} written as .resx`]),
    ...(files === 0
      ? []
      : [`${files} embedded as ${files === 1 ? "it is" : "they are"}`]),
    ...(as("not-recovered") === 0
      ? []
      : [`${as("not-recovered")} not recovered`]),
  ];
  const cultures = [
    ...new Set(resources.flatMap(({ culture }) => culture ?? [])),
  ];
  return `${resources.length}, each under its own name: ${each.join(", ")}${
    cultures.length === 0
      ? ""
      : `; ${cultures.length} satellite ${cultures.length === 1 ? "assembly" : "assemblies"} (${cultures.join(", ")})`
  }`;
}

export function siblingResult(report: ReportSummary): string {
  if (!report.inputs.options.siblings) {
    return "not reconstructed (turned off)";
  }
  const siblings = report.solution.projects.length - 1;
  return siblings === 0
    ? "none found beside it"
    : `${siblings}, each a project of its own`;
}

function count(
  diagnostics: readonly BuildDiagnostic[],
  severity: BuildDiagnostic["severity"],
): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity)
    .length;
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
