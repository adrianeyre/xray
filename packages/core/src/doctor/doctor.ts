import { startEngine, type EngineOptions } from "../engine/engine-client.js";
import { EngineError, type EngineErrorCode } from "../engine/engine-error.js";
import {
  listDotnetSdks,
  newestFirst,
  sdkMajor,
  type DotnetSdkLookup,
} from "./dotnet-sdks.js";

/** The oldest Node.js major version Xray supports (`engines.node` in package.json). */
export const MINIMUM_NODE_MAJOR = 26;

/** The oldest .NET SDK major version Xray supports (ADR 0001). */
export const MINIMUM_DOTNET_SDK_MAJOR = 8;

export type DoctorCheckId = "node" | "dotnet-sdk" | "engine";

/** The outcome of one check. */
export interface DoctorCheck {
  readonly id: DoctorCheckId;
  /** What was checked, e.g. ".NET SDK". */
  readonly title: string;
  readonly passed: boolean;
  /** What was found, or what is wrong. */
  readonly summary: string;
  /** How to fix it, for a failed check whose summary does not already say. */
  readonly fix?: string;
}

export interface DoctorReport {
  /** Node.js, .NET SDK, then engine, whether or not earlier checks passed. */
  readonly checks: readonly DoctorCheck[];
  /** Whether every check passed. */
  readonly passed: boolean;
}

export interface DoctorOptions extends EngineOptions {
  /** The Node.js version to check. Defaults to the one running Xray. */
  readonly nodeVersion?: string;
  /** Finds the installed .NET SDKs. Defaults to `dotnet --list-sdks`. */
  readonly listSdks?: DotnetSdkLookup;
}

const INSTALL_DOTNET_SDK = `Install the .NET SDK ${MINIMUM_DOTNET_SDK_MAJOR} or later from https://dot.net.`;

/**
 * Checks this machine can run Xray: the Node.js version, a .NET SDK 8 or later,
 * and an engine that starts, handshakes and answers a ping. Never rejects; every
 * problem is reported as a failed check.
 */
export async function runDoctor(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks = await Promise.all([
    checkNode(options.nodeVersion ?? process.versions.node),
    checkDotnetSdk(
      options.dotnetPath ?? "dotnet",
      options.listSdks ?? listDotnetSdks,
    ),
    checkEngine(options),
  ]);
  return { checks, passed: checks.every((check) => check.passed) };
}

function checkNode(version: string): DoctorCheck {
  const title = "Node.js";
  if (Number.parseInt(version, 10) >= MINIMUM_NODE_MAJOR) {
    return { id: "node", title, passed: true, summary: version };
  }
  return {
    id: "node",
    title,
    passed: false,
    summary: `Node.js ${version} is running; Xray requires Node.js ${MINIMUM_NODE_MAJOR} or later.`,
    fix: `Install Node.js ${MINIMUM_NODE_MAJOR} or later from https://nodejs.org (a version manager such as fnm, nvm or Volta can keep it alongside other versions) and run Xray with it.`,
  };
}

async function checkDotnetSdk(
  dotnetPath: string,
  listSdks: DotnetSdkLookup,
): Promise<DoctorCheck> {
  const title = ".NET SDK";
  const failed = (summary: string, fix = INSTALL_DOTNET_SDK): DoctorCheck => ({
    id: "dotnet-sdk",
    title,
    passed: false,
    summary,
    fix,
  });

  let sdks;
  try {
    sdks = await listSdks(dotnetPath);
  } catch (error) {
    return failed(
      `Could not list the installed .NET SDKs with "${dotnetPath} --list-sdks": ${message(error)}`,
      `Check that \`dotnet --list-sdks\` runs, or reinstall the .NET SDK ${MINIMUM_DOTNET_SDK_MAJOR} or later from https://dot.net.`,
    );
  }

  if (sdks === undefined) {
    return failed(
      `"${dotnetPath}" was not found, so no .NET SDK is available.`,
      `Install the .NET SDK ${MINIMUM_DOTNET_SDK_MAJOR} or later from https://dot.net and make sure \`dotnet\` is on PATH.`,
    );
  }
  if (sdks.length === 0) {
    return failed(
      `"${dotnetPath}" is installed but no .NET SDK is (a .NET runtime alone cannot build a Recovered Solution).`,
    );
  }

  const newest = newestFirst(sdks);
  const supported = newest.find(
    (sdk) => sdkMajor(sdk) >= MINIMUM_DOTNET_SDK_MAJOR,
  );
  if (supported === undefined) {
    const found = newest.map((sdk) => sdk.version).join(", ");
    return failed(
      `Only .NET SDK ${found} ${newest.length === 1 ? "is" : "are"} installed; Xray needs ${MINIMUM_DOTNET_SDK_MAJOR} or later.`,
    );
  }
  return {
    id: "dotnet-sdk",
    title,
    passed: true,
    summary: `${supported.version} (${supported.path})`,
  };
}

// Engine failures whose message already says how to fix them.
const SELF_EXPLANATORY_ENGINE_ERRORS: ReadonlySet<EngineErrorCode> = new Set([
  "engine-not-found",
  "runtime-not-found",
  "protocol-mismatch",
]);

async function checkEngine(options: EngineOptions): Promise<DoctorCheck> {
  const title = "Xray engine";
  try {
    const engine = await startEngine(options);
    try {
      await engine.ping();
      const { engineVersion, protocolVersion, decompilerVersion } = engine.info;
      return {
        id: "engine",
        title,
        passed: true,
        summary: `${engineVersion} (protocol ${protocolVersion}, ICSharpCode.Decompiler ${decompilerVersion})`,
      };
    } finally {
      await engine.stop();
    }
  } catch (error) {
    const explained =
      error instanceof EngineError &&
      SELF_EXPLANATORY_ENGINE_ERRORS.has(error.code);
    return {
      id: "engine",
      title,
      passed: false,
      summary: message(error),
      ...(explained
        ? {}
        : {
            fix: "Rebuild the engine with `pnpm build:engine` and try again.",
          }),
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
