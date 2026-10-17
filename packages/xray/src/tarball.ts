// For the package's tests: reads a packed tarball as npm's registry and
// installers do, rather than taking `pnpm pack`'s word for what it holds.

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const BLOCK = 512;

/** Each file in the gzipped tarball at `path`, by its path within it, and its contents. */
export async function readTarball(
  path: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const tar = gunzipSync(await readFile(path));
  const files = new Map<string, Buffer>();
  let paxPath: string | undefined;
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    // Two blocks of zeros end the archive; one is enough to stop at.
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const size = Number.parseInt(field(header, 124, 12) || "0", 8);
    const type = field(header, 156, 1) || "0";
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      // A pax header: its `path` record, if any, names the next entry.
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
      continue;
    }
    const prefix = field(header, 345, 155);
    const name =
      paxPath ??
      (prefix === ""
        ? field(header, 0, 100)
        : `${prefix}/${field(header, 0, 100)}`);
    paxPath = undefined;
    if (type === "0") {
      files.set(name, Buffer.from(body));
    } else if (type !== "5") {
      throw new Error(
        `${path} holds ${name}, of tar type "${type}", not a file.`,
      );
    }
  }
  return files;
}

function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return bytes
    .subarray(0, end === -1 ? length : end)
    .toString("utf8")
    .trim();
}
