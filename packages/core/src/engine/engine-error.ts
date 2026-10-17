export type EngineErrorCode =
  /** The engine DLL is not where Xray looked for it. */
  | "engine-not-found"
  /** `dotnet`, or the .NET runtime the engine targets, is not installed. */
  | "runtime-not-found"
  /** Xray and the engine speak different protocol versions. */
  | "protocol-mismatch"
  /** The engine wrote something on stdout that is not a protocol response. */
  | "protocol-violation"
  /** The engine process ended without being asked to. */
  | "engine-exited"
  /** The engine did not answer in time. */
  | "timeout"
  /** The engine was stopped before it answered. */
  | "stopped"
  /** The engine answered a request with an error. */
  | "request-failed";

/** Every failure the engine client reports, so callers can branch on `code`. */
export class EngineError extends Error {
  override readonly name = "EngineError";
  readonly code: EngineErrorCode;
  /** The engine's own error code, for `request-failed` and `protocol-mismatch`. */
  readonly engineCode: string | undefined;
  /** The tail of the engine's stderr, when the process failed. */
  readonly stderr: string | undefined;

  constructor(
    code: EngineErrorCode,
    message: string,
    details: {
      readonly engineCode?: string;
      readonly stderr?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.code = code;
    this.engineCode = details.engineCode;
    this.stderr = details.stderr;
  }
}
