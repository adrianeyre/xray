import { parseArgs } from "node:util";

import {
  inspectAssembly,
  reconstruct,
  runDoctor,
  toInspectJson,
  toXrayReport,
  type DoctorReport,
  type EngineOptions,
  type Inspection,
  type ProgressListener,
  type Reconstruction,
} from "@xray/core";
import { DEFAULT_PORT, startServer, type XrayServer } from "@xray/server";

import { formatDoctorReport } from "./format-doctor-report.js";
import { formatInspectSummary } from "./format-inspect-summary.js";
import { progressDisplay } from "./format-progress.js";
import { formatReconstruction } from "./format-reconstruction.js";
import {
  listenForStop,
  openBrowser,
  type BrowserLaunch,
  type StopRequest,
} from "./ui.js";

export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /**
   * How many columns wide the terminal `stderr` writes to is; `undefined`, or
   * absent, when it is not a terminal, so progress is shown in plain lines.
   */
  readonly stderrColumns?: () => number | undefined;
}

/** What each command does, from @xray/core; replaced in tests. */
export interface Commands {
  readonly inspect: (path: string) => Promise<Inspection>;
  readonly reconstruct: (
    path: string,
    outputDirectory: string,
    options: ReconstructCommandOptions,
  ) => Promise<Reconstruction>;
  readonly doctor: () => Promise<DoctorReport>;
  /** Starts `xray ui`'s server, from @xray/server. */
  readonly ui: (port: number) => Promise<XrayServer>;
  readonly openBrowser: (url: string) => Promise<BrowserLaunch>;
  /** Listens for the signals that stop `xray ui`. */
  readonly listenForStop: () => StopRequest;
}

export interface ReconstructCommandOptions {
  readonly force: boolean;
  readonly build: boolean;
  readonly run: boolean;
  readonly siblings: boolean;
  readonly offline: boolean;
  readonly onProgress: ProgressListener;
}

export const ExitCode = {
  ok: 0,
  /** A check failed, or the command could not finish. */
  failed: 1,
  /** The command line could not be understood. */
  usage: 2,
  /** The input is not a Managed Assembly, so it cannot be reconstructed. */
  rejected: 3,
  /**
   * A Partial Reconstruction: the Recovered Solution was written but has an
   * Unresolved Dependency, or did not build, or, with --run, its program did
   * not run to an exit.
   */
  partial: 4,
} as const;

