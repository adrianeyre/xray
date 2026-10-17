import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { ReconstructionError } from "./reconstruction-error.js";

// Windows can hold freshly built files open for a moment (antivirus, MSBuild).
const REMOVE = { recursive: true, force: true, maxRetries: 5 } as const;

/**
 * Checks a Recovered Solution may be written to `output` (absolute): a folder
 * that does not exist yet or is empty, or, with `force`, one whose contents
 * may be replaced, so long as that would not delete the input Assembly at
 * `input` (absolute). Throws a {@link ReconstructionError} otherwise.
 */
export async function checkOutputDirectory(
  output: string,
  input: string,
  force: boolean,
): Promise<void> {
  let entries: string[];
  try {
    if (!(await stat(output)).isDirectory()) {
      throw new ReconstructionError(
        "output-not-a-folder",
        `${output} is a file; give the path of a folder to write the Recovered Solution to.`,
      );
    }
    entries = await readdir(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (entries.length === 0) {
    return;
  }
  if (!force) {
    throw new ReconstructionError(
      "output-not-empty",
      `${output} is not empty. Choose an empty or new folder, or pass --force to replace what is in it.`,
    );
  }
  if (await isWithin(input, output)) {
    throw new ReconstructionError(
      "output-holds-input",
      `${output} holds ${input}, which replacing its contents would delete. Choose a folder that does not hold the Assembly.`,
    );
  }
}

/**
 * Makes `output` an empty folder, removing whatever it holds (which
 * {@link checkOutputDirectory} has allowed), or creating it and its parents.
 */
export async function prepareOutputDirectory(output: string): Promise<void> {
  const entries = await readdir(output).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  // The folder itself stays, in case it is a mount point or has permissions of its own.
  await Promise.all(entries.map((entry) => rm(join(output, entry), REMOVE)));
  await mkdir(output, { recursive: true });
}

/** Whether `path` is `folder` or inside it, following symbolic links. */
async function isWithin(path: string, folder: string): Promise<boolean> {
  const [realPath, realFolder] = await Promise.all([
    realpath(path).catch(() => path),
    realpath(folder),
  ]);
  const inside = relative(realFolder, realPath);
  return (
    inside === "" ||
    !(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
  );
}
