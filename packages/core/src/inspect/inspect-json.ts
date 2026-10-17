import type { AssemblySummary } from "./assembly-summary.js";

/**
 * The version of the `xray inspect --json` document
 * (docs/reference/xray-inspect-json.md). Bump it when a field is removed,
 * renamed or changes meaning; adding a field or a new value of an enumeration
 * keeps it.
 */
export const INSPECT_JSON_SCHEMA_VERSION = 1;

/** The `xray inspect --json` document. */
export interface InspectJson extends AssemblySummary {
  readonly schemaVersion: typeof INSPECT_JSON_SCHEMA_VERSION;
}

/** The `xray inspect --json` document for a summary. */
export function toInspectJson(summary: AssemblySummary): InspectJson {
  return { schemaVersion: INSPECT_JSON_SCHEMA_VERSION, ...summary };
}
