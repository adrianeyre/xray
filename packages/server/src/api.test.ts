import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InputError,
  type AssemblySummary,
  type ProgressEvent,
  type Reconstruction,
  type ReconstructOptions,
} from "@xray/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkPath, RECONNECT_MS } from "./api.js";
import type { Reconstruct } from "./reconstructions.js";
import { startServer, type XrayServer } from "./server.js";
import {
  openStream,
  send,
  startReconstruction,
  type EventStream,
} from "./test-client.js";

// The server, running Reconstructions this test drives by hand; the real ones
// are in api.engine.test.ts.

/** A Reconstruction the server started, run by the test. */
interface FakeRun {
  readonly path: string;
  readonly outputDirectory: string;
  readonly options: ReconstructOptions;
  readonly emit: (event: ProgressEvent) => void;
  readonly inspected: (summary: AssemblySummary) => void;
  readonly finish: (reconstruction: Reconstruction) => void;
  readonly fail: (error: unknown) => void;
}

let temporaryRoot: string;
let runs: FakeRun[];
const servers: XrayServer[] = [];
const streams: EventStream[] = [];

const fakeReconstruct: Reconstruct = (path, outputDirectory, options) =>
  new Promise((resolve, reject) => {
    runs.push({
      path,
      outputDirectory,
      options,
      emit: (event) => options.onProgress?.(event),
      inspected: (summary) => options.onInspected?.(summary),
      finish: resolve,
      fail: reject,
    });
  });

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "xray-server-test-"));
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    vi.stubEnv(name, temporaryRoot);
  }
  runs = [];
});

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.drop();
  }
  for (const run of runs) {
    run.fail(new Error("The test is over."));
  }
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function start(reconstruct = fakeReconstruct): Promise<XrayServer> {
  const server = await startServer({ port: 0, reconstruct });
  servers.push(server);
  return server;
}

async function open(
  server: XrayServer,
  path: string,
  lastEventId?: string,
): Promise<EventStream> {
  const stream = await openStream(server.port, path, lastEventId);
  streams.push(stream);
  return stream;
}

/** Starts a Reconstruction of `path`, which must be accepted, and resolves where its events are. */
async function started(server: XrayServer, path: string): Promise<string> {
  const response = await startReconstruction(server.port, path);
  expect(response.status).toBe(202);
  return (response.body as { events: string }).events;
}

const ASSEMBLY =
  process.platform === "win32" ? "C:\\Apps\\App.dll" : "/apps/App.dll";

const analysing: ProgressEvent = {
  kind: "stage-started",
  stage: "analyse",
  elapsedMs: 0,
};
const analysed: ProgressEvent = {
  kind: "stage-finished",
  stage: "analyse",
  elapsedMs: 90,
  durationMs: 90,
};
const decompiling: ProgressEvent = {
  kind: "stage-started",
  stage: "decompile",
  elapsedMs: 90,
};
const progressing = (done: number): ProgressEvent => ({
  kind: "stage-progress",
  stage: "decompile",
  elapsedMs: 90 + 250 * (done + 1),
  done,
  total: 5,
  current: `App.Type${done}`,
});

