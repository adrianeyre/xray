import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NATIVE_EXECUTABLE_FIXTURE } from "@xray/fixtures";
import type { XrayServer } from "@xray/server";
import { afterEach, describe, expect, it } from "vitest";

import { coreCommands } from "./main.js";

// The published package runs every command with the engine and web app it
// bundles, rather than this repository's builds of them. Each command is given
// an engine where there is none, and a web app of its own, to show it uses
// what it is given.

const temporaries: string[] = [];
const servers: XrayServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaries
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporary(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "xray-core-commands-"));
  temporaries.push(path);
  return path;
}

async function nowhere(): Promise<string> {
  return join(await temporary(), "Xray.Engine.dll");
}

describe("coreCommands", () => {
  it("checks the engine it is given in xray doctor", async () => {
    const enginePath = await nowhere();

    const report = await coreCommands({ engine: { enginePath } }).doctor();

    expect(report.checks.find((check) => check.id === "engine")).toMatchObject({
      passed: false,
      summary: expect.stringContaining(enginePath),
    });
  });

  it("inspects with the engine it is given", async () => {
    const enginePath = await nowhere();

    await expect(
      coreCommands({ engine: { enginePath } }).inspect(
        NATIVE_EXECUTABLE_FIXTURE,
      ),
    ).rejects.toMatchObject({
      code: "engine-not-found",
      message: expect.stringContaining(enginePath),
    });
  });

  it("reconstructs with the engine it is given", async () => {
    const enginePath = await nowhere();

    await expect(
      coreCommands({ engine: { enginePath } }).reconstruct(
        NATIVE_EXECUTABLE_FIXTURE,
        join(await temporary(), "out"),
        {
          force: false,
          build: true,
          run: false,
          siblings: true,
          offline: false,
          onProgress: () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      code: "engine-not-found",
      message: expect.stringContaining(enginePath),
    });
  });

  it("serves the web app it is given in xray ui, reconstructing with the engine it is given", async () => {
    const enginePath = await nowhere();
    const webRoot = await temporary();
    await writeFile(join(webRoot, "index.html"), "<p>bundled web app</p>");

    const server = await coreCommands({ engine: { enginePath }, webRoot }).ui(
      0,
    );
    servers.push(server);

    expect(await (await fetch(server.url)).text()).toBe(
      "<p>bundled web app</p>",
    );
    const started = await fetch(new URL("api/reconstructions", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: NATIVE_EXECUTABLE_FIXTURE }),
    });
    const { events } = (await started.json()) as { events: string };
    const stream = await (await fetch(new URL(events, server.url))).text();
    const ended = /^event: ended\ndata: (.+)$/m.exec(stream)?.[1];
    expect(JSON.parse(ended ?? "null")).toMatchObject({
      kind: "failed",
      code: "engine-not-found",
      message: expect.stringContaining(enginePath),
    });
  });
});
