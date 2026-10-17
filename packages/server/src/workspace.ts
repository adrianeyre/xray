import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Windows can hold files open for a moment (antivirus, MSBuild).
const REMOVE = { recursive: true, force: true, maxRetries: 5 } as const;

/**
 * The temporary folder one session of `xray ui` keeps its uploads and outputs
 * in (PRD §8, ADR 0003). Nothing outlives the session: it is deleted when the
 * server stops, and, should the process exit without stopping it, as it exits.
 */
export interface Workspace {
  /** The folder's absolute path. */
  readonly path: string;
  /** Deletes the folder and everything in it. Safe to call more than once. */
  readonly remove: () => Promise<void>;
}

/** Creates a new, empty Workspace in the operating system's temporary folder. */
export async function createWorkspace(): Promise<Workspace> {
  const path = await mkdtemp(join(tmpdir(), "xray-ui-"));
  // The last chance to delete it, should the process exit with it still there.
  const removeOnExit = () => rmSync(path, REMOVE);
  process.once("exit", removeOnExit);
  let removal: Promise<void> | undefined;
  return {
    path,
    remove: () => {
      removal ??= (async () => {
        process.off("exit", removeOnExit);
        await rm(path, REMOVE);
      })();
      return removal;
    },
  };
}
