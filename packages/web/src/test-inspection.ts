// For the web app's tests: the metadata summary of the arithmetic Fixture, as
// `xray inspect --json` prints it, and so as the server sends it.

import type { InspectJson } from "./events.js";

export const ARITHMETIC: InspectJson = {
  schemaVersion: 1,
  path: "/fixtures/arithmetic/Arithmetic.dll",
  assembly: {
    name: "Arithmetic",
    version: "1.0.0.0",
    culture: null,
    publicKeyToken: null,
  },
  targetFramework: {
    moniker: "net8.0",
    frameworkName: ".NETCoreApp,Version=v8.0",
    runtimeVersion: "v4.0.30319",
    inferredFrom: null,
    support: "full",
  },
  architecture: {
    platformTarget: "AnyCPU",
    prefer32Bit: false,
    bitness: "any",
    machine: "I386",
  },
  entryPoint: { type: "Arithmetic.Program", method: "Main" },
  outputKind: "console",
  references: [
    {
      name: "System.Console",
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
    {
      name: "System.Runtime",
      version: "8.0.0.0",
      culture: null,
      publicKeyToken: "b03f5f7f11d50a3a",
    },
  ],
  counts: { types: 1, methods: 9, resources: 0 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};
