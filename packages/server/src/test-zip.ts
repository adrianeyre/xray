// For the server's tests: a strict reader of the zip archives it sends,
// checking each record against APPNOTE.TXT and every file against its CRC-32;
// and, independently of it, extracting one with the system's own tool, as a
// user would.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { crc32, inflateRawSync } from "node:zlib";

/** A file in a zip archive, as {@link readZip} finds it. */
export interface ZippedFile {
  readonly name: string;
  readonly contents: Buffer;
  /** Its MS-DOS time and date, as a local time. */
  readonly modified: Date;
  /** Its general-purpose flags. */
  readonly flags: number;
  /** How it was compressed: 8 for deflated. */
  readonly method: number;
}

/**
 * Every file in the zip archive `zip`, in the order its central directory
 * lists them. Throws if a record is not where, or what, the format says, if a
 * file's local header disagrees with its central one, or if a file does not
 * inflate to its size and CRC-32; or if anything lies between them.
 */
export function readZip(zip: Buffer): ZippedFile[] {
  const end = zip.length - 22;
  expectSignature(zip, end, 0x0605_4b50, "end of central directory");
  const count = zip.readUInt16LE(end + 10);
  if (zip.readUInt16LE(end + 8) !== count) {
    throw new Error("The end of central directory gives two counts.");
  }
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryOffset = zip.readUInt32LE(end + 16);
  if (directoryOffset + directorySize !== end) {
    throw new Error(
      "The central directory does not end where the end record begins.",
    );
  }
  if (zip.readUInt16LE(end + 20) !== 0) {
    throw new Error("The archive has a comment.");
  }

  const files: ZippedFile[] = [];
  let at = directoryOffset;
  let next = 0;
  for (let index = 0; index < count; index++) {
    expectSignature(zip, at, 0x0201_4b50, `central header ${index}`);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const time = zip.readUInt16LE(at + 12);
    const date = zip.readUInt16LE(at + 14);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;

    if (offset !== next) {
      throw new Error(`"${name}" is not where the file before it ends.`);
    }
    expectSignature(zip, offset, 0x0403_4b50, `"${name}"'s local header`);
    const local = {
      flags: zip.readUInt16LE(offset + 6),
      method: zip.readUInt16LE(offset + 8),
      time: zip.readUInt16LE(offset + 10),
      date: zip.readUInt16LE(offset + 12),
      nameLength: zip.readUInt16LE(offset + 26),
      extra: zip.readUInt16LE(offset + 28),
    };
    const localName = zip.toString(
      "utf8",
      offset + 30,
      offset + 30 + local.nameLength,
    );
    if (
      local.flags !== flags ||
      local.method !== method ||
      local.time !== time ||
      local.date !== date ||
      localName !== name
    ) {
      throw new Error(
        `"${name}"'s local header disagrees with its central one.`,
      );
    }
    const dataStart = offset + 30 + local.nameLength + local.extra;
    const data = zip.subarray(dataStart, dataStart + compressed);
    const contents = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    if (contents.length !== size || crc32(contents) !== crc) {
      throw new Error(`"${name}" does not inflate to its size and CRC-32.`);
    }
    next = dataStart + compressed;
    if ((flags & 0x0008) !== 0) {
      expectSignature(zip, next, 0x0807_4b50, `"${name}"'s data descriptor`);
      if (
        zip.readUInt32LE(next + 4) !== crc ||
        zip.readUInt32LE(next + 8) !== compressed ||
        zip.readUInt32LE(next + 12) !== size
      ) {
        throw new Error(
          `"${name}"'s data descriptor disagrees with its central header.`,
        );
      }
      next += 16;
    }
    files.push({
      name,
      contents,
      modified: new Date(
        (date >> 9) + 1980,
        ((date >> 5) & 0x0f) - 1,
        date & 0x1f,
        time >> 11,
        (time >> 5) & 0x3f,
        (time & 0x1f) * 2,
      ),
      flags,
      method,
    });
  }
  if (next !== directoryOffset) {
    throw new Error("Something lies between the files and the directory.");
  }
  if (at !== end) {
    throw new Error("The central directory is not the size it says.");
  }
  return files;
}

function expectSignature(
  zip: Buffer,
  at: number,
  signature: number,
  what: string,
): void {
  if (at < 0 || at + 4 > zip.length || zip.readUInt32LE(at) !== signature) {
    throw new Error(`There is no ${what} at ${at}.`);
  }
}

const run = promisify(execFile);

/**
 * Extracts the zip archive at `zip` into the folder `into` with the system's
 * own tool, as a user would: Windows' own `tar`, which reads zip archives
 * (not Git's, which may come first on the PATH, and does not); `unzip`
 * elsewhere, which also checks each file's CRC-32.
 */
export async function extractZip(zip: string, into: string): Promise<void> {
  if (process.platform === "win32") {
    const tar = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "tar.exe",
    );
    await run(tar, ["-xf", zip, "-C", into], { windowsHide: true });
  } else {
    await run("unzip", ["-q", zip, "-d", into]);
  }
}