export const USAGE = `Usage: xray <command>

Commands:
  inspect <assembly> [--json]
                        Summarize a Managed Assembly's metadata: name, version, target
                        framework, architecture, entry point, output kind, references,
                        how many types, methods and resources it defines, the PDB beside
                        it, and any sign of obfuscation.
  reconstruct <assembly|folder> -o <dir> [--force] [--no-build] [--run] [--no-siblings] [--offline]
                        Decompile a Managed Assembly into a Recovered Solution in <dir>:
                        <Name>.sln and an SDK-style <Name>/<Name>.csproj for its original
                        target framework, with one C# file per type, in a folder per
                        namespace, or laid out as the original's source files were when
                        its own PDB is beside it. Its resources are recovered, as .resx
                        or as they are; Windows Forms and WPF apps, their BAML decompiled
                        to XAML, build on any OS. An obfuscated Assembly is reconstructed
                        as it is, never deobfuscated, and flagged. Each assembly it
                        references that a NuGet package holds, found in the
                        global-packages cache or on nuget.org, becomes a PackageReference.
                        Each Sibling Assembly it references, found beside it, becomes a
                        project of its own in the solution, wired with ProjectReference.
                        Any other Assembly beside it that it references, such as a third
                        party's, is copied into <dir>/Dependencies and referenced with a
                        HintPath; a reference nothing satisfies is an Unresolved
                        Dependency, which makes the Reconstruction Partial. Given a
                        folder, it reconstructs the application's Assembly in it. Then
                        build it with \`dotnet build\`: a Full Reconstruction if it builds,
                        a Partial one, listing its build errors at their files and lines,
                        if not.
                        Each stage's progress is shown on stderr as it runs. Every
                        Reconstruction writes <dir>/xray-report.json, in the
                        documented schema (docs/reference/xray-report-json.md), and
                        prints a summary of it: outcome, timings and top errors.
                        With --run, the rebuilt program is then run, executing
                        recovered code.
  doctor                Check this machine can run Xray: Node.js, the .NET SDK and the engine.
  ui [--port <n>]       Start Xray's web UI on http://127.0.0.1:<n>/ and open it in your
                        browser (not when the BROWSER environment variable is "none").
                        There, drop or choose an Assembly or a folder to upload, or give
                        an Assembly's path, and follow its Reconstruction live, stage by
                        stage. Only this machine can reach it. Uploads and outputs are
                        kept in a temporary Workspace, deleted when it stops: press Ctrl+C.

Options:
  --json        For inspect: print the summary as JSON, in the documented schema
                (docs/reference/xray-inspect-json.md).
  -o, --output <dir>
                For reconstruct: the folder to write the Recovered Solution to. It
                must be empty or not exist yet, unless --force is given.
  --force       For reconstruct: replace whatever the output folder holds.
  --port <n>    For ui: the port to listen on, ${DEFAULT_PORT} if not given; 0 for any free one.
  --no-build    For reconstruct: do not build the Recovered Solution, leaving it
                unverified: neither a Full nor a Partial Reconstruction.
  --no-siblings For reconstruct: do not reconstruct Sibling Assemblies; copy each
                Assembly beside it that a reference no NuGet package holds names
                into <dir>/Dependencies, and reference it with a HintPath, instead.
  --offline     For reconstruct: make no network calls. NuGet packages are looked for
                only in the global-packages cache, not on nuget.org, and \`dotnet build\`
                restores packages only from that cache. Without it, only package
                names and versions are sent to nuget.org; never a file.
  --run         For reconstruct: once the Recovered Solution builds, run its program,
                with no arguments or input, and record its exit code and output in
                xray-report.json. This EXECUTES RECOVERED CODE on this machine, as
                you: use it only on Assemblies you trust. Skipped, saying why, where
                the program cannot run: a library; WinForms, WPF or .NET Framework
                anywhere but Windows. A console program is stopped after 60 s; a GUI
                one is closed once it has run for 5 s.
  -h, --help    Show this help.

Exit codes:
  0    Success: for reconstruct, a Full Reconstruction (the Recovered Solution built),
       or, with --no-build, a Recovered Solution written but not verified; for ui,
       stopped with Ctrl+C.
  1    A check failed, or the command could not finish: for ui, it could not start,
       as its port is in use or the web app has not been built.
  2    The command line could not be understood.
  3    The input is not a Managed Assembly (a Native Executable, or not a PE file).
  4    A Partial Reconstruction: the Recovered Solution was written but has an
       Unresolved Dependency, or did not build, or, with --run, its program crashed,
       did not exit in time, or could not start.
`;

/** Said on stderr before a Reconstruction asked to run its program starts (PRD §8). */
export const RUN_WARNING =
  "Warning: --run executes recovered code. Once the Recovered Solution builds, its program runs on this machine, as you.\n";

/** This process's own stdout and stderr. */
export const processIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stderrColumns: () =>
    process.stderr.isTTY ? process.stderr.columns : undefined,
};

/** Where {@link coreCommands} find the engine and the web app. */
export interface CommandLocations {
  /** How to run the engine. Its path is this repository's build of it if absent. */
  readonly engine?: EngineOptions;
  /** The built web app `xray ui` serves. @xray/web's `dist/` if absent. */
  readonly webRoot?: string;
}

/**
 * Each command as @xray/core and @xray/server do it, with the engine and web
 * app found where `locations` says: this repository's builds of them unless
 * told otherwise, as the published package does with the ones it bundles.
 */
