import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { dotnetBuild } from "./dotnet-build.js";

/** This repository's `fixtures/` folder. */
export const FIXTURES_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

/**
 * The native Fixture: a prebuilt Windows x64 Native Executable, committed with
 * its C source (`fixtures/native`), that Xray must reject. Nothing builds it.
 */
export const NATIVE_EXECUTABLE_FIXTURE = fileURLToPath(
  new URL("../native/hello.exe", import.meta.url),
);

export interface FixtureOptions {
  /** The folder holding the Fixtures. Defaults to {@link FIXTURES_DIRECTORY}. */
  readonly fixturesDirectory?: string;
  /**
   * Where built Fixtures are kept between runs. Defaults to `.cache` in the
   * fixtures folder.
   */
  readonly cacheDirectory?: string;
  /** The `dotnet` host that builds them. Defaults to `dotnet` on PATH. */
  readonly dotnetPath?: string;
}

/** A Fixture compiled from its source. */
export interface BuiltFixture {
  readonly name: string;
  /** The Assembly the Fixture compiles to: where a Round-trip starts. */
  readonly assemblyPath: string;
  /** Its target framework moniker, e.g. `net8.0` or `net48`. */
  readonly targetFramework: string;
  /**
   * Its project's `OutputType`: `Exe` for a console Fixture, `WinExe` for a
   * GUI one (WinForms, WPF), `Library` for a library.
   */
  readonly outputType: string;
  /** The folder holding the Assembly and everything built beside it. */
  readonly outputDirectory: string;
}

/** One run of a console Fixture, and what it should do. */
export interface FixtureInput {
  /** The command-line arguments. */
  readonly args: readonly string[];
  /** What the Fixture, compiled from its source, does with them. */
  readonly expected: {
    /** Each line written to stdout, without its line ending. */
    readonly stdout: readonly string[];
    /** Each line written to stderr, without its line ending. */
    readonly stderr: readonly string[];
    readonly exitCode: number;
  };
}

/** Bump when the cache's layout changes, so stale entries are not read. */
const CACHE_FORMAT = 3;
const INPUTS_FILE = "inputs.json";
// Files in the fixtures folder that MSBuild or NuGet read for every Fixture.
const SHARED_BUILD_FILE =
  /^(Directory\.(Build|Packages)\.(props|targets)|global\.json|nuget\.config)$/i;
const BUILD_OUTPUT = new Set(["bin", "obj"]);
const HASH_LENGTH = 16;
// Windows can hold freshly built files open for a moment (antivirus, MSBuild).
const REMOVE_FOLDER = { recursive: true, force: true, maxRetries: 5 } as const;

const run = promisify(execFile);
const building = new Map<string, Promise<BuiltFixture>>();

/** The names of every Fixture: each folder holding exactly one `.csproj`. */
export async function listFixtures(
  options: FixtureOptions = {},
): Promise<string[]> {
  const root = options.fixturesDirectory ?? FIXTURES_DIRECTORY;
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (await projectsIn(join(root, entry.name))).length === 1
    ) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/**
 * Builds a Fixture with `dotnet build` and resolves with its Assembly. Builds
 * are cached between runs, keyed by the Fixture's source, the shared build
 * files and the .NET SDK version, so an unchanged Fixture is built only once.
 * Rejects with the build output if the Fixture does not compile.
 */
export function buildFixture(
  name: string,
  options: FixtureOptions = {},
): Promise<BuiltFixture> {
  const root = options.fixturesDirectory ?? FIXTURES_DIRECTORY;
  const cache = options.cacheDirectory ?? join(root, ".cache");
  const key = JSON.stringify([root, cache, name]);
  let build = building.get(key);
  if (build === undefined) {
    build = buildOrReuse(
      name,
      root,
      cache,
      options.dotnetPath ?? "dotnet",
    ).finally(() => building.delete(key));
    building.set(key, build);
  }
  return build;
}

/**
 * Whether a built Fixture is a GUI program (WinForms, WPF): a `WinExe`, which
 * a Round-trip rebuilds and, on Windows, launches, rather than running it
 * over inputs.
 */
export function isGuiFixture(fixture: BuiltFixture): boolean {
  return /^winexe$/i.test(fixture.outputType);
}

/**
 * Restores the NuGet packages a Fixture depends on into the global-packages
 * folder, as building it does, for a test that needs them there (one
 * reconstructing it offline, say) even when the Fixture's build is reused from
 * the cache. What restoring writes beside a project goes to a temporary
 * folder, deleted after, so the source tree stays clean. Rejects with what
 * `dotnet restore` printed if it fails.
 */
