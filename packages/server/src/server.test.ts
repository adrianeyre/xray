import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { connect, createServer, type Server } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerError } from "./server-error.js";
import {
  defaultWebRoot,
  SERVER_HOST,
  startServer,
  type XrayServer,
} from "./server.js";

// The web app served is the real one, built by the global setup.

let temporaryRoot: string;
const servers: XrayServer[] = [];
const blockers: Server[] = [];

// Each test gets its own temporary folder for Workspaces to be made in, so
// what one leaves behind can be seen without other test files' in the way.
beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "xray-server-test-"));
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    vi.stubEnv(name, temporaryRoot);
  }
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    blockers
      .splice(0)
      .map((blocker) => new Promise((resolve) => blocker.close(resolve))),
  );
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

async function start(
  options: Parameters<typeof startServer>[0] = { port: 0 },
): Promise<XrayServer> {
  const server = await startServer(options);
  servers.push(server);
  return server;
}

/** Has something else listen on a port of 127.0.0.1, and says which. */
function occupyPort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const blocker = createServer();
    blockers.push(blocker);
    blocker.once("error", reject);
    blocker.listen({ host: SERVER_HOST, port }, () => {
      const address = blocker.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Not listening on a TCP port."));
      } else {
        resolve(address.port);
      }
    });
  });
}

/**
 * Occupies a free port below every OS's ephemeral range (Linux's starts at
 * 32768, Windows' and macOS's at 49152). Windows hands those out in order, so
 * the one after a port the OS chose is the next any test is given.
 */
async function occupyPortBelowEphemeral(): Promise<number> {
  for (;;) {
    const port = 20_000 + Math.floor(Math.random() * 10_000);
    const occupied = await occupyPort(port).catch(() => undefined);
    if (occupied !== undefined) {
      return occupied;
    }
  }
}

/** How a TCP connection to `host`:`port` went: "connected", or its error's code. */
function tryConnect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("ETIMEDOUT");
    });
    socket.once("error", (error: NodeJS.ErrnoException) =>
      resolve(error.code ?? error.message),
    );
  });
}

interface Response {
  readonly status: number;
  readonly type: string;
  readonly body: string;
}

/** A GET for `path` from 127.0.0.1:`port`, sent with `host` as its Host header. */
function get(
  port: number,
  path: string,
  host = `${SERVER_HOST}:${port}`,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sent = request(
      { host: SERVER_HOST, port, path, headers: { host } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            type: response.headers["content-type"] ?? "",
            body,
          }),
        );
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}

