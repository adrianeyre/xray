import { serve } from "./serve.mjs";

// Holds "echo" requests until three have arrived, then answers them last-first.
const held = [];
serve((request) => {
  if (request.command !== "echo") {
    return undefined;
  }
  held.push(request);
  if (held.length === 3) {
    for (const { id, params } of held.reverse()) {
      process.stdout.write(`${JSON.stringify({ id, result: params })}\n`);
    }
  }
  return null;
});
