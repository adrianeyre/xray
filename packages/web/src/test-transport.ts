// For the web app's tests: a `fetch` and an `EventSource` the test drives, in
// place of the browser's.

import type {
  Answer,
  EventSourceLike,
  Transport,
} from "./reconstruction-client.js";

/** An `EventSource` the test drives as the browser's would behave. */
export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly #listeners = new Map<
    string,
    ((event: { data?: unknown }) => void)[]
  >();

  constructor(readonly url: string) {}

  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  dispatch(type: string, data?: string): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(data === undefined ? {} : { data });
    }
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open");
  }

  /** The connection is lost; the browser connects again. */
  lose(): void {
    this.readyState = 0;
    this.dispatch("error");
  }

  /** The server answered, but not with a stream; the browser gives up. */
  refuse(): void {
    this.readyState = 2;
    this.dispatch("error");
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface Recorded {
  readonly transport: Transport;
  readonly sources: FakeEventSource[];
  readonly requests: { url: string; init: RequestInit | undefined }[];
  /** Each file PUT, in the order sent. */
  readonly puts: { url: string; body: Blob }[];
}

/** Sends the whole of a file at once, which the server takes. */
export const PUT_WHOLE: Transport["put"] = async (_url, body, onProgress) => {
  onProgress(body.size);
  return { status: 204, body: null } satisfies Answer;
};

export function recording(
  answer: (url: string, init: RequestInit | undefined) => Promise<Response>,
  put: Transport["put"] = PUT_WHOLE,
): Recorded {
  const sources: FakeEventSource[] = [];
  const requests: Recorded["requests"] = [];
  const puts: Recorded["puts"] = [];
  return {
    sources,
    requests,
    puts,
    transport: {
      fetch: (input, init) => {
        requests.push({ url: String(input), init });
        return answer(String(input), init);
      },
      put: (url, body, onProgress) => {
        puts.push({ url, body });
        return put(url, body, onProgress);
      },
      openEventSource: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    },
  };
}
