import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  startEngine,
  type EngineClient,
  type EngineOptions,
} from "./engine-client.js";
import { ENGINE_PROTOCOL_VERSION } from "./protocol.js";

// Each fake is a Node script run in place of `dotnet Xray.Engine.dll`.
function fake(
  name: string,
  options: EngineOptions = {},
): Promise<EngineClient> {
  return startEngine({
    dotnetPath: process.execPath,
    enginePath: fileURLToPath(new URL(`fakes/${name}.mjs`, import.meta.url)),
    ...options,
  });
}

const running: EngineClient[] = [];
async function started(
  name: string,
  options: EngineOptions = {},
): Promise<EngineClient> {
  const client = await fake(name, options);
  running.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((client) => client.stop()));
});

describe("engine client (against fake engines)", () => {
  it("matches responses to requests by id, whatever order they arrive in", async () => {
    const engine = await started("answers-out-of-order");

    const results = await Promise.all([
      engine.request("echo", { n: 1 }),
      engine.request("echo", { n: 2 }),
      engine.request("echo", { n: 3 }),
    ]);

    expect(results).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("tells a request of each progress line the engine sends before answering it", async () => {
    const engine = await started("reports-progress");
    const progress: unknown[] = [];
    let answered = false;

    const result = await engine.request(
      "count",
      { items: ["App.Program", "App.Models.Point`1"] },
      {
        onProgress: (each) => {
          expect(answered).toBe(false);
          progress.push(each);
        },
      },
    );
    answered = true;

    expect(result).toEqual({ items: ["App.Program", "App.Models.Point`1"] });
    expect(progress).toEqual([
      { done: 0, total: 2, current: "App.Program" },
      { done: 1, total: 2, current: "App.Models.Point`1" },
    ]);
  });

  it("ignores progress for a request nobody is waiting on", async () => {
    const engine = await started("reports-progress");

    await expect(engine.ping()).resolves.toBeUndefined();
  });

  it("stops an engine that sends a malformed progress line", async () => {
    const engine = await started("reports-progress");

    await expect(
      engine.request("count-oddly", {}, { onProgress: () => undefined }),
    ).rejects.toMatchObject({
      code: "protocol-violation",
      message: expect.stringContaining('"progress":{"done":"one"') as unknown,
    });
    expect((await engine.stop()).signal).toBe("SIGKILL");
  });

  it("rejects an engine that reports a different protocol version", async () => {
    await expect(fake("speaks-another-protocol")).rejects.toMatchObject({
      code: "protocol-mismatch",
      message: `The Xray engine speaks protocol version 99 but Xray expects version ${ENGINE_PROTOCOL_VERSION}. Xray and its engine come from different builds; rebuild the engine with \`pnpm build:engine\`.`,
    });
  });

  it("rejects an engine that refuses Xray's protocol version", async () => {
    const error = fake("refuses-protocol");

    await expect(error).rejects.toMatchObject({
      code: "protocol-mismatch",
      engineCode: "protocol-mismatch",
    });
    await expect(error).rejects.toThrow(
      `The client speaks engine protocol version ${ENGINE_PROTOCOL_VERSION} but this engine speaks version 99.`,
    );
  });

  it("reports an engine that exits before the handshake, with its stderr", async () => {
    await expect(fake("crashes-on-start")).rejects.toMatchObject({
      code: "engine-exited",
      message:
        "The Xray engine exited unexpectedly (exit code 1).\n\nUnhandled exception. System.TypeInitializationException: boom",
    });
  });

  it("rejects in-flight and later requests when the engine crashes", async () => {
    const engine = await started("crashes-on-ping");

    const crash = {
      code: "engine-exited",
      stderr: expect.stringContaining("boom") as unknown,
    };
    await expect(engine.ping()).rejects.toMatchObject(crash);
    await expect(engine.ping()).rejects.toMatchObject(crash);
    expect(await engine.stop()).toEqual({ code: 134, signal: null });
  });

  it("times out, rather than hangs, when the engine never answers the handshake", async () => {
    await expect(
      fake("never-answers", { timeoutMs: 300 }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: 'The Xray engine did not answer "handshake" within 300 ms.',
    });
  });

  it("times out a request the engine never answers, and kills an engine that will not stop", async () => {
    const engine = await started("hangs-after-handshake", { timeoutMs: 300 });

    await expect(engine.ping()).rejects.toMatchObject({ code: "timeout" });
    expect(await engine.stop()).toEqual({ code: null, signal: "SIGKILL" });
  });

  it("stops an engine that writes something other than protocol responses", async () => {
    const engine = await started("writes-garbage");

    await expect(engine.ping()).rejects.toMatchObject({
      code: "protocol-violation",
      message:
        "The Xray engine wrote a line that is not JSON: Hello from a stray Console.WriteLine",
    });
    await expect(engine.ping()).rejects.toMatchObject({
      code: "protocol-violation",
    });
    expect((await engine.stop()).signal).toBe("SIGKILL");
  });

  it("kills the engine at once when stopped with kill, whatever it is doing", async () => {
    // Without kill, this engine would be killed only after 30 s.
    const engine = await started("hangs-after-handshake", {
      timeoutMs: 30_000,
    });
    const ping = expect(engine.ping()).rejects.toMatchObject({
      code: "stopped",
    });
    const stopping = performance.now();

    expect(await engine.stop({ kill: true })).toEqual({
      code: null,
      signal: "SIGKILL",
    });
    expect(performance.now() - stopping).toBeLessThan(5_000);
    await ping;
  });

  it("rejects requests still in flight when stopped", async () => {
    const engine = await started("hangs-after-handshake", { timeoutMs: 300 });

    const ping = expect(engine.ping()).rejects.toMatchObject({
      code: "stopped",
    });
    await engine.stop();

    await ping;
    await expect(engine.ping()).rejects.toMatchObject({ code: "stopped" });
  });
});
