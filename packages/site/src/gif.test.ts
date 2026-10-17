import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodePng, encodeGif } from "./gif.js";

/** A PNG of `rows` of 8-bit pixels of `channels`, each row filtered as `filters` says. */
function png(
  rows: readonly (readonly number[])[],
  channels: 3 | 4,
  filters: readonly number[],
): Buffer {
  const width = (rows[0]?.length ?? 0) / channels;
  const filtered = rows.flatMap((row, y) => {
    const filter = filters[y] ?? 0;
    const above = rows[y - 1] ?? row.map(() => 0);
    return [
      filter,
      ...row.map((byte, x) => {
        const left = x >= channels ? (row[x - channels] ?? 0) : 0;
        const up = above[x] ?? 0;
        const upLeft = x >= channels ? (above[x - channels] ?? 0) : 0;
        const predicted = [
          0,
          left,
          up,
          (left + up) >> 1,
          paeth(left, up, upLeft),
        ][filter] as number;
        return (byte - predicted) & 0xff;
      }),
    ];
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows.length, 4);
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(filtered))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A chunk, its CRC left zero: decodePng does not check it. */
function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([
    length,
    Buffer.from(type, "latin1"),
    body,
    Buffer.alloc(4),
  ]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const [a, b, c] = [
    Math.abs(p - left),
    Math.abs(p - up),
    Math.abs(p - upLeft),
  ];
  return a <= b && a <= c ? left : b <= c ? up : upLeft;
}

const RGBA_ROWS = [
  [10, 20, 30, 255, 200, 100, 50, 128],
  [11, 250, 3, 255, 0, 1, 2, 3],
  [90, 80, 70, 60, 255, 255, 255, 255],
  [7, 140, 21, 0, 33, 66, 99, 132],
  [1, 2, 3, 4, 250, 240, 230, 220],
];

describe("decodePng", () => {
  it("reads 8-bit RGBA rows filtered each way PNG filters them", () => {
    const image = decodePng(png(RGBA_ROWS, 4, [0, 1, 2, 3, 4]));

    expect(image).toMatchObject({ width: 2, height: 5 });
    expect([...image.rgba]).toEqual(RGBA_ROWS.flat());
  });

  it("reads 8-bit RGB, opaque", () => {
    const rows = [
      [1, 2, 3, 4, 5, 6],
      [200, 150, 100, 50, 25, 12],
    ];
    const image = decodePng(png(rows, 3, [4, 3]));

    expect([...image.rgba]).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255, 200, 150, 100, 255, 50, 25, 12, 255,
    ]);
  });

  it("refuses what is not a PNG", () => {
    expect(() => decodePng(Buffer.from("GIF89a"))).toThrow("Not a PNG.");
  });
});

describe("encodeGif", () => {
  it("writes an animated GIF of the frames", () => {
    const frame = png(RGBA_ROWS, 4, [0, 0, 0, 0, 0]);
    const gif = Buffer.from(
      encodeGif([
        { png: frame, delay: 100 },
        { png: frame, delay: 2000 },
      ]),
    );

    expect(gif.toString("latin1", 0, 6)).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(2);
    expect(gif.readUInt16LE(8)).toBe(5);
    expect(gif.at(-1)).toBe(0x3b);
  });
});
