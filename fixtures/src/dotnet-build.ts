import { execFile } from "node:child_process";
import { promisify } from "node:util";

const BUILD_TIMEOUT_MS = 5 * 60_000;

const run = promisify(execFile);

/**
 * Runs `dotnet build` with `args` and resolves with what it printed. Rejects
 * with the build output, as `Building <what> failed.`, if the build fails.
 */
export async function dotnetBuild(
  dotnetPath: string,
  args: readonly string[],
  what: string,
): Promise<string> {
  try {
    const { stdout } = await run(dotnetPath, ["build", ...args], {
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_NOLOGO: "1",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    throw new Error(`Building ${what} failed.\n${stdout}${stderr}`, {
      cause: error,
    });
  }
}