/** This machine's addresses on interfaces other than loopback. */
function externalAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((info) => !info.internal)
    .map((info) => info.address);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("startServer", () => {
  it("serves the web app's shell page at http://127.0.0.1:<port>/", async () => {
    const server = await start();

    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    const page = await get(server.port, "/");
    expect(page.status).toBe(200);
    expect(page.type).toMatch(/^text\/html/);
    expect(page.body).toContain("<title>Xray</title>");
    expect(page.body).toContain('<div id="root"></div>');
  });

  it("serves the scripts and styles the shell page loads", async () => {
    const server = await start();
    const page = await get(server.port, "/");
    const assets = [
      ...page.body.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
    ].map((match) => match[1] as string);

    expect(assets.some((asset) => asset.endsWith(".js"))).toBe(true);
    expect(assets.some((asset) => asset.endsWith(".css"))).toBe(true);
    for (const asset of assets) {
      const served = await get(server.port, asset);
      expect(served.status, asset).toBe(200);
      expect(served.type, asset).toMatch(
        asset.endsWith(".js")
          ? /^(text|application)\/javascript/
          : /^text\/css/,
      );
    }
  });

  it("serves the code viewer, Monaco, and all it loads, from itself, as a chunk of its own the shell page loads only when needed", async () => {
    const server = await start();
    const page = await get(server.port, "/");
    const assets = await readdir(join(defaultWebRoot(), "assets"));
    const named = (pattern: RegExp) =>
      assets.filter((asset) => pattern.test(asset));

    // Monaco, its worker, its C# and XML highlighting and its icons' font.
    for (const pattern of [
      /^monaco-viewer-.*\.js$/,
      /^editor\.worker-.*\.js$/,
      /^csharp-.*\.js$/,
      /^xml-.*\.js$/,
      /^codicon-.*\.ttf$/,
    ]) {
      expect(named(pattern), String(pattern)).toHaveLength(1);
    }
    expect(page.body).not.toMatch(/monaco-viewer/);
    for (const asset of assets) {
      const served = await get(server.port, `/assets/${asset}`);
      expect(served.status, asset).toBe(200);
      // Nothing is fetched from a CDN, as Monaco's loader does by default.
      expect(served.body, asset).not.toMatch(
        /cdn\.jsdelivr\.net|unpkg\.com|cdnjs/,
      );
    }
  });

  it("listens on the port it is given", async () => {
    const free = await occupyPort();
    await new Promise((resolve) => blockers.pop()?.close(resolve));

    const server = await start({ port: free });

    expect(server.port).toBe(free);
    expect((await get(free, "/")).status).toBe(200);
  });

  describe("is unreachable from other hosts", () => {
    it("listens on 127.0.0.1, so is reached there", async () => {
      const server = await start();

      expect(await tryConnect(SERVER_HOST, server.port)).toBe("connected");
    });

    // Where this machine has an address on a network, another host would
    // connect to that one. A sandbox with no network has none to try.
    it.runIf(externalAddresses().length > 0)(
      "refuses connections to this machine's network addresses",
      async () => {
        const server = await start();

        // All at once: a machine may have dozens, each of which can take the
        // whole connect timeout to refuse.
        const addresses = externalAddresses();
        const results = await Promise.all(
          addresses.map((address) => tryConnect(address, server.port)),
        );
        addresses.forEach((address, i) => {
          expect(results[i], address).not.toBe("connected");
        });
      },
    );

    it("refuses requests addressed to any name but 127.0.0.1 or localhost, so DNS rebinding cannot reach it", async () => {
      const server = await start();

      for (const host of [
        `evil.example:${server.port}`,
        `127.0.0.1.nip.io:${server.port}`,
        `${SERVER_HOST}:1`,
      ]) {
        const response = await get(server.port, "/", host);
        expect(response.status, host).toBe(403);
        expect(response.body, host).toContain(
          `only answers requests addressed to ${server.url}`,
        );
      }
      expect(
        (await get(server.port, "/", `localhost:${server.port}`)).status,
      ).toBe(200);
    });
  });

  describe("the session's Workspace", () => {
    it("is an empty temporary folder while the server runs", async () => {
      const server = await start();

      expect(server.workspace.startsWith(join(temporaryRoot, "xray-ui-"))).toBe(
        true,
      );
      expect((await stat(server.workspace)).isDirectory()).toBe(true);
      expect(await readdir(server.workspace)).toEqual([]);
    });

    it("is one per session", async () => {
      const first = await start();
      const second = await start();

      expect(second.workspace).not.toBe(first.workspace);
    });

    it("is deleted, with everything in it, when the server stops", async () => {
      const server = await start();
      await mkdir(join(server.workspace, "upload", "MyApp"), {
        recursive: true,
      });

      await server.close();

      expect(await exists(server.workspace)).toBe(false);
      expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it("stops the server, so it no longer answers", async () => {
      const server = await start();

      await server.close();
      await server.close();

      expect(await tryConnect(SERVER_HOST, server.port)).not.toBe("connected");
    });
  });

  describe("reports a busy port", () => {
    it("with the next free port to try instead, leaving no Workspace", async () => {
      const busy = await occupyPortBelowEphemeral();

      const error = await startServer({ port: busy }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ServerError);
      expect((error as ServerError).code).toBe("port-in-use");
      const message = (error as ServerError).message;
      expect(message).toMatch(
        new RegExp(
          `^Port ${busy} on 127\\.0\\.0\\.1 is already in use\\. Try another, such as: xray ui --port \\d+$`,
        ),
      );
      const suggested = Number(/--port (\d+)$/.exec(message)?.[1]);
      expect(suggested).not.toBe(busy);
      expect(await tryConnect(SERVER_HOST, suggested)).not.toBe("connected");
      expect(await readdir(temporaryRoot)).toEqual([]);
    });
  });

  it("says how to build the web app if it has not been, leaving no Workspace", async () => {
    const webRoot = await mkdtemp(join(temporaryRoot, "web-"));

    const error = await startServer({ port: 0, webRoot }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe("web-app-not-built");
    expect((error as ServerError).message).toContain("pnpm build:web");
    expect(await readdir(temporaryRoot)).toEqual([
      webRoot.slice(temporaryRoot.length + 1),
    ]);
  });
});
