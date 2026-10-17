import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createWorkspace } from "./workspace.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("createWorkspace", () => {
  it("can be removed more than once", async () => {
    const workspace = await createWorkspace();

    await workspace.remove();
    await workspace.remove();

    expect(await exists(workspace.path)).toBe(false);
  });

  it("is deleted when the process exits without removing it", async () => {
    // A process that makes a Workspace, says where, and exits.
    const script = `
      const { createWorkspace } = await import(${JSON.stringify(new URL("./workspace.ts", import.meta.url).href)});
      const workspace = await createWorkspace();
      process.stdout.write(workspace.path);
    `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ]);

    expect(stdout).not.toBe("");
    expect(await exists(stdout)).toBe(false);
  });
});
