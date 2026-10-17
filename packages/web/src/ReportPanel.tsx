import type {
  BuildDiagnostic,
  ReportDependency,
  ReportSummary,
} from "./events.js";
import {
  buildResult,
  dependencyResult,
  dependencyRows,
  formatDiagnostic,
  formatDuration,
  OUTCOMES,
  obfuscationResult,
  pdbResult,
  resourcesResult,
  plural,
  reportDiagnostics,
  reportTimings,
  siblingResult,
  typesResult,
  type DiagnosticTarget,
  type ReportDiagnostic,
} from "./report.js";

/**
 * The `xray-report.json` a Reconstruction wrote into its Recovered Solution
 * (FR-17, FR-22): its outcome, plainly a success when it is a Full
 * Reconstruction, with its Unresolved Dependencies, if any; how Dependency
 * Resolution satisfied every reference, in a table; how long each stage
 * took; and every error and warning `dotnet build` printed, each opening its
 * file at its line in the viewer.
 */
export function ReportPanel({
  report,
  directory,
  onGoTo,
}: {
  readonly report: ReportSummary;
  /** Where the Recovered Solution is. */
  readonly directory: string;
  /** Told of the place in the Recovered Solution a diagnostic chosen is about, to show it in the viewer. */
  readonly onGoTo: (target: DiagnosticTarget) => void;
}) {
  const { title, says } = OUTCOMES[report.outcome];
  const { solution } = report;
  const facts: [string, string][] = [
    ["Recovered Solution", directory],
    ["Solution", solution.solutionPath],
    ["Project", solution.projectPath],
    ["Target framework", solution.targetFramework],
    ["Output type", solution.outputType],
    ["Types", typesResult(solution)],
    ["Resources", resourcesResult(report)],
    ["PDB", pdbResult(report)],
    ["Obfuscation", obfuscationResult(report)],
    ["Dependencies", dependencyResult(report)],
    ["Sibling Assemblies", siblingResult(report)],
    ["Build", buildResult(report.build)],
    ["Time", formatDuration(report.timings.total)],
  ];
  return (
    <section className="report" aria-label="Report">
      <h2>
        Report <code>xray-report.json</code>
      </h2>
      <div className="outcome" data-outcome={report.outcome} role="status">
        <h3>{title}</h3>
        <p>{says}</p>
        <dl className="facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {report.reasons.map((reason) =>
          reason.kind === "unresolved-dependencies" ? (
            <Unresolved
              key="unresolved-dependencies"
              dependencies={reason.dependencies}
            />
          ) : reason.kind === "build-failed" ? (
            <BuildFailed key="build-failed" errors={reason.errors} />
          ) : (
            <p key="run-failed">
              Partial, because the rebuilt program did not run to an exit.
            </p>
          ),
        )}
      </div>
      <Warnings warnings={report.warnings} />
      <DependencyResolution report={report} />
      <SiblingAssemblies report={report} />
      <h3>Timings</h3>
      <table className="timings">
        <tbody>
          {reportTimings(report.timings).map(([stage, time]) => (
            <tr key={stage}>
              <th scope="row">{stage}</th>
              <td>{time}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Diagnostics
        built={report.build !== null}
        diagnostics={reportDiagnostics(report)}
        onGoTo={onGoTo}
      />
    </section>
  );
}

/**
 * What went less well than it might have, though the Reconstruction is no
 * less Full for it, such as a PDB beside an Assembly that was ignored, or an
 * Assembly that is likely obfuscated.
 */
function Warnings({
  warnings,
}: {
  readonly warnings: ReportSummary["warnings"];
}) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <>
      <h3>Warnings</h3>
      <ul className="warnings">
        {warnings.map(({ kind, message }) => (
          <li key={message} data-kind={kind}>
            {message}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The project of each Sibling Assembly, with how many types it has and the
 * projects it references; and what Xray worked around in them.
 */
function SiblingAssemblies({ report }: { readonly report: ReportSummary }) {
  const siblings = report.solution.projects.slice(1);
  if (siblings.length === 0 && report.siblingProblems.length === 0) {
    return null;
  }
  return (
    <>
      <h3>Sibling Assemblies</h3>
      {siblings.length === 0 ? null : (
        <ul className="sibling-projects">
          {siblings.map((project) => (
            <li key={project.projectPath}>
              <code>{project.projectPath}</code>,{" "}
              {plural(project.typeCount, "type")}
              {project.projectReferences.length === 0 ? null : (
                <>
                  , referencing{" "}
                  {project.projectReferences.map((reference, index) => (
                    <span key={reference}>
                      {index === 0 ? null : ", "}
                      <code>{reference}</code>
                    </span>
                  ))}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {report.siblingProblems.length === 0 ? null : (
        <>
          <p>Worked around:</p>
          <ul className="sibling-problems">
            {report.siblingProblems.map(({ kind, message }) => (
              <li key={message} data-kind={kind}>
                {message}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Unresolved({
  dependencies,
}: {
  readonly dependencies: readonly ReportDependency[];
}) {
  return (
    <p className="unresolved">
      Partial, because nothing satisfies{" "}
      {dependencies.length === 1
        ? "this reference, an Unresolved Dependency"
        : `these ${dependencies.length} references, each an Unresolved Dependency`}
      :{" "}
      {dependencies.map(({ reference }, index) => (
        <span key={reference.name}>
          {index === 0 ? null : ", "}
          <code>{reference.name}</code>
        </span>
      ))}
      . The table below says why.
    </p>
  );
}

/**
 * Every reference of every Assembly of the solution, and how Dependency
 * Resolution satisfied it (FR-10): the framework, a NuGet package, a Sibling
 * Assembly's project, a binary copied into the Recovered Solution, or
 * nothing; what in the Recovered Solution satisfies it; which Assemblies make
 * it; and why.
 */
function DependencyResolution({ report }: { readonly report: ReportSummary }) {
  const rows = dependencyRows(report);
  return (
    <>
      <h3>Dependency Resolution</h3>
      {rows.length === 0 ? (
        <p>No Assembly of the solution references another assembly.</p>
      ) : (
        // Scrolls within the page; focusable, so it scrolls from the keyboard too.
        <div
          className="dependencies-scroll"
          role="region"
          aria-label="Dependency Resolution"
          tabIndex={0}
        >
          <table className="dependencies">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Resolution</th>
                <th scope="col">In the Recovered Solution</th>
                <th scope="col">Referenced by</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} data-resolution={row.resolution}>
                  <th scope="row">
                    <code>{row.name}</code>{" "}
                    <span className="identity">{row.identity}</span>
                  </th>
                  <td>{row.resolvedAs}</td>
                  <td>
                    {row.satisfiedBy === null ? (
                      "—"
                    ) : (
                      <code>{row.satisfiedBy}</code>
                    )}
                  </td>
                  <td>{row.referencedBy}</td>
                  <td className="reason">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BuildFailed({
  errors,
}: {
  readonly errors: readonly BuildDiagnostic[];
}) {
  if (errors.length === 0) {
    return (
      <p>
        Partial, because the Recovered Solution did not build, though{" "}
        <code>dotnet build</code> reported no error. Its output is in{" "}
        <code>xray-report.json</code>.
      </p>
    );
  }
  return (
    <p>
      Partial, because the Recovered Solution did not build, with{" "}
      {plural(errors.length, "error")}, listed below at{" "}
      {errors.length === 1 ? "its file and line" : "their files and lines"}.
    </p>
  );
}

function Diagnostics({
  built,
  diagnostics,
  onGoTo,
}: {
  readonly built: boolean;
  readonly diagnostics: readonly ReportDiagnostic[];
  readonly onGoTo: (target: DiagnosticTarget) => void;
}) {
  const errors = diagnostics.filter(
    ({ diagnostic }) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.length - errors;
  return (
    <>
      <h3>Build diagnostics</h3>
      {!built ? (
        <p>It was not built, so there are none.</p>
      ) : diagnostics.length === 0 ? (
        <p className="diagnostics-none">
          None: <code>dotnet build</code> reported no error or warning.
        </p>
      ) : (
        <>
          <p>
            {errors === 0
              ? `${plural(warnings, "warning")}.`
              : warnings === 0
                ? `${plural(errors, "error")}.`
                : `${plural(errors, "error")} and ${plural(warnings, "warning")}, errors first.`}{" "}
            Choose one to open its file at its line.
          </p>
          <ol
            className="diagnostics"
            aria-label="Build diagnostics"
            // It scrolls; focusable, so it scrolls from the keyboard too.
            tabIndex={0}
          >
            {diagnostics.map(({ diagnostic, target }, index) => (
              <li key={index} data-severity={diagnostic.severity}>
                {target === null ? (
                  <code
                    title={
                      diagnostic.file === undefined
                        ? "It names no file."
                        : "Its file is not part of the Recovered Solution."
                    }
                  >
                    {formatDiagnostic(diagnostic)}
                  </code>
                ) : (
                  <button
                    type="button"
                    title={`Open ${target.path}${target.line === null ? "" : ` at line ${target.line}`}`}
                    onClick={() => onGoTo(target)}
                  >
                    <code>{formatDiagnostic(diagnostic)}</code>
                  </button>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