const rejected: Reconstruction = {
  accepted: false,
  classification: {
    path: ASSEMBLY,
    kind: "native-executable",
    accepted: false,
    explanation:
      "App.dll is a Native Executable (x64), not a Managed Assembly.",
  },
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("POST /api/reconstructions", () => {
  it("starts reconstructing the Assembly at the path given into a folder of its own in the Workspace", async () => {
    const server = await start();

    const response = await startReconstruction(server.port, ASSEMBLY);

    expect(response.status).toBe(202);
    const { id, path, events } = response.body as Record<string, string>;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(path).toBe(ASSEMBLY);
    expect(events).toBe(`/api/reconstructions/${id}/events`);
    expect(response.headers.location).toBe(events);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.path).toBe(ASSEMBLY);
    expect(runs[0]?.outputDirectory).toBe(
      join(server.workspace, "reconstructions", id ?? ""),
    );
    // It is built, but its program is not run: that executes recovered code.
    expect(runs[0]?.options.build).toBeUndefined();
    expect(runs[0]?.options.run).toBeUndefined();
    // Its Sibling Assemblies are reconstructed with it, unless asked not to be.
    expect(runs[0]?.options.siblings).toBe(true);
  });

  it("reconstructs it without its Sibling Assemblies when asked not to", async () => {
    const server = await start();

    const response = await send(
      server.port,
      "POST",
      "/api/reconstructions",
      JSON.stringify({ path: ASSEMBLY, siblings: false }),
    );

    expect(response.status).toBe(202);
    expect(runs.map(({ options }) => options.siblings)).toEqual([false]);
  });

  it("takes the path without the whitespace or quotes copying it may bring", () => {
    expect(checkPath(`  ${ASSEMBLY}\n`)).toBe(ASSEMBLY);
    expect(checkPath(`"${ASSEMBLY}"`)).toBe(ASSEMBLY);
    expect(checkPath(` " ${ASSEMBLY} " `)).toBe(ASSEMBLY);
  });

  it.each([
    [
      { path: "" },
      "Enter the path of an Assembly, or of a folder holding one, to reconstruct.",
    ],
    [
      { path: '  ""  ' },
      "Enter the path of an Assembly, or of a folder holding one, to reconstruct.",
    ],
    [{}, 'Send the Assembly\'s path as JSON: {"path": "…"}.'],
    [{ path: 42 }, 'Send the Assembly\'s path as JSON: {"path": "…"}.'],
    [
      { path: ASSEMBLY, siblings: "no" },
      'Say whether to reconstruct Sibling Assemblies as true or false: {"siblings": false}.',
    ],
  ])(
    "refuses %j, saying what to send instead, and starts nothing",
    async (body, message) => {
      const server = await start();

      const response = await send(
        server.port,
        "POST",
        "/api/reconstructions",
        JSON.stringify(body),
      );

      expect(response).toMatchObject({ status: 400, body: { message } });
      expect(runs).toEqual([]);
    },
  );

  it("refuses a path that is not a full one, since what it would be relative to is not the user's to see", async () => {
    const server = await start();

    const response = await startReconstruction(server.port, "bin/App.dll");

    expect(response.status).toBe(400);
    expect((response.body as { message: string }).message).toMatch(
      /^"bin\/App\.dll" is not a full path\. Enter the Assembly's full path, from the root of its /,
    );
    expect(runs).toEqual([]);
  });

  it("refuses a body that is not JSON, which a page on another host could send without asking", async () => {
    const server = await start();

    const response = await send(
      server.port,
      "POST",
      "/api/reconstructions",
      ASSEMBLY,
      { "content-type": "text/plain" },
    );

    expect(response).toMatchObject({
      status: 415,
      body: { message: 'Send the Assembly\'s path as JSON: {"path": "…"}.' },
    });
    expect(runs).toEqual([]);
  });

  it("refuses a request from a page another host served, so no other site can start one", async () => {
    const server = await start();

    for (const origin of [
      "http://evil.example",
      `http://127.0.0.1.nip.io:${server.port}`,
      "null",
    ]) {
      const response = await send(
        server.port,
        "POST",
        "/api/reconstructions",
        JSON.stringify({ path: ASSEMBLY }),
        { origin },
      );
      expect(response, origin).toMatchObject({
        status: 403,
        body: {
          message: `Xray only answers pages it served itself, at ${server.url}.`,
        },
      });
    }
    expect(runs).toEqual([]);

    for (const origin of [
      `http://localhost:${server.port}`,
      server.url.slice(0, -1),
    ]) {
      const response = await send(
        server.port,
        "POST",
        "/api/reconstructions",
        JSON.stringify({ path: ASSEMBLY }),
        { origin },
      );
      expect(response.status, origin).toBe(202);
    }
  });
});

