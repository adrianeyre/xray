import { serve } from "./serve.mjs";

serve((request) =>
  request.command === "handshake"
    ? {
        id: request.id,
        result: {
          protocolVersion: 99,
          engineVersion: "9.9.9",
          decompilerVersion: "0.0.0",
        },
      }
    : undefined,
);
