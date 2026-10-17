import { basename, resolve } from "node:path";

import {
  startEngine,
  type EngineClient,
  type EngineOptions,
  type RequestOptions,
} from "../engine/engine-client.js";
import { EngineError } from "../engine/engine-error.js";
import { InputError } from "./input-error.js";

/** What a file is, judged by its PE headers (FR-2). */
export type InputKind = "managed-assembly" | "native-executable" | "not-pe";

/** What a file is, and whether Xray can reconstruct it. */
export interface InputClassification {
  /** The file, as an absolute path. */
  readonly path: string;
  readonly kind: InputKind;
  /** Whether Xray can reconstruct it: only a Managed Assembly can be (ADR 0002). */
  readonly accepted: boolean;
  /**
   * What the file is, for the user. For rejected input, also why Xray cannot
   * reconstruct it.
   */
  readonly explanation: string;
}

/** Why the engine found a file is not a PE file. */
type NotPeReason = "no-dos-header" | "no-pe-header" | "malformed-pe-headers";

/** The engine's answer to `classify` (engine/Xray.Engine/Session.cs). */
type EngineClassification =
  | { readonly kind: "managed-assembly"; readonly machine: string }
  | { readonly kind: "native-executable"; readonly machine: string }
  | { readonly kind: "not-pe"; readonly reason: NotPeReason };

const NOT_PE_REASONS: Readonly<Record<NotPeReason, string>> = {
  "no-dos-header":
    'it does not start with the "MZ" signature every PE file has',
  "no-pe-header":
    "it has an MS-DOS header but no PE header after it, so at most it is an MS-DOS program",
  "malformed-pe-headers": "its PE headers are truncated or corrupt",
};

// System.Reflection.PortableExecutable.Machine names, as people know them.
const ARCHITECTURES: Readonly<Record<string, string>> = {
  I386: "x86",
  Amd64: "x64",
  Arm: "Arm",
  ArmThumb2: "Arm",
  Thumb: "Arm",
  Arm64: "Arm64",
  IA64: "Itanium",
};

const ONLY_MANAGED =
  "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.";

/**
 * Reads the PE headers of the file at `path` (via the engine) and says whether
 * it is a Managed Assembly, a Native Executable or not a PE file at all. Only a
 * Managed Assembly is accepted; anything else comes with an explanation of why
 * it cannot be reconstructed. Rejects with an {@link InputError} if there is no
 * readable file at `path`, and with an {@link EngineError} if the engine fails.
 */
export async function classifyInput(
  path: string,
  options: EngineOptions = {},
): Promise<InputClassification> {
  // The engine runs in a process of its own, so give it no relative path to misread.
  const absolute = resolve(path);
  const engine = await startEngine(options);
  try {
    return await classifyWith(engine, absolute);
  } finally {
    await engine.stop();
  }
}

/** {@link classifyInput} on an engine already running; `path` must be absolute. */
export async function classifyWith(
  engine: EngineClient,
  path: string,
): Promise<InputClassification> {
  const result = await requestOnFile(engine, "classify", path);
  const classification = asEngineClassification(result);
  if (classification === undefined) {
    throw new EngineError(
      "protocol-violation",
      `The Xray engine's answer to "classify" was malformed: ${JSON.stringify(result)}`,
    );
  }
  return {
    path,
    kind: classification.kind,
    accepted: classification.kind === "managed-assembly",
    explanation: explain(`"${basename(path)}"`, classification),
  };
}

/**
 * Sends the engine a command about the file at `path` (absolute), with any
 * other `params` it takes, reporting a file the engine could not read as an
 * {@link InputError}.
 */
export async function requestOnFile(
  engine: EngineClient,
  command: string,
  path: string,
  params: object = {},
  options: RequestOptions = {},
): Promise<Record<string, unknown>> {
  try {
    return await engine.request(command, { ...params, path }, options);
  } catch (error) {
    throw asInputError(error, path) ?? error;
  }
}

function explain(file: string, classification: EngineClassification): string {
  switch (classification.kind) {
    case "managed-assembly":
      return `${file} is a Managed Assembly: it has a CLI header, so it holds the .NET IL and metadata a Reconstruction starts from.`;
    case "native-executable": {
      const architecture = ARCHITECTURES[classification.machine];
      const code =
        architecture === undefined
          ? "machine code"
          : `${architecture} machine code`;
      return [
        `${file} is a Native Executable (${code}), not a Managed Assembly, so Xray cannot reconstruct it.`,
        "It has no CLI header: it was compiled straight to machine code (from C, C++, Rust, Go or similar), which discards the types, members and signatures that .NET IL and metadata keep. The most that could be recovered from it is pseudocode, never a C# solution that builds and behaves like the original.",
        ONLY_MANAGED,
      ].join("\n");
    }
    case "not-pe":
      return [
        `${file} is not a PE file: ${NOT_PE_REASONS[classification.reason]}. It is neither a Managed Assembly nor a Native Executable, so Xray cannot reconstruct it.`,
        ONLY_MANAGED,
      ].join("\n");
  }
}

/** The engine could not read the file: say so as an {@link InputError}. */
function asInputError(error: unknown, path: string): InputError | undefined {
  if (!(error instanceof EngineError) || error.code !== "request-failed") {
    return undefined;
  }
  const cause = { cause: error };
  switch (error.engineCode) {
    case "file-not-found":
      return new InputError("not-found", `There is no file at ${path}.`, cause);
    case "not-a-file":
      return new InputError(
        "not-a-file",
        `${path} is a folder; give the path of an Assembly (an .exe or .dll file).`,
        cause,
      );
    case "file-unreadable":
      return new InputError(
        "unreadable",
        `${path} exists but could not be read; check you have permission to read it.`,
        cause,
      );
    case "invalid-metadata":
      return new InputError(
        "invalid-metadata",
        `${path} has a CLI header, but its .NET metadata could not be read: it is corrupt, or it is a module without an assembly manifest.`,
        cause,
      );
    default:
      return undefined;
  }
}

function asEngineClassification(
  value: Record<string, unknown>,
): EngineClassification | undefined {
  const { kind, machine, reason } = value;
  if (
    (kind === "managed-assembly" || kind === "native-executable") &&
    typeof machine === "string"
  ) {
    return { kind, machine };
  }
  if (
    kind === "not-pe" &&
    typeof reason === "string" &&
    Object.hasOwn(NOT_PE_REASONS, reason)
  ) {
    return { kind, reason: reason as NotPeReason };
  }
  return undefined;
}
