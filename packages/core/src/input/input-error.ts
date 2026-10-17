export type InputErrorCode =
  /** Nothing exists at the path given. */
  | "not-found"
  /** The path given is a folder, where only an Assembly will do. */
  | "not-a-file"
  /** The folder given holds no `.exe` or `.dll` file to reconstruct. */
  | "no-assembly-in-folder"
  /** The folder given holds several, and its files do not say which is its application's. */
  | "assembly-not-chosen"
  /** The file exists but could not be read. */
  | "unreadable"
  /** The file has a CLI header, but its metadata is corrupt or holds no assembly manifest. */
  | "invalid-metadata";

/** The input Xray was pointed at could not be read at all. */
export class InputError extends Error {
  override readonly name = "InputError";
  readonly code: InputErrorCode;

  constructor(
    code: InputErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
    this.code = code;
  }
}
