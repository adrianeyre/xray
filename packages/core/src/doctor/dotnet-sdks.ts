import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** One .NET SDK, as `dotnet --list-sdks` reports it. */
export interface DotnetSdk {
  readonly version: string;
  /** The folder holding the SDK, e.g. `/usr/share/dotnet/sdk`. */
  readonly path: string;
}

/**
 * Finds the installed .NET SDKs. Resolves `undefined` when `dotnet` itself
 * cannot be found; rejects if it is found but cannot list its SDKs.
 */
export type DotnetSdkLookup = (
  dotnetPath: string,
) => Promise<readonly DotnetSdk[] | undefined>;

const LIST_TIMEOUT_MS = 30_000;

/** Lists the SDKs by running `dotnet --list-sdks`. */
export const listDotnetSdks: DotnetSdkLookup = async (dotnetPath) => {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(dotnetPath, ["--list-sdks"], {
      timeout: LIST_TIMEOUT_MS,
      windowsHide: true,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return parseSdkList(stdout);
};

/** Parses `dotnet --list-sdks` output: one `<version> [<path>]` per line. */
export function parseSdkList(output: string): DotnetSdk[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [, version, path] =
      /^\s*(\d+\.\d+\.\d+\S*)\s+\[(.*)\]\s*$/.exec(line) ?? [];
    return version === undefined || path === undefined
      ? []
      : [{ version, path }];
  });
}

/** The SDK's major version: 8 for `8.0.425`. */
export function sdkMajor(sdk: DotnetSdk): number {
  return Number.parseInt(sdk.version, 10);
}

/**
 * Orders SDKs newest first by major, minor and patch; a preview sorts below
 * the release it previews.
 */
export function newestFirst(sdks: readonly DotnetSdk[]): DotnetSdk[] {
  return [...sdks].sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a: string, b: string): number {
  const [aCore = "", aPre] = a.split("-", 2);
  const [bCore = "", bPre] = b.split("-", 2);
  const aParts = aCore.split(".").map(Number);
  const bParts = bCore.split(".").map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const difference = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (aPre === undefined || bPre === undefined) {
    return (aPre === undefined ? 1 : 0) - (bPre === undefined ? 1 : 0);
  }
  return aPre.localeCompare(bPre, "en", { numeric: true });
}
