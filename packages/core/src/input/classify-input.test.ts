import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classifyInput } from "./classify-input.js";

// The engine is a Node script run in place of `dotnet Xray.Engine.dll` that
// answers by file name alone (../engine/fakes/classifies.mjs), so these paths
// need not exist.
function classify(path: string): ReturnType<typeof classifyInput> {
  return classifyInput(path, {
    dotnetPath: process.execPath,
    enginePath: fileURLToPath(
      new URL("../engine/fakes/classifies.mjs", import.meta.url),
    ),
  });
}

const folder = resolve("some", "folder");
const ONLY_MANAGED =
  "Xray reconstructs Managed Assemblies only: .exe and .dll files of .NET IL and metadata.";

describe("classifyInput", () => {
  it("accepts a Managed Assembly, resolving its path", async () => {
    expect(await classify(join("some", "folder", "managed.dll"))).toEqual({
      path: join(folder, "managed.dll"),
      kind: "managed-assembly",
      accepted: true,
      explanation:
        '"managed.dll" is a Managed Assembly: it has a CLI header, so it holds the .NET IL and metadata a Reconstruction starts from.',
    });
  });

  it("rejects a Native Executable, explaining why it cannot be reconstructed", async () => {
    expect(await classify(join(folder, "native-x64.exe"))).toEqual({
      path: join(folder, "native-x64.exe"),
      kind: "native-executable",
      accepted: false,
      explanation: [
        '"native-x64.exe" is a Native Executable (x64 machine code), not a Managed Assembly, so Xray cannot reconstruct it.',
        "It has no CLI header: it was compiled straight to machine code (from C, C++, Rust, Go or similar), which discards the types, members and signatures that .NET IL and metadata keep. The most that could be recovered from it is pseudocode, never a C# solution that builds and behaves like the original.",
        ONLY_MANAGED,
      ].join("\n"),
    });
  });

  it.each([
    ["native-arm64.dll", "(Arm64 machine code)"],
    ["native-unknown.exe", "(machine code)"],
  ])("names the architecture of %s where it is known", async (file, code) => {
    const { explanation } = await classify(join(folder, file));

    expect(explanation.split("\n")[0]).toBe(
      `"${file}" is a Native Executable ${code}, not a Managed Assembly, so Xray cannot reconstruct it.`,
    );
  });

  it.each([
    [
      "notes.txt",
      'it does not start with the "MZ" signature every PE file has',
    ],
    [
      "dos.exe",
      "it has an MS-DOS header but no PE header after it, so at most it is an MS-DOS program",
    ],
    ["truncated.exe", "its PE headers are truncated or corrupt"],
  ])("rejects %s as not a PE file, saying why", async (file, why) => {
    expect(await classify(join(folder, file))).toEqual({
      path: join(folder, file),
      kind: "not-pe",
      accepted: false,
      explanation: [
        `"${file}" is not a PE file: ${why}. It is neither a Managed Assembly nor a Native Executable, so Xray cannot reconstruct it.`,
        ONLY_MANAGED,
      ].join("\n"),
    });
  });

  it.each([
    ["missing.dll", "not-found", "There is no file at {path}."],
    [
      "folder.dll",
      "not-a-file",
      "{path} is a folder; give the path of an Assembly (an .exe or .dll file).",
    ],
    [
      "locked.dll",
      "unreadable",
      "{path} exists but could not be read; check you have permission to read it.",
    ],
  ])(
    "reports %s, which cannot be read, as an InputError",
    async (file, code, message) => {
      const path = join(folder, file);

      await expect(classify(path)).rejects.toMatchObject({
        name: "InputError",
        code,
        message: message.replace("{path}", path),
      });
    },
  );

  it("passes on any other engine failure", async () => {
    await expect(classify(join(folder, "crash.dll"))).rejects.toMatchObject({
      name: "EngineError",
      code: "request-failed",
      engineCode: "internal-error",
    });
  });

  it.each(["odd-kind.dll", "odd-reason.dll"])(
    "reports an answer it does not understand (%s) as a protocol violation",
    async (file) => {
      await expect(classify(join(folder, file))).rejects.toMatchObject({
        name: "EngineError",
        code: "protocol-violation",
        message: expect.stringContaining(
          `The Xray engine's answer to "classify" was malformed: `,
        ) as unknown,
      });
    },
  );
});
