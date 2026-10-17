// Reading the files a NuGet package holds from its `.nupkg`, a zip archive
// (APPNOTE.TXT), downloaded whole: only what Dependency Resolution's NuGet
// step needs, so no ZIP64 and no encryption, which `.nupkg`s do not use.

import { inflateRawSync } from "node:zlib";

/** A file a `.nupkg` holds. */
export interface NupkgEntry {
  /** Its path in the package, with `/` between segments, e.g. `lib/net6.0/Newtonsoft.Json.dll`. */
  readonly path: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
// The end record, and the longest comment it can have.
const END_RECORD_SEARCH = 22 + 0xffff;

/**
 * Every file in the `.nupkg` `archive`, by the path its central directory
 * gives it. NuGet escapes some characters in those paths (`%20` for a space,
 * `%2B` for `+`); they are unescaped. Throws if `archive` is not a zip.
 */
export function nupkgEntries(archive: Buffer): NupkgEntry[] {
  const end = findEndRecord(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries: NupkgEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER
    ) {
      throw new Error("Its central directory is cut short or corrupt.");
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    entries.push({
      path: unescape(name),
      method: archive.readUInt16LE(offset + 10),
      compressedSize: archive.readUInt32LE(offset + 20),
      size: archive.readUInt32LE(offset + 24),
      localHeaderOffset: archive.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The contents of `entry`, one of {@link nupkgEntries}`(archive)`. Throws if they cannot be read. */
export function readNupkgEntry(archive: Buffer, entry: NupkgEntry): Buffer {
  const header = entry.localHeaderOffset;
  if (
    header + 30 > archive.length ||
    archive.readUInt32LE(header) !== LOCAL_FILE_HEADER
  ) {
    throw new Error(`The header of ${entry.path} is missing or corrupt.`);
  }
  const start =
    header +
    30 +
    archive.readUInt16LE(header + 26) +
    archive.readUInt16LE(header + 28);
  const data = archive.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) {
    throw new Error(`${entry.path} is cut short.`);
  }
  let contents: Buffer;
  if (entry.method === STORED) {
    contents = data;
  } else if (entry.method === DEFLATED) {
    contents = inflateRawSync(data, { maxOutputLength: entry.size || 1 });
  } else {
    throw new Error(
      `${entry.path} is compressed with method ${entry.method}, which Xray does not read.`,
    );
  }
  if (contents.length !== entry.size) {
    throw new Error(`${entry.path} is not the size its archive says.`);
  }
  return contents;
}

function findEndRecord(archive: Buffer): number {
  const stop = Math.max(0, archive.length - END_RECORD_SEARCH);
  for (let offset = archive.length - 22; offset >= stop; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("It is not a zip archive.");
}

function unescape(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
