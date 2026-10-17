import { serve } from "./serve.mjs";

// Answers the handshake, then neither answers pings nor exits when stdin closes.
serve(() => undefined);
process.stdin.on("end", () => setInterval(() => undefined, 1_000));