describe("GET /api/reconstructions/<id>/events", () => {
  it("streams the Reconstruction as Server-Sent Events: started, each progress event unchanged, then how it ended", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);

    const stream = await open(server, events);
    runs[0]?.emit(analysing);
    runs[0]?.emit(analysed);
    runs[0]?.finish(rejected);
    await stream.ended;

    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(stream.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(stream.retry()).toBe(RECONNECT_MS);
    expect(stream.events).toEqual([
      { id: "0", type: "started", data: { path: ASSEMBLY } },
      { id: "1", type: "progress", data: analysing },
      { id: "2", type: "progress", data: analysed },
      {
        id: "3",
        type: "ended",
        data: {
          kind: "rejected",
          inputKind: "native-executable",
          explanation:
            "App.dll is a Native Executable (x64), not a Managed Assembly.",
        },
      },
    ]);
  });

  it("sends the Assembly's metadata summary, as xray inspect --json prints it, once analyse has read it", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);
    const summary: AssemblySummary = {
      path: ASSEMBLY,
      assembly: {
        name: "App",
        version: "1.0.0.0",
        culture: null,
        publicKeyToken: null,
      },
      targetFramework: {
        moniker: "net8.0",
        frameworkName: ".NETCoreApp,Version=v8.0",
        runtimeVersion: "v4.0.30319",
        inferredFrom: null,
        support: "full",
      },
      architecture: {
        platformTarget: "AnyCPU",
        prefer32Bit: false,
        bitness: "any",
        machine: "I386",
      },
      entryPoint: { type: "App.Program", method: "Main" },
      outputKind: "console",
      references: [],
      counts: { types: 1, methods: 2, resources: 0 },
      pdb: { status: "none" },
      obfuscation: { status: "clean", indicators: [] },
    };

    const stream = await open(server, events);
    runs[0]?.emit(analysing);
    runs[0]?.inspected(summary);
    runs[0]?.emit(analysed);
    runs[0]?.fail(new Error("Stopped."));
    await stream.ended;

    expect(stream.events.slice(1, 4)).toEqual([
      { id: "1", type: "progress", data: analysing },
      {
        id: "2",
        type: "inspected",
        data: { schemaVersion: 1, ...summary },
      },
      { id: "3", type: "progress", data: analysed },
    ]);
  });

  it("ends with what went wrong, and its code, when the Reconstruction fails", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);
    const stream = await open(server, events);

    runs[0]?.emit(analysing);
    runs[0]?.emit({
      kind: "stage-failed",
      stage: "analyse",
      elapsedMs: 30,
      durationMs: 30,
      message: `There is no file at ${ASSEMBLY}.`,
    });
    runs[0]?.fail(
      new InputError("not-found", `There is no file at ${ASSEMBLY}.`),
    );
    await stream.ended;

    expect(stream.events.at(-1)).toEqual({
      id: "3",
      type: "ended",
      data: {
        kind: "failed",
        code: "not-found",
        message: `There is no file at ${ASSEMBLY}.`,
      },
    });
  });

  it("sends a browser that connects again only the events it missed, then the rest as they happen", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);
    const first = await open(server, events);
    runs[0]?.emit(analysing);
    runs[0]?.emit(analysed);
    await first.next(3);
    first.drop();

    // Missed while it was away.
    runs[0]?.emit(decompiling);
    runs[0]?.emit(progressing(0));
    const again = await open(server, events, first.events.at(-1)?.id);
    await again.next(2);
    runs[0]?.emit(progressing(1));
    runs[0]?.finish(rejected);
    await again.ended;

    expect(first.events.map((event) => event.id)).toEqual(["0", "1", "2"]);
    expect(again.events).toEqual([
      { id: "3", type: "progress", data: decompiling },
      { id: "4", type: "progress", data: progressing(0) },
      { id: "5", type: "progress", data: progressing(1) },
      expect.objectContaining({ id: "6", type: "ended" }),
    ]);
  });

  it("sends a page loaded again every event so far, so it can show the whole Reconstruction", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);
    runs[0]?.emit(analysing);
    runs[0]?.emit(analysed);
    runs[0]?.emit(decompiling);

    const stream = await open(server, events);
    await stream.next(4);

    expect(stream.events.map((event) => [event.id, event.type])).toEqual([
      ["0", "started"],
      ["1", "progress"],
      ["2", "progress"],
      ["3", "progress"],
    ]);
  });

  it("ends the stream of a Reconstruction that has ended once it has sent the events missed", async () => {
    const server = await start();
    const events = await started(server, ASSEMBLY);
    runs[0]?.emit(analysing);
    runs[0]?.finish(rejected);
    const whole = await open(server, events);
    await whole.ended;

    const caughtUp = await open(server, events, "2");
    await caughtUp.ended;

    expect(whole.events.map((event) => event.type)).toEqual([
      "started",
      "progress",
      "ended",
    ]);
    expect(caughtUp.events).toEqual([]);
  });

  it("keeps each Reconstruction's stream to itself", async () => {
    const server = await start();
    const first = await started(server, ASSEMBLY);
    const second = await started(server, `${ASSEMBLY}.other`);

    runs[1]?.emit(analysing);
    runs[0]?.finish(rejected);
    const stream = await open(server, second);
    await stream.next(2);

    expect(first).not.toBe(second);
    expect(stream.events).toEqual([
      { id: "0", type: "started", data: { path: `${ASSEMBLY}.other` } },
      { id: "1", type: "progress", data: analysing },
    ]);
  });

  it("says there is no such Reconstruction, for one this session did not start", async () => {
    const server = await start();

    const response = await send(
      server.port,
      "GET",
      "/api/reconstructions/00000000-0000-0000-0000-000000000000/events",
      "",
    );

    expect(response).toMatchObject({
      status: 404,
      body: {
        message:
          "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.",
      },
    });
  });
});

describe("stopping the server", () => {
  it("stops each Reconstruction still running, and deletes the Workspace once it has", async () => {
    let settled = false;
    const server = await start((path, outputDirectory, options) => {
      // Writes to its folder in the Workspace a moment after it is stopped,
      // as a Reconstruction stopping may.
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          setTimeout(() => {
            void mkdir(outputDirectory, { recursive: true }).then(() => {
              settled = true;
              reject(options.signal?.reason);
            });
          }, 100);
        });
      });
    });
    const events = await started(server, ASSEMBLY);
    const stream = await open(server, events);
    await stream.next(1);

    await server.close();

    expect(settled).toBe(true);
    expect(await exists(server.workspace)).toBe(false);
    expect(await readdir(temporaryRoot)).toEqual([]);
  });
});
