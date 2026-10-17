import { serve } from "./serve.mjs";

serve((request) => {
  if (request.command === "ping") {
    // Exit only once stderr is flushed: pipe writes are asynchronous on some OSes.
    process.stderr.write(
      "Unhandled exception. System.InvalidOperationException: boom\n",
      () => process.exit(134),
    );
    return null;
  }
  return undefined;
});
