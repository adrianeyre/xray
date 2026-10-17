import { serve } from "./serve.mjs";

serve((request) =>
  request.command === "ping"
    ? "Hello from a stray Console.WriteLine"
    : undefined,
);
