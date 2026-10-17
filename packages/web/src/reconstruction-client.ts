// How the web app starts a Reconstruction and follows its stream of events,
// over @xray/server's API (docs/reference/xray-ui.md#the-api). Nothing here
// needs a page, so it runs, and is tested, in Node.js as in the browser.

import {
  EVENT_TYPES,
  type ApiError,
  type ReconstructionEvent,
  type StartedReconstruction,
} from "./events.js";

/** Where the API is, below the address the web app is served from. */
export const API_PREFIX = "/api";

/** The query parameter of the page's address that says which Reconstruction it follows. */
export const RECONSTRUCTION_PARAMETER = "reconstruction";

/** The Reconstruction the page's address, by its `search`, says to follow; `null` if none. */
export function reconstructionIn(search: string): string | null {
  const id = new URLSearchParams(search).get(RECONSTRUCTION_PARAMETER);
  return id === null || id === "" ? null : id;
}

/** Where the stream of the Reconstruction with `id` is. */
export function eventsPath(id: string): string {
  return `${API_PREFIX}/reconstructions/${encodeURIComponent(id)}/events`;
}

/** The parts of the browser's `EventSource` this uses. */
export interface EventSourceLike {
  /** 0 while connecting (again), 1 while open, 2 once closed for good. */
  readonly readyState: number;
  /** For `open`, `error`, and each type of event the server sends, with its `data`. */
  addEventListener(
    type: string,
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
  close(): void;
}

/** What the server answered a request with. */
export interface Answer {
  readonly status: number;
  /** Its body, parsed as JSON; `null` if it has none, or it is not JSON. */
  readonly body: unknown;
}

/** What the web app sends requests with: the browser's own, or other ones in tests. */
export interface Transport {
  readonly fetch: typeof fetch;
  readonly openEventSource: (url: string) => EventSourceLike;
  /**
   * PUTs `body` to `url` as `application/octet-stream`, telling `onProgress`
   * how many of its bytes have been sent as they are, which `fetch` cannot.
   * Rejects if the server cannot be reached.
   */
  readonly put: (
    url: string,
    body: Blob,
    onProgress: (sent: number) => void,
  ) => Promise<Answer>;
}

/** How starting a Reconstruction went. */
export type StartResult =
  | { readonly ok: true; readonly started: StartedReconstruction }
  | { readonly ok: false; readonly message: string };

export const UNREACHABLE =
  "Could not reach Xray. Is `xray ui` still running? Start it again, then reload this page.";

/**
 * What to reconstruct: the Assembly, or folder, at a path on this machine, or
 * one uploaded; and whether to reconstruct the Sibling Assemblies beside it,
 * as the server does unless told not to.
 */
export type ReconstructionInput = (
  | { readonly path: string }
  | {
      /** The upload's id. */
      readonly upload: string;
      /** The Assembly's path in it. */
      readonly assembly: string;
    }
) & { readonly siblings?: boolean };

/**
 * Asks the server at `base` (`""` for the one that served the page) to
 * reconstruct `input`, and resolves with where its events are, or why the
 * server refused.
 */
export async function startReconstruction(
  input: ReconstructionInput,
  { fetch }: Pick<Transport, "fetch">,
  base = "",
): Promise<StartResult> {
  let response: Response;
  try {
    response = await fetch(`${base}${API_PREFIX}/reconstructions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) {
    return { ok: true, started: body as StartedReconstruction };
  }
  return { ok: false, message: messageOf(body, response.status) };
}

/** How the stream of a Reconstruction's events is going. */
export type Connection =
  | { readonly state: "connecting" }
  | { readonly state: "open" }
  /** The connection was lost; the browser is connecting again, to carry on where it left off. */
  | { readonly state: "reconnecting" }
  /** The Reconstruction ended, and its stream with it. */
  | { readonly state: "ended" }
  /** The server would not stream it, for the reason given. */
  | { readonly state: "lost"; readonly message: string };

export interface FollowHandlers {
  readonly onEvent: (event: ReconstructionEvent) => void;
  readonly onConnection: (connection: Connection) => void;
}

const CLOSED = 2;

/**
 * Follows the stream of events at `url`, telling `handlers` of each event and
 * of how the connection goes, until it ends. A lost connection is made again
 * by the `EventSource`, which says which event it had last, so the server
 * sends only those it missed. Returns a function that stops following it.
 */
export function followReconstruction(
  url: string,
  handlers: FollowHandlers,
  transport: Transport,
): () => void {
  const source = transport.openEventSource(url);
  let stopped = false;
  handlers.onConnection({ state: "connecting" });
  source.addEventListener("open", () =>
    handlers.onConnection({ state: "open" }),
  );
  source.addEventListener("error", () => {
    if (stopped) {
      return;
    }
    if (source.readyState !== CLOSED) {
      handlers.onConnection({ state: "reconnecting" });
      return;
    }
    // The server answered, but not with a stream: it says why.
    stopped = true;
    void whyRefused(url, transport).then((message) =>
      handlers.onConnection({ state: "lost", message }),
    );
  });
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, ({ data }) => {
      if (stopped || typeof data !== "string") {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      handlers.onEvent({ type, data: parsed } as ReconstructionEvent);
      if (type === "ended") {
        stopped = true;
        source.close();
        handlers.onConnection({ state: "ended" });
      }
    });
  }
  return () => {
    stopped = true;
    source.close();
  };
}

async function whyRefused(url: string, { fetch }: Transport): Promise<string> {
  const stop = new AbortController();
  try {
    const response = await fetch(url, { signal: stop.signal });
    if (response.ok) {
      return "Xray stopped streaming this Reconstruction. Reload the page to follow it again.";
    }
    return messageOf(await response.json().catch(() => null), response.status);
  } catch {
    return UNREACHABLE;
  } finally {
    // A stream the server did send is not wanted now.
    stop.abort();
  }
}

/** What the server said was wrong, or, if it said nothing, its status. */
export function messageOf(body: unknown, status: number): string {
  const message = (body as Partial<ApiError> | null)?.message;
  return typeof message === "string"
    ? message
    : `Xray refused the request (HTTP ${status}).`;
}
