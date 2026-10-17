import { createServer } from "node:net";

/** How many ports after a busy one to try before letting the OS pick one. */
const PORTS_TO_TRY = 20;

/**
 * A port on `host` nothing is listening on, to suggest in place of the busy
 * `port`: the first free one after it, or, failing that, any the OS offers.
 */
export async function suggestFreePort(
  host: string,
  port: number,
): Promise<number> {
  for (
    let candidate = port + 1;
    candidate <= Math.min(port + PORTS_TO_TRY, 65_535);
    candidate++
  ) {
    if ((await tryListen(host, candidate)) !== undefined) {
      return candidate;
    }
  }
  return (await tryListen(host, 0)) ?? 0;
}

/** Listens on `port` and stops at once: the port it got, or `undefined` if it could not. */
function tryListen(host: string, port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(undefined));
    server.listen({ host, port, exclusive: true }, () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" ? address?.port : undefined),
      );
    });
  });
}
