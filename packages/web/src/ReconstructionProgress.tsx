import { STAGES, type ReconstructionEnd, type Stage } from "./events.js";
import type { Connection } from "./reconstruction-client.js";
import type { ReconstructionView, StageView } from "./reconstruction-view.js";
import { formatDuration } from "./report.js";

const STAGE_NAMES: Readonly<Record<Stage, string>> = {
  analyse: "Analyse",
  decompile: "Decompile",
  "resolve-dependencies": "Resolve dependencies",
  generate: "Generate solution",
  build: "Build",
  run: "Run the rebuilt program",
};

/** What each stage counts, when it counts: one, and more. */
const COUNTED: Partial<Readonly<Record<Stage, readonly [string, string]>>> = {
  decompile: ["type", "types"],
  "resolve-dependencies": ["Sibling Assembly", "Sibling Assemblies"],
  generate: ["file", "files"],
};

const STATUS_NAMES: Readonly<Record<StageView["status"], string>> = {
  waiting: "Waiting",
  running: "Running",
  finished: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

/**
 * A Reconstruction as it runs (FR-19): each stage of the pipeline, how far it
 * has got and how long it has taken, then, if it wrote no Recovered Solution,
 * why not.
 */
export function ReconstructionProgress({
  view,
  connection,
}: {
  readonly view: ReconstructionView;
  readonly connection: Connection | null;
}) {
  return (
    <section className="reconstruction" aria-label="Reconstruction progress">
      <h2>
        {view.end === null
          ? "Reconstructing"
          : view.end.kind === "reconstructed"
            ? "Reconstructed"
            : "Could not reconstruct"}{" "}
        <code className="reconstruction-path">{view.path ?? "…"}</code>
      </h2>
      <ConnectionNotice connection={connection} />
      <p className="visually-hidden" aria-live="polite">
        {stageAnnouncement(view)}
      </p>
      <ol className="stages">
        {view.stages.map((stage) => (
          <StageItem key={stage.stage} stage={stage} />
        ))}
      </ol>
      {view.end === null ? null : <Outcome end={view.end} />}
    </section>
  );
}

/**
 * What a screen reader is told as the Reconstruction moves on (WCAG 4.1.3):
 * the stage it is at, and how that stage stands; not every count, which would
 * talk over everything else.
 */
export function stageAnnouncement(view: ReconstructionView): string {
  const reached = view.stages.filter((stage) => stage.status !== "waiting");
  const latest = reached.at(-1);
  if (latest === undefined) {
    return "";
  }
  const number = STAGES.indexOf(latest.stage) + 1;
  return `Stage ${number} of ${STAGES.length}, ${STAGE_NAMES[latest.stage]}: ${STATUS_NAMES[latest.status].toLowerCase()}.`;
}

function ConnectionNotice({
  connection,
}: {
  readonly connection: Connection | null;
}) {
  switch (connection?.state) {
    case "reconnecting":
      return (
        <p className="notice" role="status">
          Lost the connection to Xray. Connecting again, to carry on where it
          left off…
        </p>
      );
    case "lost":
      return (
        <p className="notice notice-error" role="alert">
          {connection.message}
        </p>
      );
    default:
      return null;
  }
}

function StageItem({ stage }: { readonly stage: StageView }) {
  const number = STAGES.indexOf(stage.stage) + 1;
  return (
    <li className="stage" data-stage={stage.stage} data-status={stage.status}>
      <span className="stage-name">
        {number}. {STAGE_NAMES[stage.stage]}
      </span>
      <span className="stage-status">{STATUS_NAMES[stage.status]}</span>
      <span className="stage-time">
        {stage.ms === null || stage.status === "skipped"
          ? ""
          : formatDuration(stage.ms)}
      </span>
      <StageDetail stage={stage} />
    </li>
  );
}

function StageDetail({ stage }: { readonly stage: StageView }) {
  if (stage.status === "running") {
    const { done, total, current } = stage;
    const nouns = COUNTED[stage.stage];
    const counted =
      done === null || total === null
        ? null
        : `${done} of ${total}${nouns === undefined ? "" : ` ${nouns[total === 1 ? 0 : 1]}`}`;
    return (
      <span className="stage-detail">
        {counted === null ? null : (
          <progress
            value={done ?? 0}
            max={Math.max(total ?? 1, 1)}
            aria-hidden="true"
          />
        )}
        {[counted, current].filter((part) => part !== null).join(": ")}
      </span>
    );
  }
  if (stage.note !== null) {
    return <span className="stage-detail">{stage.note}</span>;
  }
  return null;
}

/**
 * How a Reconstruction that wrote no Recovered Solution ended: why there is
 * none. One that wrote one has its report, in the report panel.
 */
export function Outcome({ end }: { readonly end: ReconstructionEnd }) {
  switch (end.kind) {
    case "rejected":
      return (
        <div
          className="outcome outcome-error"
          data-outcome="rejected"
          role="alert"
        >
          <h3>Xray cannot reconstruct this file</h3>
          <p className="explanation">{end.explanation}</p>
        </div>
      );
    case "failed":
      return (
        <div
          className="outcome outcome-error"
          data-outcome="failed"
          role="alert"
        >
          <h3>The Reconstruction failed</h3>
          <p className="explanation">{end.message}</p>
        </div>
      );
    default:
      return null;
  }
}
