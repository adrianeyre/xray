import { describe, expect, it } from "vitest";

import type { ReconstructionEvent } from "./events.js";
import {
  eventsPath,
  followReconstruction,
  reconstructionIn,
  startReconstruction,
  type Connection,
} from "./reconstruction-client.js";
import { json, recording, type FakeEventSource } from "./test-transport.js";

describe("startReconstruction", () => {
  it("posts the path as JSON, and resolves where the Reconstruction's events are", async () => {
    const started = {
      id: "1234",
      path: "/apps/App.dll",
      events: "/api/reconstructions/1234/events",
    };
    const { transport, requests } = recording(async () => json(202, started));

    const result = await startReconstruction(
      { path: "/apps/App.dll" },
      transport,
    );

    expect(result).toEqual({ ok: true, started });
    expect(requests).toEqual([
      {
        url: "/api/reconstructions",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"path":"/apps/App.dll"}',
        },
      },
    ]);
  });

  it("resolves why the server refused the path", async () => {
    const { transport } = recording(async () =>
      json(400, { message: '"App.dll" is not a full path.' }),
    );

    expect(await startReconstruction({ path: "App.dll" }, transport)).toEqual({
      ok: false,
      message: '"App.dll" is not a full path.',
    });
  });

  it("says when the server gives no reason, and when it cannot be reached", async () => {
    const silent = recording(async () => new Response("", { status: 500 }));
    const gone = recording(() => Promise.reject(new TypeError("fetch failed")));

    expect(
      await startReconstruction({ path: "/a.dll" }, silent.transport),
    ).toEqual({
      ok: false,
      message: "Xray refused the request (HTTP 500).",
    });
    expect(
      await startReconstruction({ path: "/a.dll" }, gone.transport),
    ).toEqual({
      ok: false,
      message:
        "Could not reach Xray. Is `xray ui` still running? Start it again, then reload this page.",
    });
  });
});

describe("followReconstruction", () => {
  function follow(answer: () => Promise<Response> = async () => json(200, {})) {
    const recorded = recording(answer);
    const events: ReconstructionEvent[] = [];
    const connections: Connection[] = [];
    const stop = followReconstruction(
      "/api/reconstructions/1234/events",
      {
        onEvent: (event) => events.push(event),
        onConnection: (connection) => connections.push(connection),
      },
      recorded.transport,
    );
    const source = recorded.sources[0] as FakeEventSource;
    return { ...recorded, source, events, connections, stop };
  }

  it("tells of each event, parsed, and closes the stream once it has ended", () => {
    const { source, events, connections } = follow();

    source.open();
    source.dispatch("started", '{"path":"/apps/App.dll"}');
    source.dispatch(
      "progress",
      '{"kind":"stage-started","stage":"analyse","elapsedMs":0}',
    );
    source.dispatch(
      "ended",
      '{"kind":"rejected","inputKind":"not-pe","explanation":"Not a PE file."}',
    );

    expect(source.url).toBe("/api/reconstructions/1234/events");
    expect(events).toEqual([
      { type: "started", data: { path: "/apps/App.dll" } },
      {
        type: "progress",
        data: { kind: "stage-started", stage: "analyse", elapsedMs: 0 },
      },
      {
        type: "ended",
        data: {
          kind: "rejected",
          inputKind: "not-pe",
          explanation: "Not a PE file.",
        },
      },
    ]);
    expect(source.closed).toBe(true);
    expect(connections).toEqual([
      { state: "connecting" },
      { state: "open" },
      { state: "ended" },
    ]);
  });

  it("says it is connecting again when the connection is lost, which the EventSource does by itself", () => {
    const { source, connections } = follow();

    source.open();
    source.lose();
    source.open();

    expect(source.closed).toBe(false);
    expect(connections).toEqual([
      { state: "connecting" },
      { state: "open" },
      { state: "reconnecting" },
      { state: "open" },
    ]);
  });

  it("says why, by asking the server, when the server will not stream it", async () => {
    const message =
      "There is no such Reconstruction: Xray has been restarted since it ran, or it never did. Reconstruct the Assembly again.";
    const { source, connections, requests } = follow(async () =>
      json(404, { message }),
    );

    source.refuse();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests[0]?.url).toBe("/api/reconstructions/1234/events");
    expect(connections.at(-1)).toEqual({ state: "lost", message });
  });

  it("ignores data that is not JSON, and stops telling once stopped", () => {
    const { source, events, stop } = follow();

    source.dispatch("progress", "{not json");
    stop();
    source.dispatch("started", '{"path":"/apps/App.dll"}');

    expect(events).toEqual([]);
    expect(source.closed).toBe(true);
  });
});

describe("the page's address", () => {
  it("says which Reconstruction to follow, if any", () => {
    expect(reconstructionIn("?reconstruction=1234")).toBe("1234");
    expect(reconstructionIn("")).toBeNull();
    expect(reconstructionIn("?reconstruction=")).toBeNull();
  });

  it("leads to the Reconstruction's stream, escaping what it is given", () => {
    expect(eventsPath("1234")).toBe("/api/reconstructions/1234/events");
    expect(eventsPath("../../x")).toBe(
      "/api/reconstructions/..%2F..%2Fx/events",
    );
  });
});
