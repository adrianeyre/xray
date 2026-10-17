export type ReconstructionErrorCode =
  /** The output directory exists and is not empty, and replacing it was not asked for. */
  | "output-not-empty"
  /** The output directory's path is a file. */
  | "output-not-a-folder"
  /** Replacing the output directory would delete the input Assembly. */
  | "output-holds-input"
  /** The Assembly does not say which framework it targets in a way a project can. */
  | "unknown-target-framework";

/** A Reconstruction that could not start or finish, for a reason the user can act on. */
export class ReconstructionError extends Error {
  override readonly name = "ReconstructionError";
  readonly code: ReconstructionErrorCode;

  constructor(
    code: ReconstructionErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.code = code;
  }
}
