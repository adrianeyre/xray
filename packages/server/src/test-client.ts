// For the server's tests: requests to it as the web app sends them, and a
// reader of the Server-Sent Events it streams, as a browser's EventSource
// reads them.

import { request, type IncomingMessage } from "node:http";

import { SERVER_HOST } from "./server.js";

export interface JsonResponse {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

/** Sends `body` to `path` on 127.0.0.1:`port`, as JSON unless other headers say otherwise. */
export function send(
  port: number,
  method: string,
  path: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: SERVER_HOST,
        port,
        method,
        path,
        headers: {
          host: `${SERVER_HOST}:${port}`,
          "content-type": "application/json",
          origin: `http://${SERVER_HOST}:${port}`,
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (text += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text === "" ? undefined : (JSON.parse(text) as unknown),
          }),
        );
      },
    );
    sent.on("error", reject);
    sent.end(body);
  });
}

/** Asks the server at `port` to reconstruct the Assembly at `path`. */
export function startReconstruction(
  port: number,
  path: string,
): Promise<JsonResponse> {
  return send(port, "POST", "/api/reconstructions", JSON.stringify({ path }));
}

/** One Server-Sent Event, its data parsed as JSON. */
export interface StreamedEvent {
  readonly id: string | undefined;
  readonly type: string;
  readonly data: unknown;
}

export interface EventStream {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  /** Every event so far. */
  readonly events: readonly StreamedEvent[];
  /** The `retry:` the server asked for, in milliseconds. */
  readonly retry: () => number | undefined;
  /** Resolves once there are `count` events, or the stream ends first. */
  readonly next: (count: number) => Promise<void>;
  /** Resolves once the server ends the stream. */
  readonly ended: Promise<void>;
  /** Drops the connection, as a browser that loses it does. */
  readonly drop: () => void;
}

/**
 * Opens the stream at `path` on 127.0.0.1:`port`, which must answer 200, saying, as a browser
 * connecting again does, which event it had last.
 */
export function openStream(
  port: number,
  path: string,
  lastEventId?: string,
): Promise<EventStream> {
  let dropped = false;
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: SERVER_HOST,
        port,
        path,
        headers: {
          host: `${SERVER_HOST}:${port}`,
          accept: "text/event-stream",
          ...(lastEventId === undefined
            ? {}
            : { "last-event-id": lastEventId }),
        },
      },
      (response) => {
        const events: StreamedEvent[] = [];
        let retry: number | undefined;
        let buffer = "";
        const waiting = new Set<() => void>();
        let ended = false;
        const wake = () => {
          for (const check of waiting) {
            check();
          }
        };
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const fields = new Map<string, string>();
            for (const line of block.split("\n")) {
              const colon = line.indexOf(":");
              fields.set(
                line.slice(0, colon),
                line.slice(colon + 1).replace(/^ /, ""),
              );
            }
            if (fields.has("retry")) {
              retry = Number(fields.get("retry"));
            }
            const data = fields.get("data");
            if (data !== undefined) {
              events.push({
                id: fields.get("id"),
                type: fields.get("event") ?? "message",
                data: JSON.parse(data) as unknown,
              });
            }
          }
          wake();
        });
        const endedPromise = new Promise<void>((resolveEnd) =>
          response.once("close", () => {
            ended = true;
            wake();
            resolveEnd();
          }),
        );
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          events,
          retry: () => retry,
          next: (count) =>
            new Promise((resolveNext) => {
              const check = () => {
                if (events.length >= count || ended) {
                  waiting.delete(check);
                  resolveNext();
                }
              };
              waiting.add(check);
              check();
            }),
          ended: endedPromise,
          drop: () => {
            dropped = true;
            sent.destroy();
          },
        });
      },
    );
    sent.on("error", (error) => {
      // Dropping it on purpose is not an error.
      if (!dropped) {
        reject(error);
      }
    });
    sent.end();
  });
}

/** What the server answered a `GET`, its body as it sent it. */
export interface RawResponse {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
}

/**
 * GETs `path` on 127.0.0.1:`port` exactly as given, as a client that does not
 * tidy it first may: with `..`, encoded or not, left in.
 */
export function get(port: number, path: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: SERVER_HOST,
        port,
        path,
        headers: { host: `${SERVER_HOST}:${port}` },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}
