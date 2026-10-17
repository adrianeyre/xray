import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import {
  startEngine,
  type EngineClient,
  type EngineOptions,
} from "../engine/engine-client.js";
import { EngineError } from "../engine/engine-error.js";
import {
  classifyWith,
  requestOnFile,
  type InputClassification,
} from "../input/classify-input.js";
import {
  asEngineInspection,
  summarizeAssembly,
  type AssemblySummary,
} from "./assembly-summary.js";

/** What `xray inspect` found: a summary of a Managed Assembly, or why there is none. */
export type Inspection =
  | {
      /** Not a Managed Assembly, so there is no metadata to summarize (ADR 0002). */
      readonly accepted: false;
      readonly classification: InputClassification;
    }
  | {
      readonly accepted: true;
      readonly classification: InputClassification;
      readonly summary: AssemblySummary;
    };

/**
 * Classifies the file at `path` and, if it is a Managed Assembly, reads its
 * metadata summary (FR-5), with one run of the engine. Input that is not a
 * Managed Assembly is not accepted, as {@link classifyInput} explains. Rejects
 * with an {@link InputError} if there is no readable file or Assembly at
 * `path`, and with an {@link EngineError} if the engine fails.
 */
export async function inspectAssembly(
  path: string,
  options: EngineOptions = {},
): Promise<Inspection> {
  const absolute = resolve(path);
  const engine = await startEngine(options);
  try {
    const classification = await classifyWith(engine, absolute);
    if (!classification.accepted) {
      return { accepted: false, classification };
    }

    return {
      accepted: true,
      classification,
      summary: await inspectWith(engine, absolute),
    };
  } finally {
    await engine.stop();
  }
}

/**
 * The metadata summary of the Managed Assembly at `path` (absolute), read by
 * an engine already running.
 */
export async function inspectWith(
  engine: EngineClient,
  path: string,
): Promise<AssemblySummary> {
  return (await readAssemblyWith(engine, path)).summary;
}

/**
 * As {@link inspectWith}, with the Assembly's `AssemblyInformationalVersion`
 * too (`null` if it has none), which its summary leaves out. The PDB beside
 * it, if there is one, is checked, as its summary's `pdb` says.
 */
export async function readAssemblyWith(
  engine: EngineClient,
  path: string,
): Promise<{
  readonly summary: AssemblySummary;
  readonly informationalVersion: string | null;
}> {
  const pdbPath = await pdbBeside(path);
  const result = await requestOnFile(
    engine,
    "inspect",
    path,
    pdbPath === null ? {} : { pdbPath },
  );
  const inspection = asEngineInspection(result);
  if (inspection === undefined) {
    throw new EngineError(
      "protocol-violation",
      `The Xray engine's answer to "inspect" was malformed: ${JSON.stringify(result)}`,
    );
  }
  return {
    summary: summarizeAssembly(path, inspection, pdbPath),
    informationalVersion: inspection.informationalVersion ?? null,
  };
}

/**
 * The PDB beside the Assembly at `path` (absolute), named after it, as the
 * .NET SDK and Visual Studio write it: `App.pdb` beside `App.dll` or
 * `App.exe`; `null` if there is no such file.
 */
export async function pdbBeside(path: string): Promise<string | null> {
  const pdb = join(dirname(path), `${basename(path, extname(path))}.pdb`);
  try {
    return (await stat(pdb)).isFile() ? pdb : null;
  } catch {
    return null;
  }
}
