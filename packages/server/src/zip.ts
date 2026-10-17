// A zip archive (PKWARE's APPNOTE.TXT, version 2.0), written as a stream:
// each file deflated as it is read from disk, never held whole in memory, so
// a Recovered Solution is sent as it is zipped, however large.

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createDeflateRaw } from "node:zlib";

/** One file to put in a zip archive. */
export interface ZipEntry {
  /** Its path in the archive, with `/` between names. */
  readonly name: string;
  /** Where it is on disk. */
  readonly path: string;
  /** How many bytes it is. */
  readonly size: number;
  /** When it was last changed. */
  readonly modified: Date;
}

/** The most a field of a zip archive without its ZIP64 extension holds. */
const MAX_32 = 0xffff_ffff;
const MAX_16 = 0xffff;

// Bit 3: each file's CRC-32 and sizes follow its data, as they are known
// only once it has been read. Bit 11: names are UTF-8.
const FLAGS = 0x0808;
const DEFLATE = 8;
// 2.0: deflated, and in folders.
const VERSION = 20;
// Made on Unix, as 2.0: Info-ZIP's `unzip` reads the names of files made on
// MS-DOS as its code page 437, whatever bit 11 says.
const MADE_BY = (3 << 8) | VERSION;
// On Unix, a file that its owner can read and write, and anyone can read.
const ATTRIBUTES = (0o100644 << 16) >>> 0;

const LOCAL_HEADER = 30;
const DATA_DESCRIPTOR = 16;
const CENTRAL_HEADER = 46;
const END_OF_CENTRAL_DIRECTORY = 22;

/**
 * Whether `entries` fit in a zip archive without its ZIP64 extension: no
 * more than 65,535 files, and, however little deflating them saves, no more
 * than 4 GiB in all.
 */
export function fitsInZip(entries: readonly ZipEntry[]): boolean {
  if (entries.length > MAX_16) {
    return false;
  }
  let bound = END_OF_CENTRAL_DIRECTORY;
  for (const { name, size } of entries) {
    const nameLength = Buffer.byteLength(name);
    if (nameLength > MAX_16) {
      return false;
    }
    bound +=
      LOCAL_HEADER +
      DATA_DESCRIPTOR +
      CENTRAL_HEADER +
      2 * nameLength +
      deflatedBound(size);
  }
  return bound <= MAX_32;
}

/**
 * The most deflating `size` bytes can come to: as stored blocks, which take
 * 5 bytes of their own for each 65,535 bytes at most, allowing for smaller
 * ones, with room to spare.
 */
function deflatedBound(size: number): number {
  return size + 5 * (Math.ceil(size / 16_383) + 1) + 64;
}

/**
 * A zip archive of `entries`, in their order, each deflated, streamed as it
 * is made. Each file is read once, as the archive reaches it. The archive
 * errors if a file cannot be read, or has grown past what
 * {@link fitsInZip} allowed for.
 */
export function zipStream(entries: readonly ZipEntry[]): Readable {
  return Readable.from(zipChunks(entries), { objectMode: false });
}

async function* zipChunks(
  entries: readonly ZipEntry[],
): AsyncGenerator<Buffer> {
  if (!fitsInZip(entries)) {
    throw new Error("The files are too many, or too large, for a zip archive.");
  }
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const [time, date] = dosDateTime(entry.modified);
    const header = Buffer.alloc(LOCAL_HEADER);
    header.writeUInt32LE(0x0403_4b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    // Its CRC-32 and sizes, at 14, 18 and 22, are left 0: they follow it.
    header.writeUInt16LE(name.length, 26);
    yield Buffer.concat([header, name]);

    const { crc, size, deflated } = yield* deflateFile(entry.path);

    const descriptor = Buffer.alloc(DATA_DESCRIPTOR);
    descriptor.writeUInt32LE(0x0807_4b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(checked(deflated), 8);
    descriptor.writeUInt32LE(checked(size), 12);
    yield descriptor;

    const record = Buffer.alloc(CENTRAL_HEADER);
    record.writeUInt32LE(0x0201_4b50, 0);
    record.writeUInt16LE(MADE_BY, 4);
    record.writeUInt16LE(VERSION, 6);
    record.writeUInt16LE(FLAGS, 8);
    record.writeUInt16LE(DEFLATE, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(deflated, 20);
    record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28);
    // No extra field, comment, disk number or internal attributes, at 30 to 37.
    record.writeUInt32LE(ATTRIBUTES, 38);
    record.writeUInt32LE(checked(offset), 42);
    central.push(record, name);

    offset += LOCAL_HEADER + name.length + deflated + DATA_DESCRIPTOR;
  }

  const directory = Buffer.concat(central);
  yield directory;
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(checked(directory.length), 12);
  end.writeUInt32LE(checked(offset), 16);
  yield end;
}

/**
 * Yields the file at `path`, deflated, as it is read; returns its CRC-32 and
 * how many bytes it was, and came to.
 */
async function* deflateFile(
  path: string,
): AsyncGenerator<
  Buffer,
  { readonly crc: number; readonly size: number; readonly deflated: number }
> {
  let crc = 0;
  let size = 0;
  let deflated = 0;
  const deflate = createDeflateRaw();
  const reading = pipeline(
    createReadStream(path),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        yield chunk;
      }
    },
    deflate,
  );
  // An error reading is the archive's; it ends the loop below too.
  reading.catch(() => undefined);
  // Stopped early, as when the archive is no longer wanted, this loop
  // destroys `deflate`, and so `pipeline` the file it was reading.
  for await (const chunk of deflate as AsyncIterable<Buffer>) {
    deflated += chunk.length;
    yield chunk;
  }
  await reading;
  return { crc, size, deflated };
}

function checked(value: number): number {
  if (value > MAX_32) {
    throw new Error(
      "The files have grown too large for a zip archive while it was made.",
    );
  }
  return value;
}

/** `date`'s MS-DOS time and date, as zip archives hold them, in local time, to 2 seconds. */
function dosDateTime(date: Date): [time: number, date: number] {
  // MS-DOS dates begin in 1980.
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return [
    (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  ];
}