export function coreCommands(locations: CommandLocations = {}): Commands {
  const { engine = {}, webRoot } = locations;
  return {
    inspect: (path) => inspectAssembly(path, engine),
    reconstruct: (path, outputDirectory, options) =>
      reconstruct(path, outputDirectory, { ...engine, ...options }),
    doctor: () => runDoctor(engine),
    ui: (port) =>
      startServer({
        port,
        ...(webRoot === undefined ? {} : { webRoot }),
        reconstruct: (path, outputDirectory, options) =>
          reconstruct(path, outputDirectory, { ...engine, ...options }),
      }),
    openBrowser: (url) => openBrowser(url),
    listenForStop: () => listenForStop(),
  };
}

/** Runs `xray` with `argv` (the arguments after `xray`) and resolves its exit code. */
export async function main(
  argv: readonly string[],
  io: Io = processIo,
  commands: Commands = coreCommands(),
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        output: { type: "string", short: "o" },
        force: { type: "boolean" },
        "no-build": { type: "boolean" },
        "no-siblings": { type: "boolean" },
        offline: { type: "boolean" },
        run: { type: "boolean" },
        port: { type: "string" },
      },
    });
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  const { values, positionals } = parsed;
  const [command, ...extra] = positionals;

  if (values.help === true || command === "help") {
    io.stdout(USAGE);
    return ExitCode.ok;
  }
  if (command === undefined) {
    return usageError(io, "No command given.");
  }
  const json = values.json === true;
  if (json && command !== "inspect") {
    return usageError(io, `"xray ${command}" does not take --json.`);
  }
  const force = values.force === true;
  const build = values["no-build"] !== true;
  const runProgram = values.run === true;
  const siblings = values["no-siblings"] !== true;
  const offline = values.offline === true;
  if (command !== "reconstruct") {
    if (values.output !== undefined) {
      return usageError(io, `"xray ${command}" does not take --output.`);
    }
    if (force) {
      return usageError(io, `"xray ${command}" does not take --force.`);
    }
    if (!build) {
      return usageError(io, `"xray ${command}" does not take --no-build.`);
    }
    if (runProgram) {
      return usageError(io, `"xray ${command}" does not take --run.`);
    }
    if (!siblings) {
      return usageError(io, `"xray ${command}" does not take --no-siblings.`);
    }
    if (offline) {
      return usageError(io, `"xray ${command}" does not take --offline.`);
    }
  }
  if (command !== "ui" && values.port !== undefined) {
    return usageError(io, `"xray ${command}" does not take --port.`);
  }

  switch (command) {
    case "inspect":
      if (extra.length !== 1) {
        return usageError(
          io,
          `"xray inspect" takes one Assembly, but was given ${extra.length === 0 ? "none" : extra.join(" ")}.`,
        );
      }
      return inspect(io, commands, extra[0] as string, json);
    case "reconstruct":
      if (extra.length !== 1) {
        return usageError(
          io,
          `"xray reconstruct" takes one Assembly or folder, but was given ${extra.length === 0 ? "none" : extra.join(" ")}.`,
        );
      }
      if (values.output === undefined || values.output === "") {
        return usageError(
          io,
          '"xray reconstruct" needs -o <dir>: the folder to write the Recovered Solution to.',
        );
      }
      if (runProgram && !build) {
        return usageError(
          io,
          "--run runs the program the Recovered Solution builds to, so it cannot be given with --no-build.",
        );
      }
      return reconstructCommand(
        io,
        commands,
        extra[0] as string,
        values.output,
        { force, build, run: runProgram, siblings, offline },
      );
    case "doctor":
      if (extra.length > 0) {
        return usageError(
          io,
          `"xray doctor" takes no arguments, but was given: ${extra.join(" ")}`,
        );
      }
      return doctor(io, commands);
    case "ui": {
      if (extra.length > 0) {
        return usageError(
          io,
          `"xray ui" takes no arguments, but was given: ${extra.join(" ")}`,
        );
      }
      const port =
        values.port === undefined ? DEFAULT_PORT : parsePort(values.port);
      if (port === undefined) {
        return usageError(
          io,
          `--port takes a port number from 0 to 65535, but was given "${values.port}".`,
        );
      }
      return ui(io, commands, port);
    }
    default:
      return usageError(io, `Unknown command "${command}".`);
  }
}

