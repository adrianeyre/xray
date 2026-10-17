import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * Vitest global setup: builds the engine the tests run, so they never exercise
 * a stale build. Same build as `pnpm build:engine`.
 */
export default async function buildEngine(): Promise<void> {
  const project = fileURLToPath(
    new URL(
      "../../../../engine/Xray.Engine/Xray.Engine.csproj",
      import.meta.url,
    ),
  );
  try {
    await promisify(execFile)("dotnet", [
      "build",
      project,
      "--configuration",
      "Release",
    ]);
  } catch (error) {
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    throw new Error(`Building the engine failed.\n${stdout}${stderr}`, {
      cause: error,
    });
  }
}
