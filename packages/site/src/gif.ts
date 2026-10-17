import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";

// For capture-screenshots.ts: turns the PNG screenshots Chromium takes into the
// frames of an animated GIF.

// Required, as Node imports its CommonJS build with no named exports, and Vite
// would otherwise import its ES module, with no default one.
const gifenc = createRequire(import.meta.url)(
  "gifenc",
) as typeof import("gifenc");

export interface Frame {
  /** A PNG, as Chromium screenshots one. */
  readonly png: Buffer;
  /** How long it is shown, in milliseconds. */
  readonly delay: number;
}

/** An animated GIF of `frames`, each of the same size, looping. */
export function encodeGif(frames: readonly Frame[]): Uint8Array {
  const gif = gifenc.GIFEncoder();
  for (const frame of frames) {
    const { width, height, rgba } = decodePng(frame.png);
    const palette = gifenc.quantize(rgba, 256);
    gif.writeFrame(gifenc.applyPalette(rgba, palette), width, height, {
      palette,
      delay: frame.delay,
    });
  }
  gif.finish();
  return gif.bytes();
}

interface Image {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The pixels of a PNG of 8-bit RGB or RGBA, not interlaced: what Chromium writes. */
export function decodePng(png: Buffer): Image {
  if (!png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("Not a PNG.");
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(
          `A PNG of bit depth ${String(depth)}, colour type ${String(colorType)} and interlace ${String(interlace)}: only 8-bit RGB or RGBA, not interlaced, is read.`,
        );
      }
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
  }

  const filtered = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    const line = filtered.subarray(
      y * (stride + 1) + 1,
      (y + 1) * (stride + 1),
    );
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= channels
          ? (pixels[(y - 1) * stride + x - channels] ?? 0)
          : 0;
      const byte = line[x] ?? 0;
      pixels[y * stride + x] =
        (byte +
          (filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : 0)) &
        0xff;
    }
  }

  if (channels === 4) {
    return { width, height, rgba: pixels };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  return toLeft <= toUp && toLeft <= toUpLeft
    ? left
    : toUp <= toUpLeft
      ? up
      : upLeft;
}
