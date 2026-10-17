import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inspectAssembly } from "./inspect-assembly.js";
import { toInspectJson } from "./inspect-json.js";

// The engine is a Node script run in place of `dotnet Xray.Engine.dll` that
// answers by file name alone (../engine/fakes/inspects.mjs), so these paths
// need not exist.
function inspect(path: string): ReturnType<typeof inspectAssembly> {
  return inspectAssembly(path, {
    dotnetPath: process.execPath,
    enginePath: fileURLToPath(
      new URL("../engine/fakes/inspects.mjs", import.meta.url),
    ),
  });
}

const folder = resolve("some", "folder");

describe("inspectAssembly", () => {
  it("summarizes a Managed Assembly, resolving its path", async () => {
    const path = join(folder, "app.dll");

    expect(await inspect(join("some", "folder", "app.dll"))).toEqual({
      accepted: true,
      classification: {
        path,
        kind: "managed-assembly",
        accepted: true,
        explanation: expect.stringMatching(
          /^"app\.dll" is a Managed Assembly/,
        ) as unknown,
      },
      summary: {
        path,
        assembly: {
          name: "App",
          version: "1.2.3.4",
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
        entryPoint: { type: "App.Program", method: "Main" },
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
        counts: { types: 2, methods: 3, resources: 1 },
        pdb: { status: "none" },
        obfuscation: { status: "clean", indicators: [] },
      },
    });
  });

  it("checks the PDB beside the Assembly, named after it, and says whether it is its own", async () => {
    const beside = await mkdtemp(join(tmpdir(), "xray-inspect-"));
    try {
      await writeFile(join(beside, "app.pdb"), "");

      const inspection = await inspect(join(beside, "app.dll"));

      expect(inspection.accepted && inspection.summary.pdb).toEqual({
        status: "matching",
        path: join(beside, "app.pdb"),
        format: "portable",
      });
    } finally {
      await rm(beside, { recursive: true, force: true });
    }
  });

  it.each([
    ["native.exe", "native-executable"],
    ["notes.txt", "not-pe"],
  ])(
    "does not inspect %s, which is not a Managed Assembly, but says why",
    async (file, kind) => {
      // The fake fails "inspect" on these files, so asking would reject.
      expect(await inspect(join(folder, file))).toEqual({
        accepted: false,
        classification: {
          path: join(folder, file),
          kind,
          accepted: false,
          explanation: expect.stringContaining(
            "so Xray cannot reconstruct it.",
          ) as unknown,
        },
      });
    },
  );

  it.each([
    ["missing.dll", "not-found", "There is no file at {path}."],
    ["vanishes.dll", "not-found", "There is no file at {path}."],
    [
      "corrupt.dll",
      "invalid-metadata",
      "{path} has a CLI header, but its .NET metadata could not be read: it is corrupt, or it is a module without an assembly manifest.",
    ],
  ])(
    "reports %s, which cannot be read, as an InputError",
    async (file, code, message) => {
      const path = join(folder, file);

      await expect(inspect(path)).rejects.toMatchObject({
        name: "InputError",
        code,
        message: message.replace("{path}", path),
      });
    },
  );

  it("passes on any other engine failure", async () => {
    await expect(inspect(join(folder, "crash.dll"))).rejects.toMatchObject({
      name: "EngineError",
      code: "request-failed",
      engineCode: "internal-error",
    });
  });

  it("reports an answer it does not understand as a protocol violation", async () => {
    await expect(inspect(join(folder, "odd.dll"))).rejects.toMatchObject({
      name: "EngineError",
      code: "protocol-violation",
      message: expect.stringContaining(
        `The Xray engine's answer to "inspect" was malformed: `,
      ) as unknown,
    });
  });
});

describe("toInspectJson", () => {
  it("puts the schema version first, then the summary", async () => {
    const inspection = await inspect(join(folder, "app.dll"));
    if (!inspection.accepted) {
      throw new Error("app.dll should be accepted.");
    }

    const json = toInspectJson(inspection.summary);

    expect(Object.keys(json)).toEqual([
      "schemaVersion",
      "path",
      "assembly",
      "targetFramework",
      "architecture",
      "entryPoint",
      "outputKind",
      "references",
      "counts",
      "pdb",
      "obfuscation",
    ]);
    expect(json).toEqual({ schemaVersion: 1, ...inspection.summary });
  });
});
