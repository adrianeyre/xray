// Exit only once stderr is flushed: pipe writes are asynchronous on some OSes.
process.stderr.write(
  "Unhandled exception. System.TypeInitializationException: boom\n",
  () => process.exit(1),
);
