import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** The tarball `pnpm pack` made of this package: what `pnpm publish` uploads. */
    tarball: string;
  }
}

/**
 * Runs pnpm with `args` in `cwd`. Through a shell on Windows, where pnpm is a
 * `.cmd` script that cannot be run without one.
 */
export function pnpm(
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const windows = process.platform === "win32";
  return promisify(execFile)(
    "pnpm",
    windows ? args.map((arg) => `"${arg}"`) : [...args],
    { ...options, shell: windows, maxBuffer: 16 * 1024 * 1024 },
  );
}

/**
 * Vitest global setup: packs the package as `pnpm publish` would, building it
 * first through its `prepack` script, so the tests install exactly what would
 * be published. The tarball is deleted once they have run.
 */
export default async function pack(project: TestProject) {
  const destination = await mkdtemp(join(tmpdir(), "xray-pack-"));
  try {
    await pnpm(["pack", "--pack-destination", destination], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    throw new Error(`Packing @adrianeyre/xray failed.\n${stdout}${stderr}`, {
      cause: error,
    });
  }
  const [tarball] = await readdir(destination);
  if (tarball === undefined) {
    throw new Error(`pnpm pack wrote no tarball to ${destination}.`);
  }
  project.provide("tarball", join(destination, tarball));
  return () => rm(destination, { recursive: true, force: true });
}