export async function restoreFixture(
  name: string,
  options: FixtureOptions = {},
): Promise<void> {
  const root = options.fixturesDirectory ?? FIXTURES_DIRECTORY;
  const project = await fixtureProject(root, name);
  const scratch = await mkdtemp(join(tmpdir(), "xray-restore-"));
  try {
    await run(
      options.dotnetPath ?? "dotnet",
      [
        "restore",
        project,
        `-p:BaseIntermediateOutputPath=${join(scratch, "obj")}${sep}`,
      ],
      {
        env: {
          ...process.env,
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
        },
        timeout: 5 * 60_000,
        windowsHide: true,
      },
    );
  } catch (error) {
    const { stdout = "", stderr = "" } = error as {
      stdout?: string;
      stderr?: string;
    };
    throw new Error(
      `Restoring the Fixture "${name}" failed.\n${stdout}${stderr}`,
      { cause: error },
    );
  } finally {
    await rm(scratch, REMOVE_FOLDER);
  }
}

/**
 * The inputs a console Fixture is run with, from its `inputs.json`; none for a
 * Fixture without one.
 */
export async function readFixtureInputs(
  name: string,
  options: FixtureOptions = {},
): Promise<FixtureInput[]> {
  const root = options.fixturesDirectory ?? FIXTURES_DIRECTORY;
  await fixtureProject(root, name);
  const path = join(root, name, INPUTS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  const inputs: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(inputs) || !inputs.every(isFixtureInput)) {
    throw new Error(
      `${path} must be an array of { "args": string[], "expected": { "stdout": string[], "stderr": string[], "exitCode": number } }.`,
    );
  }
  return inputs;
}

async function buildOrReuse(
  name: string,
  root: string,
  cache: string,
  dotnetPath: string,
): Promise<BuiltFixture> {
  const project = await fixtureProject(root, name);
  // Its real path, as the build reports the Assembly's: Windows may give the
  // temporary folder by its short name (C:\Users\RUNNER~1\…), and macOS
  // through a link (/var is /private/var).
  await mkdir(cache, { recursive: true });
  const fixtureCache = join(await realpath(cache), name);
  const hash = await sourceHash(root, name, await sdkVersion(dotnetPath, root));
  const manifest = join(fixtureCache, `${hash}.json`);

  const cached = await readManifest(name, fixtureCache, manifest);
  if (cached !== undefined) {
    return cached;
  }

  // Build into a folder of our own, so concurrent builds of the same Fixture
  // (from other test workers) never share one, and the source tree stays clean.
  const staging = join(fixtureCache, `${hash}-${nonce()}`);
  await mkdir(fixtureCache, { recursive: true });
  let assemblyPath: string;
  let targetFramework: string;
  let outputType: string;
  try {
    ({ assemblyPath, targetFramework, outputType } = await buildProject(
      dotnetPath,
      project,
      staging,
      name,
    ));
  } catch (error) {
    await rm(staging, REMOVE_FOLDER);
    throw error;
  }
  // Only the output is kept; dropping the intermediates just saves space.
  await rm(join(staging, "obj"), REMOVE_FOLDER).catch(() => undefined);

  // Publish with one atomic step that only the first build of this version
  // wins, so a reader sees no entry or a complete one, and concurrent builds
  // (from other test workers) leave a single copy behind.
  const pending = `${manifest}.${nonce()}.tmp`;
  await writeFile(
    pending,
    JSON.stringify({
      assembly: toPosix(relative(fixtureCache, assemblyPath)),
      targetFramework,
      outputType,
    }),
  );
  try {
    await link(pending, manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const theirs = await readManifest(name, fixtureCache, manifest);
    if (theirs !== undefined) {
      // Best effort: a copy left behind goes when this Fixture next changes.
      await rm(staging, REMOVE_FOLDER).catch(() => undefined);
      return theirs;
    }
    // The entry there points at a build that has since been deleted.
    await rename(pending, manifest);
  } finally {
    await rm(pending, { force: true });
  }

  await pruneStaleBuilds(fixtureCache, hash);
  return built(name, assemblyPath, targetFramework, outputType);
}

async function fixtureProject(root: string, name: string): Promise<string> {
  const fixtures = await listFixtures({ fixturesDirectory: root });
  if (!fixtures.includes(name)) {
    throw new Error(
      `There is no Fixture named "${name}". Fixtures: ${fixtures.join(", ") || "none"}.`,
    );
  }
  const [project] = await projectsIn(join(root, name));
  return join(root, name, project as string);
}

async function projectsIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csproj"))
    .map((entry) => entry.name);
}