async function inspect(
  io: Io,
  commands: Commands,
  path: string,
  json: boolean,
): Promise<number> {
  let inspection;
  try {
    inspection = await commands.inspect(path);
  } catch (error) {
    // InputError and EngineError messages already say what went wrong.
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.failed;
  }
  // Rejected the same way with --json: nothing on stdout, and exit code 3.
  if (!inspection.accepted) {
    io.stderr(`${inspection.classification.explanation}\n`);
    return ExitCode.rejected;
  }
  io.stdout(
    json
      ? `${JSON.stringify(toInspectJson(inspection.summary), null, 2)}\n`
      : formatInspectSummary(inspection.summary),
  );
  return ExitCode.ok;
}

async function reconstructCommand(
  io: Io,
  commands: Commands,
  path: string,
  outputDirectory: string,
  options: {
    readonly force: boolean;
    readonly build: boolean;
    readonly run: boolean;
    readonly siblings: boolean;
    readonly offline: boolean;
  },
): Promise<number> {
  if (options.run) {
    io.stderr(RUN_WARNING);
  }
  let reconstruction;
  try {
    reconstruction = await commands.reconstruct(path, outputDirectory, {
      ...options,
      onProgress: progressDisplay(
        io.stderr,
        io.stderrColumns ?? (() => undefined),
      ),
    });
  } catch (error) {
    // ReconstructionError, InputError and EngineError messages already say what went wrong.
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.failed;
  }
  if (!reconstruction.accepted) {
    io.stderr(`${reconstruction.classification.explanation}\n`);
    return ExitCode.rejected;
  }
  // The summary of the very report written into the Recovered Solution.
  const { solution } = reconstruction;
  const report = toXrayReport(reconstruction);
  // Such as a PDB beside an Assembly that was ignored, being another build's.
  for (const { message } of report.warnings) {
    io.stderr(`Warning: ${message}\n`);
  }
  io.stdout(
    formatReconstruction(solution.directory, report, solution.reportPath),
  );
  const { build, outcome, reasons } = report;
  if (outcome !== "partial") {
    return ExitCode.ok;
  }
  // A build that failed without an error Xray could pick out: show why it did.
  if (
    build !== null &&
    reasons.some(
      (reason) => reason.kind === "build-failed" && reason.errors.length === 0,
    )
  ) {
    io.stderr(build.output.endsWith("\n") ? build.output : `${build.output}\n`);
  }
  return ExitCode.partial;
}

async function doctor(io: Io, commands: Commands): Promise<number> {
  const report = await commands.doctor();
  io.stdout(formatDoctorReport(report));
  return report.passed ? ExitCode.ok : ExitCode.failed;
}

async function ui(io: Io, commands: Commands, port: number): Promise<number> {
  // Listening before the server starts, so Ctrl+C at any point after it has
  // made its Workspace stops it and deletes that, rather than ending Xray.
  const stop = commands.listenForStop();
  try {
    let server;
    try {
      server = await commands.ui(port);
    } catch (error) {
      // ServerError messages already say what went wrong, and what to do.
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return ExitCode.failed;
    }
    io.stdout(
      `Xray is running at ${server.url}\n` +
        `Only this machine can reach it. Workspace: ${server.workspace}\n` +
        "Press Ctrl+C to stop Xray and delete its Workspace.\n",
    );
    if ((await commands.openBrowser(server.url)) === "failed") {
      io.stderr(
        `Could not open a browser. Open ${server.url} in one yourself.\n`,
      );
    }
    await stop.stopped;
    io.stdout("Stopping Xray...\n");
    try {
      await server.close();
    } catch (error) {
      io.stderr(
        `Could not delete Xray's Workspace, ${server.workspace}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return ExitCode.failed;
    }
    io.stdout("Xray has stopped, and its Workspace is deleted.\n");
    return ExitCode.ok;
  } finally {
    stop.dispose();
  }
}

/** `text` as a TCP port number, or `undefined` if it is not one. */
function parsePort(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) {
    return undefined;
  }
  const port = Number(text);
  return port <= 65_535 ? port : undefined;
}

function usageError(io: Io, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`);
  return ExitCode.usage;
}
