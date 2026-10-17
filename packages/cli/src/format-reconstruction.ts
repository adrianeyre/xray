import type {
  BuildDiagnostic,
  DependencyResolution,
  ObfuscationCheck,
  ObfuscationIndicator,
  PartialReason,
  ProgramRun,
  ReconstructionOutcome,
  RunStatus,
  ReconstructionTimings,
  XrayReport,
} from "@xray/core";

const OUTCOMES: Readonly<Record<ReconstructionOutcome, string>> = {
  full: "Full Reconstruction",
  partial: "Partial Reconstruction",
  unverified: "Unverified: not built, so neither Full nor Partial",
};

/** How many of a Partial Reconstruction's build errors are listed; the report has the rest. */
export const LISTED_ERRORS = 10;

/** How each way Dependency Resolution satisfies a reference reads, counted, one then several, in the order it tries them. */
const RESOLUTIONS: Readonly<
  Record<DependencyResolution, readonly [string, string]>
> = {
  framework: ["framework", "framework"],
  "nuget-package": ["NuGet package", "NuGet packages"],
  "sibling-assembly": ["Sibling Assembly", "Sibling Assemblies"],
  "copied-binary": ["copied binary", "copied binaries"],
  unresolved: ["unresolved", "unresolved"],
};

/**
 * A concise summary of the `xray-report.json` written into the Recovered
 * Solution at `directory` (FR-17): one line per fact, its label padded so the
 * values line up, ending with how it built, how its program ran (if it was
 * asked to), how long each stage took, the outcome and where the report is;
 * then why a NuGet package was chosen where several hold the same assembly;
 * then what was worked around in the Sibling Assemblies, if anything; then,
 * for a Partial Reconstruction, why: each Unresolved Dependency, and why
 * nothing satisfies it, then its first {@link LISTED_ERRORS} build errors at
 * their files and lines.
 */
