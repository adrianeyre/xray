import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultEnginePath,
  startEngine,
  type EngineClient,
} from "./engine-client.js";
import { ENGINE_PROTOCOL_VERSION } from "./protocol.js";

// These run the real engine, built by the global setup (build-engine.ts).

const running: EngineClient[] = [];
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((client) => client.stop()));
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function started(): Promise<EngineClient> {
  const client = await startEngine();
  running.push(client);
  return client;
}

describe("engine client (against the real engine)", () => {
  it("starts the engine, handshakes, pings and stops it cleanly", async () => {
    const engine = await startEngine();

    expect(engine.info).toEqual({
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      engineVersion: expect.stringMatching(/^0\.0\.0\b/) as unknown,
      decompilerVersion: expect.stringMatching(/^11\.\d+\.\d+/) as unknown,
    });
    await expect(engine.ping()).resolves.toBeUndefined();
    expect(await engine.stop()).toEqual({ code: 0, signal: null });
    await expect(engine.ping()).rejects.toMatchObject({ code: "stopped" });
  });

  it("answers many concurrent pings", async () => {
    const engine = await started();

    await expect(
      Promise.all(Array.from({ length: 50 }, () => engine.ping())),
    ).resolves.toHaveLength(50);
  });

  // The engine decompiling itself takes seconds, more as it grows, and longer
  // still beside the rest of the suite, so it can pass Vitest's 5 s default.
  it("streams the progress of a decompilation, type by type, before answering it", async () => {
    const engine = await started();
    const progress: unknown[] = [];

    // The engine decompiling itself: a Managed Assembly with many types.
    const result = await engine.request(
      "decompile",
      { path: defaultEnginePath(), languageVersion: "12.0" },
      { onProgress: (each) => progress.push(each) },
    );

    const types = result["types"] as { namespace: string; name: string }[];
    expect(types.length).toBeGreaterThan(5);
    // One line per top-level type, each a unit of its own: the engine declares
    // no file-scoped types, and those its regular expressions' source
    // generator writes are left to the generator. Types are decompiled
    // several at once, so how many are done never goes down, nor counts a
    // type not yet reported, but can stay the same.
    expect(progress).toEqual(
      progress.map(() => ({
        done: expect.any(Number) as unknown,
        total: progress.length,
        current: expect.any(String) as unknown,
      })),
    );
    const done = progress.map((each) => (each as { done: number }).done);
    expect(done).toEqual(done.toSorted((a, b) => a - b));
    done.forEach((count, position) => {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(position);
    });
    const reported = progress.map(
      (each) => (each as { current: string }).current,
    );
    expect(reported.toSorted()).toEqual(
      types
        .map(({ namespace, name }) =>
          namespace === "" ? name : `${namespace}.${name}`,
        )
        .toSorted(),
    );
  }, 60_000);

  it("surfaces an error the engine reports", async () => {
    const engine = await started();

    await expect(engine.request("frobnicate")).rejects.toMatchObject({
      code: "request-failed",
      engineCode: "unknown-command",
      message:
        'The Xray engine could not run "frobnicate": Unknown command "frobnicate".',
    });
    await expect(engine.ping()).resolves.toBeUndefined();
  });

  it("reports an engine that is killed, rather than hanging", async () => {
    const engine = await started();

    expect(engine.pid).toBeTypeOf("number");
    process.kill(engine.pid as number, "SIGKILL");

    await expect(engine.ping()).rejects.toMatchObject({
      code: "engine-exited",
    });
  });

  it("reports a missing engine build", async () => {
    await expect(
      startEngine({ enginePath: join(tmpdir(), "no-such-engine.dll") }),
    ).rejects.toMatchObject({
      code: "engine-not-found",
    });
  });

  it("reports a missing dotnet host", async () => {
    await expect(
      startEngine({ dotnetPath: join(tmpdir(), "no-such-dir", "dotnet") }),
    ).rejects.toMatchObject({
      code: "runtime-not-found",
      message: expect.stringContaining(
        "Install the .NET SDK 8 or later",
      ) as unknown,
    });
  });

  it("reports a missing .NET runtime, rather than hanging", async () => {
    // A copy of the engine that asks for a runtime no machine has.
    const copy = await mkdtemp(join(tmpdir(), "xray-engine-"));
    temporary.push(copy);
    await cp(dirname(defaultEnginePath()), copy, { recursive: true });
    const runtimeConfig = join(copy, "Xray.Engine.runtimeconfig.json");
    const config = JSON.parse(await readFile(runtimeConfig, "utf8")) as {
      runtimeOptions: { framework: { version: string } };
    };
    config.runtimeOptions.framework.version = "99.0.0";
    await writeFile(runtimeConfig, JSON.stringify(config));

    const error = startEngine({ enginePath: join(copy, "Xray.Engine.dll") });

    await expect(error).rejects.toMatchObject({ code: "runtime-not-found" });
    await expect(error).rejects.toThrow(
      /^The \.NET runtime the Xray engine needs is not installed\. Install the \.NET SDK 8 or later from https:\/\/dot\.net\.\n\nYou must install or update \.NET/,
    );
  });
});
