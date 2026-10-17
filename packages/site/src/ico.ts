/** One picture of an icon: a square PNG, `size` pixels a side. */
export interface IcoImage {
  readonly size: number;
  readonly png: Uint8Array;
}

/**
 * A Windows icon (`.ico`) holding `images`, each as the PNG it is, which every
 * browser since Internet Explorer 9 reads: a 6-byte header, a 16-byte entry
 * for each picture, then the pictures.
 */
export function encodeIco(images: readonly IcoImage[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    if (size < 1 || size > 256) {
      throw new Error(`An icon is 1 to 256 pixels a side, not ${size}.`);
    }
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0); // width: 0 means 256
    entry.writeUInt8(size % 256, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}