async function sdkVersion(dotnetPath: string, root: string): Promise<string> {
  try {
    // From the fixtures folder, so a global.json there would pick the SDK.
    const { stdout } = await run(dotnetPath, ["--version"], {
      cwd: root,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Could not run "${dotnetPath}": building Fixtures needs the .NET SDK 8 or later on PATH.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/** Fingerprints everything that decides what a Fixture builds to. */
async function sourceHash(
  root: string,
  name: string,
  sdk: string,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ format: CACHE_FORMAT, sdk }));

  const shared = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && SHARED_BUILD_FILE.test(entry.name))
    .map((entry) => entry.name);
  const sources = (await filesUnder(join(root, name))).map((file) =>
    join(name, file),
  );
  for (const file of [...shared, ...sources].sort()) {
    hash.update(`\0${toPosix(file)}\0`);
    hash.update(await readFile(join(root, file)));
  }
  // Short, to keep paths under the build output within Windows' MAX_PATH.
  return hash.digest("hex").slice(0, HASH_LENGTH);
}

/** Every file under a folder, relative to it, skipping build output. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
    .filter((file) => !file.split(sep).some((part) => BUILD_OUTPUT.has(part)));
}

async function buildProject(
  dotnetPath: string,
  project: string,
  artifacts: string,
  name: string,
): Promise<{
  assemblyPath: string;
  targetFramework: string;
  outputType: string;
}> {
  const stdout = await dotnetBuild(
    dotnetPath,
    [
      project,
      "--configuration",
      "Release",
      "--artifacts-path",
      artifacts,
      // Build, then print where the Assembly went, what it targets and
      // what kind of program it is.
      "-target:Build",
      "-getProperty:TargetPath",
      "-getProperty:TargetFramework",
      "-getProperty:OutputType",
    ],
    `the Fixture "${name}"`,
  );

  // The properties come last, as JSON, after anything the SDK says first.
  const {
    TargetPath: assemblyPath,
    TargetFramework: targetFramework,
    OutputType: outputType,
  } = builtProperties(stdout.slice(Math.max(0, stdout.search(/^\{/m))));
  if (
    assemblyPath === undefined ||
    targetFramework === undefined ||
    outputType === undefined ||
    !isAbsolute(assemblyPath) ||
    relative(artifacts, assemblyPath).startsWith("..") ||
    !existsSync(assemblyPath)
  ) {
    throw new Error(
      `Building the Fixture "${name}" did not report the Assembly it built.\n${stdout}`,
    );
  }
  return { assemblyPath, targetFramework, outputType };
}

/** The properties `dotnet build -getProperty:…` printed, each one a string. */
function builtProperties(json: string): Record<string, string | undefined> {
  let properties: unknown;
  try {
    ({ Properties: properties } = JSON.parse(json) as {
      Properties?: unknown;
    });
  } catch {
    return {};
  }
  if (typeof properties !== "object" || properties === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function readManifest(
  name: string,
  fixtureCache: string,
  manifest: string,
): Promise<BuiltFixture | undefined> {
  let assembly: unknown;
  let targetFramework: unknown;
  let outputType: unknown;
  try {
    ({ assembly, targetFramework, outputType } = JSON.parse(
      await readFile(manifest, "utf8"),
    ) as {
      assembly?: unknown;
      targetFramework?: unknown;
      outputType?: unknown;
    });
  } catch {
    return undefined;
  }
  if (
    typeof assembly !== "string" ||
    typeof targetFramework !== "string" ||
    typeof outputType !== "string"
  ) {
    return undefined;
  }
  const assemblyPath = join(fixtureCache, assembly);
  return existsSync(assemblyPath)
    ? built(name, assemblyPath, targetFramework, outputType)
    : undefined;
}

/** Removes builds of earlier versions of the Fixture. */
async function pruneStaleBuilds(
  fixtureCache: string,
  hash: string,
): Promise<void> {
  const stale = (await readdir(fixtureCache)).filter(
    (entry) => !entry.startsWith(hash),
  );
  await Promise.all(
    stale.map((entry) =>
      // Best effort: a file another process still holds open stays until next time.
      rm(join(fixtureCache, entry), REMOVE_FOLDER).catch(() => undefined),
    ),
  );
}

function built(
  name: string,
  assemblyPath: string,
  targetFramework: string,
  outputType: string,
): BuiltFixture {
  return {
    name,
    assemblyPath,
    targetFramework,
    outputType,
    outputDirectory: dirname(assemblyPath),
  };
}

function nonce(): string {
  return randomBytes(4).toString("hex");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isFixtureInput(value: unknown): value is FixtureInput {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { args, expected } = value as Record<string, unknown>;
  if (typeof expected !== "object" || expected === null) {
    return false;
  }
  const { stdout, stderr, exitCode } = expected as Record<string, unknown>;
  return (
    isStrings(args) &&
    isStrings(stdout) &&
    isStrings(stderr) &&
    Number.isInteger(exitCode)
  );
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
