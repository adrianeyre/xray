import { serve } from "./serve.mjs";

// Answers "count" with a progress line per item in `params.items`, then the
// items; "count-oddly" with a progress line that is not one, and a stray
// progress line for a request it was never sent before answering "ping".
serve((request) => {
  const { id, command, params } = request;
  switch (command) {
    case "count":
      return [
        ...params.items.map((current, done) => ({
          id,
          progress: { done, total: params.items.length, current },
        })),
        { id, result: { items: params.items } },
      ];
    case "count-oddly":
      return { id, progress: { done: "one", total: 2, current: "a" } };
    case "ping":
      return [
        { id: 999, progress: { done: 0, total: 1, current: "nobody's" } },
        { id, result: {} },
      ];
    default:
      return undefined;
  }
});
