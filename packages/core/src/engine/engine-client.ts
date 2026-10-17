import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { EngineError } from "./engine-error.js";
import {
  ENGINE_PROTOCOL_VERSION,
  asEngineInfo,
  asEngineProgressLine,
  asEngineResponse,
  type EngineInfo,
  type EngineProgress,
  type EngineRequest,
} from "./protocol.js";

export interface EngineOptions {
  /** The `dotnet` host that runs the engine. Defaults to `dotnet` on PATH. */
  readonly dotnetPath?: string;
  /** The engine DLL. Defaults to {@link defaultEnginePath}. */
  readonly enginePath?: string;
  /**
   * How long to wait for the engine to answer a request (the handshake
   * included), and for it to exit once stopped before it is killed.
   */
  readonly timeoutMs?: number;
}

/** How the engine process ended. */
export interface EngineExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const STDERR_TAIL_LENGTH = 4_000;

// hostfxr's wording when the runtime the engine targets (or any runtime) is
// absent. The exit code differs by OS, so match the message instead.
const MISSING_RUNTIME =
  /You must install (or update )?\.NET|host[\\/]fxr|hostfxr/i;

/**
 * The Release build of the engine in this repository's `engine/` folder
 * (`pnpm build:engine`).
 */
export function defaultEnginePath(): string {
  return fileURLToPath(
    new URL(
      "../../../../engine/Xray.Engine/bin/Release/net8.0/Xray.Engine.dll",
      import.meta.url,
    ),
  );
}

/**
 * Spawns the engine sidecar and completes the handshake. Rejects with an
 * {@link EngineError} if the engine cannot be started, speaks another protocol
 * version, or exits or stalls before answering; the process is not left behind.
 */
export function startEngine(
  options: EngineOptions = {},
): Promise<EngineClient> {
  return EngineClient.start(options);
}

export interface RequestOptions {
  /** How long to wait for the answer; defaults to the client's timeout. */
  readonly timeoutMs?: number;
  /** Told of each progress line the engine sends before it answers. */
  readonly onProgress?: (progress: EngineProgress) => void;
}

interface Pending {
  readonly command: string;
  readonly onProgress: ((progress: EngineProgress) => void) | undefined;
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: EngineError) => void;
  readonly timer: NodeJS.Timeout;
}

