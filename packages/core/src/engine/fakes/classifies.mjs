import { basename } from "node:path";

import { serve } from "./serve.mjs";

// Answers "classify" by the file's name alone, never reading it, so each
// answer (or error) the real engine can give is available on demand.
const answers = {
  "managed.dll": { result: { kind: "managed-assembly", machine: "I386" } },
  "native-x64.exe": { result: { kind: "native-executable", machine: "Amd64" } },
  "native-arm64.dll": {
    result: { kind: "native-executable", machine: "Arm64" },
  },
  "native-unknown.exe": {
    result: { kind: "native-executable", machine: "12345" },
  },
  "notes.txt": { result: { kind: "not-pe", reason: "no-dos-header" } },
  "dos.exe": { result: { kind: "not-pe", reason: "no-pe-header" } },
  "truncated.exe": {
    result: { kind: "not-pe", reason: "malformed-pe-headers" },
  },
  "missing.dll": {
    error: { code: "file-not-found", message: "There is no file." },
  },
  "folder.dll": { error: { code: "not-a-file", message: "It is a folder." } },
  "locked.dll": {
    error: { code: "file-unreadable", message: "Access denied." },
  },
  "crash.dll": { error: { code: "internal-error", message: "boom" } },
  "odd-kind.dll": { result: { kind: "elf", machine: "Amd64" } },
  "odd-reason.dll": { result: { kind: "not-pe", reason: "too-blue" } },
};

serve((request) =>
  request.command === "classify"
    ? { id: request.id, ...answers[basename(request.params.path)] }
    : undefined,
);
