export type ServerErrorCode =
  /** Something else is already listening on the port asked for. */
  | "port-in-use"
  /** There is no built web app to serve. */
  | "web-app-not-built";

/** `xray ui`'s server could not start, for a reason the user can act on. */
export class ServerError extends Error {
  override readonly name = "ServerError";
  readonly code: ServerErrorCode;

  constructor(
    code: ServerErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.code = code;
  }
}
