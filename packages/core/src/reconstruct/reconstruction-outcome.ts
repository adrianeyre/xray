import type { BuildDiagnostic } from "./build-diagnostics.js";
import type { SolutionBuild } from "./build-solution.js";
import { runFailed, type ProgramRun } from "./run-program.js";
import type { Dependency } from "./sibling-assemblies.js";

/**
 * A Full Reconstruction's Recovered Solution built, and, if it was asked to
 * run (`--run`), its program ran; a Partial one's did not, or it has
 * Unresolved Dependencies, for the {@link PartialReason}s given (FR-10.5,
 * FR-15). An unverified one was not built at all (`--no-build`), and has no
 * Unresolved Dependency, so it is neither. Whether a Recovered Solution
 * behaves like the original is for a Round-trip to prove.
 */
export type ReconstructionOutcome = "full" | "partial" | "unverified";

/** Why a Reconstruction is Partial. */
export type PartialReason =
  | {
      /**
       * Dependency Resolution could not satisfy these references (FR-10.5):
       * nothing provides them, so the Recovered Solution cannot build as the
       * original did, whether it was built or not.
       */
      readonly kind: "unresolved-dependencies";
      /** Each Unresolved Dependency, in the order it was met. */
      readonly dependencies: readonly Dependency[];
    }
  | {
      /** The Recovered Solution did not build. */
      readonly kind: "build-failed";
      /**
       * The build's errors, mapped to files and lines. Empty if it failed
       * without reporting one, as when it was stopped for taking too long;
       * its output then says why.
       */
      readonly errors: readonly BuildDiagnostic[];
    }
  | {
      /**
       * It built, but its program, asked to run, did not run to an exit: it
       * crashed, did not exit in time, or could not be started. The
       * {@link ProgramRun} says which, and why.
       */
      readonly kind: "run-failed";
    };

/**
 * The outcome of a Reconstruction whose Recovered Solution built so, or was
 * not built (`null`), whose program ran so, or was not asked to (`null`), and
 * whose `dependencies` were resolved so. Any Unresolved Dependency makes it
 * Partial, first among its reasons, even unbuilt. A program that could not run
 * here, and was skipped, does not count against it; nor does its exit code,
 * which only a Round-trip can compare.
 */
export function classifyOutcome(
  build: SolutionBuild | null,
  run: ProgramRun | null = null,
  dependencies: readonly Dependency[] = [],
): {
  readonly outcome: ReconstructionOutcome;
  readonly reasons: readonly PartialReason[];
} {
  const unresolved = dependencies.filter(
    ({ resolution }) => resolution === "unresolved",
  );
  const reasons: PartialReason[] =
    unresolved.length === 0
      ? []
      : [{ kind: "unresolved-dependencies", dependencies: unresolved }];
  if (build !== null && !build.succeeded) {
    const errors = build.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    reasons.push({ kind: "build-failed", errors });
  } else if (run !== null && runFailed(run)) {
    reasons.push({ kind: "run-failed" });
  }
  if (reasons.length > 0) {
    return { outcome: "partial", reasons };
  }
  return { outcome: build === null ? "unverified" : "full", reasons };
}
