// Stand-ins for the engine sidecar, run with `node` in place of `dotnet`, that
// misbehave in ways the real engine cannot be made to on demand.
import { createInterface } from "node:readline";

/**
 * Answers each request line with `handle(request)`: an object or raw string is
 * written as one line, an array as one line per element, `null` sends nothing,
 * and `undefined` falls back to a well-behaved handshake (and silence for
 * anything else). `handle` may return a promise of any of these.
 */
export function serve(handle) {
  createInterface({ input: process.stdin }).on("line", async (line) => {
    const request = JSON.parse(line);
    const handled = await handle(request);
    const response = handled === undefined ? defaultResponse(request) : handled;
    for (const each of response === null ? [] : [response].flat()) {
      process.stdout.write(
        `${typeof each === "string" ? each : JSON.stringify(each)}\n`,
      );
    }
  });
}

/** The real engine's handshake answer, or `null` (no reply) for anything else. */
function defaultResponse(request) {
  return request.command === "handshake"
    ? {
        id: request.id,
        result: {
          protocolVersion: 11,
          engineVersion: "0.0.0-fake",
          decompilerVersion: "0.0.0",
        },
      }
    : null;
}
