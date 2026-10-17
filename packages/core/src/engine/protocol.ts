// The wire contract with the engine sidecar (engine/Xray.Engine/Protocol.cs):
// newline-delimited JSON over stdio, one response line per request line, which
// a long command may precede with progress lines carrying the request's id.

/** Must equal `Protocol.Version` in the engine; the handshake refuses a mismatch. */
export const ENGINE_PROTOCOL_VERSION = 11;

export interface EngineRequest {
  readonly id: number;
  readonly command: string;
  readonly params: object;
}

export type EngineResponse =
  | { readonly id: number | null; readonly result: Record<string, unknown> }
  | {
      readonly id: number | null;
      readonly error: { readonly code: string; readonly message: string };
    };

/** How far a command has got: `decompile` sends one before each type. */
export interface EngineProgress {
  readonly done: number;
  readonly total: number;
  /** What the command is working on now, such as the type being decompiled. */
  readonly current: string;
}

/** A progress line, sent while the request with this `id` runs. */
export interface EngineProgressLine {
  readonly id: number;
  readonly progress: EngineProgress;
}

/** What the engine reports about itself during the handshake. */
export interface EngineInfo {
  readonly protocolVersion: number;
  readonly engineVersion: string;
  readonly decompilerVersion: string;
}

/** Narrows a parsed line to an {@link EngineResponse}, or returns `undefined`. */
export function asEngineResponse(value: unknown): EngineResponse | undefined {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return undefined;
  }
  const { id } = value;
  if (id !== null && !Number.isInteger(id)) {
    return undefined;
  }
  if ("result" in value && isRecord(value.result)) {
    return value as EngineResponse;
  }
  if (
    "error" in value &&
    isRecord(value.error) &&
    typeof value.error["code"] === "string" &&
    typeof value.error["message"] === "string"
  ) {
    return value as EngineResponse;
  }
  return undefined;
}

/** Narrows a parsed line to an {@link EngineProgressLine}, or returns `undefined`. */
export function asEngineProgressLine(
  value: unknown,
): EngineProgressLine | undefined {
  if (
    !isRecord(value) ||
    !Number.isInteger(value["id"]) ||
    !isRecord(value["progress"])
  ) {
    return undefined;
  }
  const { done, total, current } = value["progress"];
  return Number.isInteger(done) &&
    Number.isInteger(total) &&
    typeof current === "string"
    ? {
        id: value["id"] as number,
        progress: { done: done as number, total: total as number, current },
      }
    : undefined;
}

export function asEngineInfo(
  value: Record<string, unknown>,
): EngineInfo | undefined {
  const { protocolVersion, engineVersion, decompilerVersion } = value;
  return Number.isInteger(protocolVersion) &&
    typeof engineVersion === "string" &&
    typeof decompilerVersion === "string"
    ? {
        protocolVersion: protocolVersion as number,
        engineVersion,
        decompilerVersion,
      }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
