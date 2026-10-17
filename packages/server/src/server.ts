import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import fastifyStatic from "@fastify/static";
import { reconstruct } from "@xray/core";
import Fastify from "fastify";

import { registerApi } from "./api.js";
import { suggestFreePort } from "./free-port.js";
import { Reconstructions, type Reconstruct } from "./reconstructions.js";
import { ServerError } from "./server-error.js";
import { Uploads } from "./uploads.js";
import { createWorkspace } from "./workspace.js";

/**
 * The only address the server listens on (PRD §8, ADR 0003): the loopback
 * interface, so no other host can reach it. Not configurable.
 */
export const SERVER_HOST = "127.0.0.1";

/** The port `xray ui` listens on unless told otherwise: X-R-A-Y on a phone keypad. */
export const DEFAULT_PORT = 9729;

export interface ServerOptions {
  /** The port to listen on; 0 for any free one. {@link DEFAULT_PORT} if absent. */
  readonly port?: number;
  /** The folder holding the built web app. @xray/web's `dist/` if absent. */
  readonly webRoot?: string;
  /** What runs each Reconstruction. @xray/core's `reconstruct` if absent. */
  readonly reconstruct?: Reconstruct;
}

/** `xray ui`'s server, listening on {@link SERVER_HOST}. */
export interface XrayServer {
  /** Where the web app is: `http://127.0.0.1:<port>/`. */
  readonly url: string;
  /** The port it is listening on. */
  readonly port: number;
  /** This session's temporary Workspace; deleted by {@link close}. */
  readonly workspace: string;
  /**
   * Stops listening, then stops any Reconstruction still running, then deletes
   * the Workspace. Safe to call more than once.
   */
  readonly close: () => Promise<void>;
}

/** The built web app, from @xray/web: `vite build` writes it to its `dist/`. */
export function defaultWebRoot(): string {
  const webPackage = createRequire(import.meta.url).resolve(
    "@xray/web/package.json",
  );
  return join(dirname(webPackage), "dist");
}

/**
 * Starts the server: creates a temporary Workspace for the session, then
 * serves the web app on {@link SERVER_HOST}. Throws a {@link ServerError} if
 * the web app has not been built or the port is busy, leaving no Workspace
 * behind.
 */
export async function startServer(
  options: ServerOptions = {},
): Promise<XrayServer> {
  const {
    port = DEFAULT_PORT,
    webRoot = defaultWebRoot(),
    reconstruct: reconstructWith = reconstruct,
  } = options;
  try {
    await access(join(webRoot, "index.html"));
  } catch (error) {
    throw new ServerError(
      "web-app-not-built",
      `The web app has not been built: there is no ${join(webRoot, "index.html")}. Build it with \`pnpm build:web\`.`,
      { cause: error },
    );
  }

  const workspace = await createWorkspace();
  const app = Fastify({ forceCloseConnections: true });
  // The Host headers it answers, once it knows its port. Refusing requests
  // addressed to any other name means a web page on another host that has its
  // own name resolve to 127.0.0.1 (DNS rebinding) cannot drive the server
  // through the browser.
  const hosts: string[] = [];
  app.addHook("onRequest", async (request, reply) => {
    if (!hosts.includes(request.headers.host ?? "")) {
      await reply
        .code(403)
        .type("text/plain")
        .send(`Xray only answers requests addressed to http://${hosts[0]}/.\n`);
      return;
    }
    // A web page on another host can still send this machine's browser to
    // 127.0.0.1 with a POST; the browser says which page it came from.
    const { origin } = request.headers;
    if (
      !["GET", "HEAD"].includes(request.method) &&
      origin !== undefined &&
      !hosts.some((host) => origin === `http://${host}`)
    ) {
      await reply
        .code(403)
        .type("application/json")
        .send({
          message: `Xray only answers pages it served itself, at http://${hosts[0]}/.`,
        });
    }
  });
  const reconstructions = new Reconstructions(workspace.path, reconstructWith);
  const uploads = new Uploads(workspace.path);
  registerApi(app, reconstructions, uploads);
  await app.register(fastifyStatic, { root: webRoot });

  try {
    await app.listen({ host: SERVER_HOST, port });
  } catch (error) {
    await app.close();
    await Promise.all([reconstructions.stop(), uploads.stop()]);
    await workspace.remove();
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      const suggestion = await suggestFreePort(SERVER_HOST, port);
      throw new ServerError(
        "port-in-use",
        `Port ${port} on ${SERVER_HOST} is already in use. Try another, such as: xray ui --port ${suggestion}`,
        { cause: error },
      );
    }
    throw error;
  }
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`The server is not listening on a TCP port: ${address}`);
  }
  hosts.push(`${SERVER_HOST}:${address.port}`, `localhost:${address.port}`);

  let closing: Promise<void> | undefined;
  return {
    url: `http://${SERVER_HOST}:${address.port}/`,
    port: address.port,
    workspace: workspace.path,
    close: () => {
      closing ??= (async () => {
        try {
          await app.close();
        } finally {
          try {
            // None may write to the Workspace once it is deleted.
            await Promise.all([reconstructions.stop(), uploads.stop()]);
          } finally {
            await workspace.remove();
          }
        }
      })();
      return closing;
    },
  };
}
