import { serve } from "./serve.mjs";

// Handshakes and answers pings, like a working engine.
serve((request) =>
  request.command === "ping" ? { id: request.id, result: {} } : undefined,
);
