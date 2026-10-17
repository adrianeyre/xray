import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkOutputDirectory,
  prepareOutputDirectory,
} from "./output-directory.js";
import { ReconstructionError } from "./reconstruction-error.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-output-"));
  temporary.push(folder);
  return folder;
}

const input = join(tmpdir(), "elsewhere", "App.dll");

describe("checkOutputDirectory", () => {
  it("allows a folder that does not exist yet, or is empty", async () => {
    const folder = await scratch();

    await expect(
      checkOutputDirectory(join(folder, "new", "out"), input, false),
    ).resolves.toBeUndefined();
    await expect(
      checkOutputDirectory(folder, input, false),
    ).resolves.toBeUndefined();
  });

  it("refuses a folder that is not empty, unless forced", async () => {
    const folder = await scratch();
    await writeFile(join(folder, "notes.txt"), "");

    const error: unknown = await checkOutputDirectory(
      folder,
      input,
      false,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReconstructionError);
    expect(error).toMatchObject({
      code: "output-not-empty",
      message: `${folder} is not empty. Choose an empty or new folder, or pass --force to replace what is in it.`,
    });
    await expect(
      checkOutputDirectory(folder, input, true),
    ).resolves.toBeUndefined();
  });

  it("refuses a file", async () => {
    const file = join(await scratch(), "out");
    await writeFile(file, "");

    await expect(checkOutputDirectory(file, input, true)).rejects.toMatchObject(
      {
        code: "output-not-a-folder",
        message: `${file} is a file; give the path of a folder to write the Recovered Solution to.`,
      },
    );
  });

  it("refuses, even when forced, to replace a folder holding the input Assembly", async () => {
    const folder = await scratch();
    await mkdir(join(folder, "bin"));
    const assembly = join(folder, "bin", "App.dll");
    await writeFile(assembly, "");

    for (const output of [folder, join(folder, "bin")]) {
      await expect(
        checkOutputDirectory(output, assembly, true),
      ).rejects.toMatchObject({
        code: "output-holds-input",
        message: `${output} holds ${assembly}, which replacing its contents would delete. Choose a folder that does not hold the Assembly.`,
      });
    }
    // A sibling folder is fine.
    await mkdir(join(folder, "out"));
    await writeFile(join(folder, "out", "old.txt"), "");
    await expect(
      checkOutputDirectory(join(folder, "out"), assembly, true),
    ).resolves.toBeUndefined();
  });

  it("sees through a link to the folder holding the input", async () => {
    const folder = await scratch();
    const assembly = join(folder, "App.dll");
    await writeFile(assembly, "");
    const link = join(await scratch(), "link");
    // A junction on Windows, which needs no privileges; a symbolic link elsewhere.
    await symlink(folder, link, "junction");

    await expect(
      checkOutputDirectory(link, assembly, true),
    ).rejects.toMatchObject({ code: "output-holds-input" });
  });
});

describe("prepareOutputDirectory", () => {
  it("creates a folder that does not exist yet, with its parents", async () => {
    const output = join(await scratch(), "a", "b");

    await prepareOutputDirectory(output);

    expect(await readdir(output)).toEqual([]);
  });

  it("empties a folder that has things in it", async () => {
    const output = await scratch();
    await mkdir(join(output, "Old", "Deep"), { recursive: true });
    await writeFile(join(output, "Old", "Deep", "Stale.cs"), "");
    await writeFile(join(output, "notes.txt"), "");

    await prepareOutputDirectory(output);

    expect(await readdir(output)).toEqual([]);
  });
});