export function formatReconstruction(
  directory: string,
  report: XrayReport,
  reportPath: string,
): string {
  const { solution } = report;
  const rows: [string, string][] = [
    ["Recovered Solution", directory],
    ["Solution", solution.solutionPath],
    ["Project", solution.projectPath],
    ["Target framework", solution.targetFramework],
    ["Output type", solution.outputType],
    ["Types", typeCount(solution)],
    ["Resources", resources(report)],
    ["PDB", pdbs(report)],
    ["Obfuscation", obfuscation(report)],
    ["Dependencies", dependencyCounts(report)],
    ["NuGet packages", nugetPackages(report)],
    ["Sibling Assemblies", siblingProjects(report)],
    ["Copied binaries", copiedBinaries(report)],
    ["Build", buildResult(report.build)],
    ...(report.run === null
      ? []
      : ([["Run", runResult(report.run)]] as [string, string][])),
    ["Time", formatTimings(report.timings)],
    ["Outcome", OUTCOMES[report.outcome]],
    ["Report", reportPath],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  // A value of several lines lines up under its first.
  const summary = rows
    .map(
      ([label, value]) =>
        `${label.padEnd(width)}  ${value.replaceAll("\n", `\n${" ".repeat(width + 2)}`)}`,
    )
    .join("\n");
  const ambiguous = report.packages.filter(
    ({ candidates }) => candidates.length > 1,
  );
  return `${[
    summary,
    ...(ambiguous.length === 0
      ? []
      : [
          [
            "Chosen among several NuGet packages:",
            ...ambiguous.map(({ reason }) => `  ${reason}`),
          ].join("\n"),
        ]),
    ...(report.siblingProblems.length === 0
      ? []
      : [
          [
            "Worked around in the Sibling Assemblies:",
            ...report.siblingProblems.map(({ message }) => `  ${message}`),
          ].join("\n"),
        ]),
    ...report.reasons.map((reason) =>
      formatReason(reason, report.run, reportPath),
    ),
  ].join("\n\n")}\n`;
}

/** `file:line:column: severity code: message`, leaving out what it does not say. */
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

/** The total, then each stage that ran: `3.2 s: analyse 210 ms, decompile 480 ms, …`. */
export function formatTimings(timings: ReconstructionTimings): string {
  const stages: [string, number | null][] = [
    ["analyse", timings.analyse],
    ["decompile", timings.decompile],
    ["resolve dependencies", timings.resolveDependencies],
    ["generate", timings.generate],
    ["build", timings.build],
    ["run", timings.run],
  ];
  const ran = stages
    .filter((stage): stage is [string, number] => stage[1] !== null)
    .map(([stage, ms]) => `${stage} ${formatDuration(ms)}`);
  return `${formatDuration(timings.total)}: ${ran.join(", ")}`;
}

/** Milliseconds under a second, else seconds to a tenth. */
export function formatDuration(ms: number): string {
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/**
 * How many of the input Assembly's top-level types were decompiled, and to
 * how many files: one each, or, laid out by its PDB, one for each of its
 * source files.
 */
function typeCount(solution: XrayReport["solution"]): string {
  const { typeCount, sourceFileCount } = solution;
  return typeCount === sourceFileCount
    ? `${typeCount}, each decompiled to a file of its own`
    : `${typeCount}, decompiled to ${plural(sourceFileCount, "file")}`;
}

/**
 * How many resources each project's Assembly and its satellite assemblies
 * have, and what became of them: for the one project, else one project to a
 * line.
 */
function resources(report: XrayReport): string {
  const { projects } = report.solution;
  const recovered = (
    resources: XrayReport["solution"]["projects"][number]["resources"],
  ): string => {
    if (resources.length === 0) {
      return "none";
    }
    const as = (kind: string) =>
      resources.filter(({ recoveredAs }) => recoveredAs === kind).length;
    const cultures = [
      ...new Set(resources.flatMap(({ culture }) => culture ?? [])),
    ];
    const each = [
      ...(as("xaml") === 0 ? [] : [`${as("xaml")} recovered as XAML`]),
      ...(as("resx") === 0 ? [] : [`${as("resx")} written as .resx`]),
      ...(as("file") === 0
        ? []
        : [
            `${as("file")} embedded as ${as("file") === 1 ? "it is" : "they are"}`,
          ]),
      ...(as("not-recovered") === 0
        ? []
        : [`${as("not-recovered")} not recovered`]),
    ];
    return `${resources.length}, each under its own name: ${each.join(", ")}${
      cultures.length === 0
        ? ""
        : `; ${plural(cultures.length, "satellite assembly", "satellite assemblies")} (${cultures.join(", ")})`
    }`;
  };
  if (projects.every((project) => project.resources.length === 0)) {
    return "none";
  }
  if (projects.length === 1) {
    return recovered(projects[0]?.resources ?? []);
  }
  return projects
    .map(
      ({ projectPath, resources }) => `${projectPath}: ${recovered(resources)}`,
    )
    .join("\n");
}

/** Whether each project's Assembly was decompiled with its PDB: how, for the one project, else one project to a line. */
function pdbs(report: XrayReport): string {
  const { projects } = report.solution;
  const used = (pdb: XrayReport["inspect"]["pdb"]): string => {
    switch (pdb.status) {
      case "none":
        return "none beside the Assembly";
      case "matching":
        return `${pdb.path}, used for local names and source layout`;
      default:
        return `${pdb.path}, ignored, as it is not the Assembly's own`;
    }
  };
  if (projects.length === 1) {
    return used(projects[0]?.pdb ?? report.inspect.pdb);
  }
  return projects
    .map(({ projectPath, pdb }) => `${projectPath}: ${used(pdb)}`)
    .join("\n");
}

/** What each sign of obfuscation is, in a word or two. */
const OBFUSCATION_SIGNS: Readonly<
  Record<ObfuscationIndicator["kind"], string>
> = {
  "obfuscator-attribute": "an obfuscator's attribute",
  "mangled-identifiers": "mangled names",
  "encrypted-strings": "hidden strings",
};

/**
 * Whether each project's Assembly shows signs of obfuscation, and which, as it
 * was reconstructed as it is: for the one project, else one project to a line.
 */
function obfuscation(report: XrayReport): string {
  const { projects } = report.solution;
  const found = ({ status, indicators }: ObfuscationCheck): string =>
    status === "clean"
      ? "clean: no sign of it found"
      : `likely obfuscated (${indicators.map(({ kind }) => OBFUSCATION_SIGNS[kind]).join(", ")}): reconstructed as it is, not deobfuscated`;
  if (projects.length === 1) {
    return found(projects[0]?.obfuscation ?? report.inspect.obfuscation);
  }
  return projects
    .map(
      ({ projectPath, obfuscation }) => `${projectPath}: ${found(obfuscation)}`,
    )
    .join("\n");
}

/**
 * Each NuGet package referenced, one to a line, with where it was found; or
 * that none holds a reference, or that no reference needed one.
 */
function nugetPackages(report: XrayReport): string {
  const offline = report.inputs.options.offline
    ? " (--offline: only the global-packages cache was looked in)"
    : "";
  const chosen = new Map<string, string>();
  for (const { package: found } of report.packages) {
    if (found !== null) {
      chosen.set(
        `${found.id} ${found.version}`,
        found.source === "global-packages"
          ? "from the global-packages cache"
          : "from nuget.org",
      );
    }
  }
  if (chosen.size === 0) {
    return report.packages.length === 0
      ? `none needed${offline}`
      : `none found${offline}`;
  }
  return [
    `${chosen.size}, each a PackageReference${offline}:`,
    ...[...chosen].map(([pkg, source]) => `${pkg}, ${source}`),
  ].join("\n");
}

/**
 * How many references there are, and how many were resolved each way, in the
 * order Dependency Resolution tries them: `3 references: 2 framework, 1
 * unresolved`.
 */
function dependencyCounts(report: XrayReport): string {
  const { dependencies } = report;
  if (dependencies.length === 0) {
    return "none";
  }
  const each = Object.entries(RESOLUTIONS).flatMap(
    ([resolution, [one, several]]) => {
      const n = dependencies.filter(
        (dependency) => dependency.resolution === resolution,
      ).length;
      return n === 0 ? [] : [`${n} ${n === 1 ? one : several}`];
    },
  );
  return `${plural(dependencies.length, "reference")}: ${each.join(", ")}`;
}

/**
 * Each binary copied into the Recovered Solution, one to a line, with where
 * it was found; or that none was.
 */
function copiedBinaries(report: XrayReport): string {
  const copied = report.dependencies.filter(
    ({ resolution }) => resolution === "copied-binary",
  );
  if (copied.length === 0) {
    return "none";
  }
  return [
    `${copied.length}, each referenced with a HintPath:`,
    ...copied.map(
      ({ copiedTo, path }) => `${copiedTo ?? ""}, from ${path ?? ""}`,
    ),
  ].join("\n");
}

/**
 * Each Sibling Assembly's project, one to a line, with how many types it has;
 * or that there are none, or that they were not looked for.
 */
function siblingProjects(report: XrayReport): string {
  if (!report.inputs.options.siblings) {
    return "not reconstructed (--no-siblings)";
  }
  const siblings = report.solution.projects.slice(1);
  if (siblings.length === 0) {
    return "none found beside it";
  }
  return [
    `${siblings.length}, each a project of its own:`,
    ...siblings.map(
      ({ projectPath, typeCount }) =>
        `${projectPath} (${plural(typeCount, "type")})`,
    ),
  ].join("\n");
}

function buildResult(build: XrayReport["build"]): string {
  if (build === null) {
    return "skipped (--no-build), so the Recovered Solution was not verified";
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

/** How each way of running the rebuilt program reads, after "the rebuilt program". */
const RUN_STATUSES: Readonly<Record<RunStatus, string>> = {
  exited: "exited",
  launched: "launched, and was closed while still running",
  skipped: "skipped",
  crashed: "crashed",
  "timed-out": "timed out",
  "failed-to-start": "failed to start",
};

/** `exited with code 1`, or how else it went, then why, if it says. */
function runResult(run: ProgramRun): string {
  const status = RUN_STATUSES[run.status];
  if (run.status === "exited") {
    return `${status} with code ${run.exitCode}`;
  }
  return run.reason === null ? status : `${status}. ${run.reason}`;
}

function count(
  diagnostics: readonly BuildDiagnostic[],
  severity: BuildDiagnostic["severity"],
): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity)
    .length;
}

function plural(n: number, noun: string, nouns = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : nouns}`;
}

function formatReason(
  reason: PartialReason,
  run: ProgramRun | null,
  reportPath: string,
): string {
  if (reason.kind === "unresolved-dependencies") {
    const { dependencies } = reason;
    return [
      `Partial, because nothing satisfies ${dependencies.length === 1 ? "this reference, an Unresolved Dependency" : `these ${dependencies.length} references, each an Unresolved Dependency`}:`,
      ...dependencies.map(
        ({ reference, referencedBy, reason: why }) =>
          `  ${reference.name} ${reference.version}, referenced by ${referencedBy.join(", ")}. ${why}`,
      ),
    ].join("\n");
  }
  if (reason.kind === "run-failed") {
    const how = run === null ? "did not run" : RUN_STATUSES[run.status];
    return `Partial, because the rebuilt program ${how}. What it wrote is in ${reportPath}, as run.stdout and run.stderr.`;
  }
  if (reason.errors.length === 0) {
    return "Partial, because the Recovered Solution did not build, though `dotnet build` reported no error. Its output follows on stderr.";
  }
  const unlisted = reason.errors.length - LISTED_ERRORS;
  return [
    "Partial, because the Recovered Solution did not build:",
    ...reason.errors
      .slice(0, LISTED_ERRORS)
      .map((error) => `  ${formatDiagnostic(error)}`),
    ...(unlisted > 0
      ? [`  … and ${plural(unlisted, "more error")}, listed in ${reportPath}`]
      : []),
  ].join("\n");
}
