import { basename } from "node:path";

import { serve } from "./serve.mjs";

// Answers "classify" and "inspect" by the file's name alone, never reading it
// or the PDB beside it.

const managed = { result: { kind: "managed-assembly", machine: "I386" } };

/** What the real engine reads from a small .NET 8 console program. */
const app = {
  assembly: {
    name: "App",
    version: "1.2.3.4",
    culture: null,
    publicKeyToken: null,
  },
  references: [
    {
      name: "System.Runtime",
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
    {
      name: "System.Console",
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
  ],
  targetFramework: ".NETCoreApp,Version=v8.0",
  targetPlatform: null,
  runtimeVersion: "v4.0.30319",
  machine: "I386",
  pe32Plus: false,
  corFlags: { ilOnly: true, requires32Bit: false, prefers32Bit: false },
  subsystem: "windows-cui",
  entryPoint: { type: "App.Program", method: "Main" },
  typeCount: 2,
  methodCount: 3,
  resourceCount: 1, // Nothing an obfuscator leaves: its names and strings are its source's.
  obfuscation: {
    attributes: [
      "System.Runtime.CompilerServices.CompilationRelaxationsAttribute",
      "System.Runtime.Versioning.TargetFrameworkAttribute",
    ],
    names: {
      count: 5,
      unprintable: 0,
      short: 0,
      unprintableExamples: [],
      shortExamples: [],
    },
    strings: { literals: 3, decoderCalls: 0, decoderTypes: [] },
  },
};

const files = {
  "app.dll": { classify: managed, inspect: { result: app } },
  "native.exe": {
    classify: { result: { kind: "native-executable", machine: "Amd64" } },
  },
  "notes.txt": {
    classify: { result: { kind: "not-pe", reason: "no-dos-header" } },
  },
  "missing.dll": {
    classify: {
      error: { code: "file-not-found", message: "There is no file." },
    },
  },
  // Deleted, or made unreadable, between "classify" and "inspect".
  "vanishes.dll": {
    classify: managed,
    inspect: {
      error: { code: "file-not-found", message: "There is no file." },
    },
  },
  "corrupt.dll": {
    classify: managed,
    inspect: {
      error: { code: "invalid-metadata", message: "Bad metadata." },
    },
  },
  "crash.dll": {
    classify: managed,
    inspect: { error: { code: "internal-error", message: "boom" } },
  },
  "odd.dll": {
    classify: managed,
    inspect: { result: { ...app, typeCount: -1 } },
  },
};

serve((request) => {
  if (request.command !== "classify" && request.command !== "inspect") {
    return undefined;
  }
  const answer = files[basename(request.params.path)]?.[request.command] ?? {
    error: {
      code: "internal-error",
      message: `The fake engine has no answer to "${request.command}" for this file.`,
    },
  };
  // A PDB it is asked to check is the Assembly's own, as the real engine
  // finds of the PDB built with it.
  if (request.command === "inspect" && "result" in answer) {
    const pdb =
      request.params.pdbPath === undefined
        ? null
        : { format: "portable", mismatch: null };
    return { id: request.id, result: { ...answer.result, pdb } };
  }
  return { id: request.id, ...answer };
});
