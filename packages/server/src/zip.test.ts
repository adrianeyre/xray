import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buffer } from "node:stream/consumers";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractZip, readZip } from "./test-zip.js";
import { fitsInZip, zipStream, type ZipEntry } from "./zip.js";

// The zip archive the server sends a Recovered Solution as, read back
// strictly, and by the system's own tool.

let folder: string;

beforeEach(async () => {
  // Its real path, as the system names the files a process has open.
  folder = await realpath(await mkdtemp(join(tmpdir(), "xray-zip-test-")));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** Writes `files` below the test's folder, and the entries that zip them, by the same names. */
async function entriesOf(
  files: Readonly<Record<string, string | Buffer>>,
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  for (const [name, contents] of Object.entries(files)) {
    const path = join(folder, "files", ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
    entries.push({
      name,
      path,
      size: Buffer.byteLength(contents),
      modified: new Date(2026, 9, 8, 6, 44, 54),
    });
  }
  return entries;
}

const FILES: Readonly<Record<string, string | Buffer>> = {
  "App/App.sln":
    "Microsoft Visual Studio Solution File, Format Version 12.00\r\n",
  "App/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n',
  "App/App/Program.cs": "namespace App;\n\ninternal static class Program { }\n",
  "App/App/Généric`1.cs": "class Généric<T> { }\n",
  "App/App/Empty.cs": "",
  "App/App/Random.bin": randomBytes(100_000),
};

describe("zipStream", () => {
  it("zips every file, in order, deflated, under its name in UTF-8, each exactly as it was", async () => {
    const entries = await entriesOf(FILES);

    const zipped = readZip(await buffer(zipStream(entries)));

    expect(zipped.map((file) => file.name)).toEqual(Object.keys(FILES));
    for (const file of zipped) {
      expect(
        file.contents.equals(Buffer.from(FILES[file.name] ?? "")),
        file.name,
      ).toBe(true);
      expect(file.method, file.name).toBe(8);
      // Its CRC-32 and sizes after its data; its name in UTF-8.
      expect(file.flags, file.name).toBe(0x0808);
      expect(file.modified, file.name).toEqual(new Date(2026, 9, 8, 6, 44, 54));
    }
  });

  it("deflates text, as source files are, to much less than it was", async () => {
    const source = "    public static int Add(int a, int b) => a + b;\n".repeat(
      10_000,
    );
    const entries = await entriesOf({ "App/Large.cs": source });

    const zip = await buffer(zipStream(entries));

    expect(zip.length).toBeLessThan(source.length / 20);
    expect(readZip(zip)[0]?.contents.toString("utf8")).toBe(source);
  });

  it("zips an archive of no files", async () => {
    expect(readZip(await buffer(zipStream([])))).toEqual([]);
  });

  it("zips a large file whole, sending it as it is read", async () => {
    // 48 MiB, far larger than any Recovered Solution's file, half of it not compressible.
    const large = Buffer.concat([
      randomBytes(24 * 1024 * 1024),
      Buffer.alloc(24 * 1024 * 1024, "a"),
    ]);
    const entries = await entriesOf({ "App/Large.bin": large });
    const stream = zipStream(entries);
    let chunks = 0;
    const read: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks++;
      read.push(chunk);
    }

    expect(chunks).toBeGreaterThan(100);
    expect(readZip(Buffer.concat(read))[0]?.contents.equals(large)).toBe(true);
  });

  it("makes an archive the system's own tool extracts, each file as it was", async () => {
    const entries = await entriesOf(FILES);
    const zip = join(folder, "App.zip");
    await writeFile(zip, await buffer(zipStream(entries)));
    const into = join(folder, "extracted");
    await mkdir(into);

    await extractZip(zip, into);

    for (const [name, contents] of Object.entries(FILES)) {
      expect(
        (await readFile(join(into, ...name.split("/")))).equals(
          Buffer.from(contents),
        ),
        name,
      ).toBe(true);
    }
  });

  it("keeps when each file was last changed, to 2 seconds, as zip archives do", async () => {
    const [entry] = await entriesOf({
      "App/Program.cs": "class Program { }\n",
    });
    const modified = new Date(2024, 1, 29, 23, 59, 59);

    const [file] = readZip(
      await buffer(zipStream([{ ...(entry as ZipEntry), modified }])),
    );

    expect(file?.modified).toEqual(new Date(2024, 1, 29, 23, 59, 58));
  });

  it("errors, rather than ending as if whole, when a file cannot be read", async () => {
    const entries = await entriesOf(FILES);
    await rm((entries[2] as ZipEntry).path);

    await expect(buffer(zipStream(entries))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("stops reading, and closes the file it was reading, once the archive is no longer wanted", async ({
    skip,
  }) => {
    const entries = await entriesOf({
      "App/Large.bin": randomBytes(16 * 1024 * 1024),
    });
    const path = (entries[0] as ZipEntry).path;
    const stream = zipStream(entries);
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    // Only Linux says, in /proc, which files a process has open.
    const open = await openFiles();
    if (open === undefined) {
      skip();
    }
    expect(open).toContain(path);

    await iterator.return?.();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(stream.destroyed).toBe(true);
    expect(await openFiles()).not.toContain(path);
  });

  it("refuses files that have grown past what fitsInZip allowed for", async () => {
    const [entry] = await entriesOf({
      "App/Program.cs": "class Program { }\n",
    });

    // Claimed to be all a zip archive holds, so any more cannot fit.
    await expect(
      buffer(zipStream([{ ...(entry as ZipEntry), size: 0xffff_ffff }])),
    ).rejects.toThrow(
      "The files are too many, or too large, for a zip archive.",
    );
  });
});

/** The real paths of the files this process has open, where the system says; `undefined` where it does not. */
async function openFiles(): Promise<string[] | undefined> {
  let descriptors: string[];
  try {
    descriptors = await readdir("/proc/self/fd");
  } catch {
    return undefined;
  }
  const paths = await Promise.all(
    descriptors.map((fd) =>
      readlink(join("/proc/self/fd", fd)).catch(() => ""),
    ),
  );
  return paths.filter((path) => path !== "");
}

describe("fitsInZip", () => {
  const entry = (size: number, name = "App/Program.cs"): ZipEntry => ({
    name,
    path: "/nowhere",
    size,
    modified: new Date(),
  });

  it("fits a Recovered Solution of any size it is likely to be", () => {
    expect(fitsInZip([])).toBe(true);
    expect(
      fitsInZip(Array.from({ length: 10_000 }, () => entry(100_000))),
    ).toBe(true);
    expect(fitsInZip([entry(3.9 * 1024 ** 3)])).toBe(true);
  });

  it("does not fit more than 4 GiB, however little deflating saves", () => {
    expect(fitsInZip([entry(0xffff_ffff)])).toBe(false);
    expect(fitsInZip([entry(2 * 1024 ** 3), entry(2 * 1024 ** 3)])).toBe(false);
  });

  it("does not fit more than 65,535 files", () => {
    expect(fitsInZip(Array.from({ length: 65_535 }, () => entry(0)))).toBe(
      true,
    );
    expect(fitsInZip(Array.from({ length: 65_536 }, () => entry(0)))).toBe(
      false,
    );
  });

  it("does not fit a name longer than 65,535 bytes", () => {
    expect(fitsInZip([entry(0, "é".repeat(32_768))])).toBe(false);
  });
});
