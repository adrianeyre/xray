import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RECONSTRUCTION_STAGES, type ProgressEvent } from "@xray/core";
import { buildFixture, NATIVE_EXECUTABLE_FIXTURE } from "@xray/fixtures";
import { afterEach, describe, expect, it } from "vitest";

import type { ReconstructionEnd } from "./reconstructions.js";
import { startServer, type XrayServer } from "./server.js";
import {
  openStream,
  startReconstruction,
  type EventStream,
  type StreamedEvent,
} from "./test-client.js";

// The server reconstructing the real Fixtures with the real engine, built by
// the global setup, and the real `dotnet build`, as the web app asks it to.

const RECONSTRUCTION_TIMEOUT_MS = 5 * 60_000;

const servers: XrayServer[] = [];
const streams: EventStream[] = [];
const temporary: string[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.drop();
  }
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function start(): Promise<XrayServer> {
  const server = await startServer({ port: 0 });
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

/** Reconstructs the Assembly at `path` on `server`, and resolves every event of its stream. */
async function reconstructOn(
  server: XrayServer,
  path: string,
): Promise<{ events: readonly StreamedEvent[]; arrivals: readonly number[] }> {
  const response = await startReconstruction(server.port, path);
  expect(response.status).toBe(202);
  const stream = await open(
    server,
    (response.body as { events: string }).events,
  );
  const arrivals: number[] = [];
  let seen = 0;
  while (stream.events.at(-1)?.type !== "ended") {
    await stream.next(seen + 1);
    for (; seen < stream.events.length; seen++) {
      arrivals.push(performance.now());
    }
  }
  await stream.ended;
  return { events: stream.events, arrivals };
}

function progressOf(events: readonly StreamedEvent[]): ProgressEvent[] {
  return events
    .filter((event) => event.type === "progress")
    .map((event) => event.data as ProgressEvent);
}

function endOf(events: readonly StreamedEvent[]): ReconstructionEnd {
  return events.at(-1)?.data as ReconstructionEnd;
}

describe("the server, reconstructing by path (against the real engine)", () => {
  it(
    "reconstructs the arithmetic Fixture, streaming each stage as it progresses, and ends with a Full Reconstruction",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const server = await start();

      const { events, arrivals } = await reconstructOn(server, assemblyPath);

      expect(events[0]).toEqual({
        id: "0",
        type: "started",
        data: { path: assemblyPath },
      });
      expect(events.map((event) => event.id)).toEqual(
        events.map((_, index) => String(index)),
      );
      const progress = progressOf(events);
      expect(
        progress
          .filter((event) => event.kind !== "stage-progress")
          .map((event) => `${event.kind} ${event.stage}`),
      ).toEqual([
        "stage-started analyse",
        "stage-finished analyse",
        "stage-started decompile",
        "stage-finished decompile",
        "stage-started resolve-dependencies",
        "stage-finished resolve-dependencies",
        "stage-started generate",
        "stage-finished generate",
        "stage-started build",
        "stage-finished build",
        "stage-skipped run",
      ]);
      // Building takes seconds, reported at least once a second (FR-19).
      expect(
        progress.filter(
          (event) => event.kind === "stage-progress" && event.stage === "build",
        ).length,
      ).toBeGreaterThan(1);
      const gaps = arrivals.slice(1).map((at, i) => at - (arrivals[i] ?? at));
      expect(Math.max(...gaps)).toBeLessThan(1_000);
      expect(new Set(progress.map((event) => event.stage))).toEqual(
        new Set(RECONSTRUCTION_STAGES),
      );

      const end = endOf(events);
      expect(end).toMatchObject({
        kind: "reconstructed",
        report: {
          outcome: "full",
          reasons: [],
          solution: {
            solutionPath: "Arithmetic.sln",
            targetFramework: "net8.0",
          },
          build: { succeeded: true },
          run: null,
        },
      });
      // The Recovered Solution is in the session's Workspace, beside the
      // very report the stream ended with.
      if (end.kind !== "reconstructed") {
        throw new Error("Not reconstructed.");
      }
      expect(
        end.directory.startsWith(join(server.workspace, "reconstructions")),
      ).toBe(true);
      expect(
        JSON.parse(
          await readFile(join(end.directory, "xray-report.json"), "utf8"),
        ),
      ).toEqual(end.report);
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it(
    "resumes the stream of a browser that connects again mid-Reconstruction, missing no event",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");
      const server = await start();
      const response = await startReconstruction(server.port, assemblyPath);
      const path = (response.body as { events: string }).events;

      // Connection lost while building, then found again.
      const first = await open(server, path);
      while (
        !first.events.some(
          (event) =>
            event.type === "progress" &&
            (event.data as ProgressEvent).kind === "stage-started" &&
            (event.data as ProgressEvent).stage === "build",
        )
      ) {
        await first.next(first.events.length + 1);
      }
      first.drop();
      const again = await open(server, path, first.events.at(-1)?.id);
      await again.ended;

      const ids = [...first.events, ...again.events].map((event) => event.id);
      expect(ids).toEqual(ids.map((_, index) => String(index)));
      expect(endOf(again.events)).toMatchObject({
        kind: "reconstructed",
        report: { outcome: "full" },
      });
    },
    RECONSTRUCTION_TIMEOUT_MS,
  );

  it("rejects the native Fixture, a Native Executable, saying why, having only analysed it", async () => {
    const server = await start();

    const { events } = await reconstructOn(server, NATIVE_EXECUTABLE_FIXTURE);

    // On a slow machine analyse may also report its progress, once a second.
    expect(
      progressOf(events)
        .filter((event) => event.kind !== "stage-progress")
        .map((event) => `${event.kind} ${event.stage}`),
    ).toEqual(["stage-started analyse", "stage-finished analyse"]);
    expect(endOf(events)).toEqual({
      kind: "rejected",
      inputKind: "native-executable",
      explanation: expect.stringContaining(
        "Xray reconstructs Managed Assemblies only",
      ) as unknown,
    });
  });

  it("rejects a file that is not a PE file at all", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-server-engine-"));
    temporary.push(folder);
    const notes = join(folder, "notes.dll");
    await writeFile(notes, "Not an Assembly.\n");
    const server = await start();

    const { events } = await reconstructOn(server, notes);

    expect(endOf(events)).toMatchObject({
      kind: "rejected",
      inputKind: "not-pe",
    });
  });

  it("fails clearly for a path where there is no file, as the analyse stage", async () => {
    const missing = join(tmpdir(), "xray-there-is-nothing-here", "App.dll");
    const server = await start();

    const { events } = await reconstructOn(server, missing);

    const end = endOf(events);
    expect(end).toMatchObject({ kind: "failed", code: "not-found" });
    expect((end as { message: string }).message).toContain(missing);
    expect(progressOf(events).at(-1)).toMatchObject({
      kind: "stage-failed",
      stage: "analyse",
      message: (end as { message: string }).message,
    });
  });

  it("fails clearly for a path that is a folder with no Assembly in it", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-server-engine-"));
    temporary.push(folder);
    const server = await start();

    const { events } = await reconstructOn(server, folder);

    expect(endOf(events)).toMatchObject({
      kind: "failed",
      code: "no-assembly-in-folder",
      message: `${folder} is a folder with no .exe or .dll file in it to reconstruct; give the path of an Assembly, or of the folder holding one.`,
    });
  });
});