/** A running engine sidecar. Obtain one with {@link startEngine}; always {@link stop} it. */
export class EngineClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #dotnetPath: string;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, Pending>();
  readonly #exited: Promise<EngineExit>;
  #nextId = 1;
  #stderr = "";
  #info: EngineInfo | undefined;
  /** Set once the engine can no longer answer; every later request rejects with it. */
  #failure: EngineError | undefined;

  /** Use {@link startEngine}. */
  static async start(options: EngineOptions): Promise<EngineClient> {
    const dotnetPath = options.dotnetPath ?? "dotnet";
    const enginePath = options.enginePath ?? defaultEnginePath();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!existsSync(enginePath)) {
      throw new EngineError(
        "engine-not-found",
        `The Xray engine was not found at ${enginePath}. Build it with \`pnpm build:engine\`.`,
      );
    }

    const child = spawn(dotnetPath, [enginePath], {
      stdio: "pipe",
      windowsHide: true,
    });
    const client = new EngineClient(child, dotnetPath, timeoutMs);
    try {
      await client.#handshake();
    } catch (error) {
      await client.stop();
      throw error;
    }
    return client;
  }

  private constructor(
    child: ChildProcessWithoutNullStreams,
    dotnetPath: string,
    timeoutMs: number,
  ) {
    this.#child = child;
    this.#dotnetPath = dotnetPath;
    this.#timeoutMs = timeoutMs;

    this.#exited = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        this.#fail(this.#exitError(code, signal));
        resolve({ code, signal });
      });
      // A process that never started emits "error" and may never emit "close".
      child.once("error", (error) => {
        this.#fail(this.#spawnError(error));
        if (child.pid === undefined) {
          resolve({ code: null, signal: null });
        }
      });
    });

    // Writes after the engine has gone fail with EPIPE; the exit handler reports why.
    child.stdin.on("error", () => undefined);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL_LENGTH);
    });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
      "line",
      (line) => this.#receive(line),
    );
  }

  /** What the engine reported in the handshake. */
  get info(): EngineInfo {
    if (this.#info === undefined) {
      throw new Error("The engine has not completed its handshake.");
    }
    return this.#info;
  }

  /** The engine's process ID, while it is running. */
  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** Checks the engine is alive and answering. */
  async ping(): Promise<void> {
    await this.request("ping");
  }

  /**
   * Sends one command and resolves with the engine's `result`. Requests may be
   * in flight concurrently; responses are matched to them by `id`. A command
   * that takes long, such as decompiling a whole Assembly, can be given longer
   * than the client's timeout, and may report its progress on the way.
   */
  request(
    command: string,
    params: object = {},
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure);
    }
    const id = this.#nextId++;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new EngineError(
            "timeout",
            `The Xray engine did not answer "${command}" within ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        command,
        onProgress: options.onProgress,
        resolve,
        reject,
        timer,
      });
      const request: EngineRequest = { id, command, params };
      this.#child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  /**
   * Shuts the engine down by closing its stdin, killing it if it has not exited
   * within the timeout, or, with `kill`, at once, whatever it is doing.
   * Requests still in flight reject with code `stopped`. Safe to call more
   * than once.
   */
  async stop({
    kill = false,
  }: { readonly kill?: boolean } = {}): Promise<EngineExit> {
    this.#fail(
      new EngineError(
        "stopped",
        "The Xray engine was stopped before it answered.",
      ),
    );
    this.#child.stdin.end();
    if (kill) {
      this.#child.kill("SIGKILL");
    }
    const killLater = setTimeout(
      () => this.#child.kill("SIGKILL"),
      this.#timeoutMs,
    );
    try {
      return await this.#exited;
    } finally {
      clearTimeout(killLater);
    }
  }

  async #handshake(): Promise<void> {
    let result: Record<string, unknown>;
    try {
      result = await this.request("handshake", {
        protocolVersion: ENGINE_PROTOCOL_VERSION,
      });
    } catch (error) {
      if (
        error instanceof EngineError &&
        error.engineCode === "protocol-mismatch"
      ) {
        throw mismatch(error.message, error.engineCode);
      }
      throw error;
    }

    const info = asEngineInfo(result);
    if (info === undefined) {
      throw this.#violation(
        `The Xray engine's handshake was malformed: ${JSON.stringify(result)}`,
      );
    }
    if (info.protocolVersion !== ENGINE_PROTOCOL_VERSION) {
      throw mismatch(
        `The Xray engine speaks protocol version ${info.protocolVersion} but Xray expects version ${ENGINE_PROTOCOL_VERSION}.`,
      );
    }
    this.#info = info;
  }

  #receive(line: string): void {
    if (line.trim() === "") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.#violation(`The Xray engine wrote a line that is not JSON: ${line}`);
      return;
    }
    const progress = asEngineProgressLine(parsed);
    if (progress !== undefined) {
      // As for a response, nobody is waiting on a request that timed out.
      this.#pending.get(progress.id)?.onProgress?.(progress.progress);
      return;
    }
    const response = asEngineResponse(parsed);
    if (response === undefined) {
      this.#violation(
        `The Xray engine wrote a line that is not a protocol response: ${line}`,
      );
      return;
    }
    if (response.id === null) {
      // The engine could not read a request well enough to find its id.
      this.#violation(`The Xray engine rejected a request: ${line}`);
      return;
    }

    // A response whose request already timed out has nobody waiting for it.
    const pending = this.#pending.get(response.id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);

    if ("result" in response) {
      pending.resolve(response.result);
    } else {
      pending.reject(
        new EngineError(
          "request-failed",
          `The Xray engine could not run "${pending.command}": ${response.error.message}`,
          { engineCode: response.error.code },
        ),
      );
    }
  }

  /** Records the first reason the engine became unusable and rejects everything waiting on it. */
  #fail(error: EngineError): void {
    if (this.#failure !== undefined) {
      return;
    }
    this.#failure = error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  /** The engine broke the protocol, so nothing more it says can be trusted: stop it. */
  #violation(message: string): EngineError {
    const error = new EngineError("protocol-violation", message);
    this.#fail(error);
    this.#child.kill("SIGKILL");
    return error;
  }

  #exitError(code: number | null, signal: NodeJS.Signals | null): EngineError {
    const stderr = this.#stderr.trim();
    if (MISSING_RUNTIME.test(stderr)) {
      return new EngineError(
        "runtime-not-found",
        `The .NET runtime the Xray engine needs is not installed. Install the .NET SDK 8 or later from https://dot.net.\n\n${stderr}`,
        { stderr },
      );
    }
    const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
    return new EngineError(
      "engine-exited",
      `The Xray engine exited unexpectedly (${how}).${stderr === "" ? "" : `\n\n${stderr}`}`,
      { stderr },
    );
  }

  #spawnError(error: NodeJS.ErrnoException): EngineError {
    if (error.code === "ENOENT") {
      return new EngineError(
        "runtime-not-found",
        `Could not run "${this.#dotnetPath}": .NET was not found. Install the .NET SDK 8 or later from https://dot.net and make sure \`dotnet\` is on PATH.`,
        { cause: error },
      );
    }
    return new EngineError(
      "engine-exited",
      `Could not start the Xray engine with "${this.#dotnetPath}": ${error.message}`,
      { cause: error },
    );
  }
}

function mismatch(detail: string, engineCode?: string): EngineError {
  return new EngineError(
    "protocol-mismatch",
    `${detail} Xray and its engine come from different builds; rebuild the engine with \`pnpm build:engine\`.`,
    engineCode === undefined ? {} : { engineCode },
  );
}
