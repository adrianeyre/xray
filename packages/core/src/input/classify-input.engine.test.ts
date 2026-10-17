import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFixture, NATIVE_EXECUTABLE_FIXTURE } from "@xray/fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyInput } from "./classify-input.js";

// These run the real engine, built by the global setup (../engine/build-engine.ts),
// on real files: a built Fixture, the committed native Fixture, and files of our own.

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "xray-classify-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** 4 KiB that look random but are the same on every run. */
function noise(): Buffer {
  return Buffer.concat(
    Array.from({ length: 128 }, (_, i) =>
      createHash("sha256").update(`xray #8 noise ${i}`).digest(),
    ),
  );
}

describe("classifyInput (against the real engine)", () => {
  it(
    "accepts the arithmetic Fixture as a Managed Assembly",
    async () => {
      const { assemblyPath } = await buildFixture("arithmetic");

      expect(await classifyInput(assemblyPath)).toEqual({
        path: assemblyPath,
        kind: "managed-assembly",
        accepted: true,
        explanation:
          '"Arithmetic.dll" is a Managed Assembly: it has a CLI header, so it holds the .NET IL and metadata a Reconstruction starts from.',
      });
    },
    5 * 60_000,
  );

  it("rejects the native Fixture as an x64 Native Executable, explaining why", async () => {
    const classification = await classifyInput(NATIVE_EXECUTABLE_FIXTURE);

    expect(classification).toMatchObject({
      path: NATIVE_EXECUTABLE_FIXTURE,
      kind: "native-executable",
      accepted: false,
    });
    expect(classification.explanation).toMatch(
      /^"hello\.exe" is a Native Executable \(x64 machine code\), not a Managed Assembly, so Xray cannot reconstruct it\.\nIt has no CLI header/,
    );
  });

  it("rejects a text file as not a PE file", async () => {
    const path = join(scratch, "notes.txt");
    await writeFile(path, "Not an Assembly, just some text.\n");

    expect(await classifyInput(path)).toMatchObject({
      kind: "not-pe",
      accepted: false,
      explanation: expect.stringMatching(
        /^"notes\.txt" is not a PE file: it does not start with the "MZ" signature/,
      ) as unknown,
    });
  });

  it("rejects random bytes as not a PE file", async () => {
    const path = join(scratch, "random.dll");
    const bytes = noise();
    expect(bytes.subarray(0, 2).toString("latin1")).not.toBe("MZ");
    await writeFile(path, bytes);

    expect(await classifyInput(path)).toMatchObject({
      kind: "not-pe",
      accepted: false,
    });
  });

  it("reports a missing file", async () => {
    const path = join(scratch, "no-such-file.exe");

    await expect(classifyInput(path)).rejects.toMatchObject({
      name: "InputError",
      code: "not-found",
      message: `There is no file at ${path}.`,
    });
  });

  it("reports a folder", async () => {
    await expect(classifyInput(scratch)).rejects.toMatchObject({
      name: "InputError",
      code: "not-a-file",
    });
  });
});
