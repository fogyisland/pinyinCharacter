/**
 * A minimal PNG encoder for the worksheet rasteriser.
 *
 * NODE ONLY. It compresses the image with `node:zlib`, which no client
 * component can import — keep this module on the server side and hand the
 * resulting bytes to the browser.
 *
 * The encoder writes the simplest PNG there is: 8-bit RGBA, no interlacing
 * and no per-scanline filtering. The worksheets are flat colour on flat
 * paper, so the deflate stream is small enough without a smarter filter,
 * and "one filter type, no special cases" is worth more here than a few
 * kilobytes.
 */

import { deflate, type ZlibOptions } from 'node:zlib';
import type { Canvas } from './raster';

/** The eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bit depth of the written pixels: 8 bits per channel. */
const BIT_DEPTH = 8;

/** Colour type 6 is truecolour with an alpha channel (RGBA). */
const COLOR_TYPE_RGBA = 6;

/**
 * The CRC table of the PNG specification, built once when the module loads.
 *
 * Every chunk carries a CRC over its type and its data, so the table is
 * worth computing up front instead of per chunk.
 */
const CRC_TABLE = buildCrcTable();

/**
 * Encodes a canvas as a PNG file.
 *
 * The compression runs on libuv's thread pool (see `deflateAsync`), so a big
 * sheet does not block the event loop: the whole site would stall for the
 * length of the compression otherwise.
 *
 * @throws If the canvas buffer does not match its declared size.
 */
export async function encodePng(canvas: Canvas): Promise<Uint8Array> {
  const stride = canvas.width * 4;
  if (canvas.data.length !== stride * canvas.height) {
    throw new Error(
      `Canvas buffer holds ${canvas.data.length} bytes, expected ${stride * canvas.height} for ${canvas.width}x${canvas.height}.`,
    );
  }
  const imageData = encodeImageData(canvas, stride);
  const compressed = await deflateAsync(imageData, { level: 9 });
  return concat([
    PNG_SIGNATURE,
    buildHeader(canvas.width, canvas.height),
    buildChunk('IDAT', compressed),
    buildChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Compress with zlib's asynchronous API.
 *
 * The bytes are the ones `deflateSync` writes — the same zlib, the same
 * options — but the work happens on the thread pool instead of on the main
 * thread.
 */
function deflateAsync(data: Uint8Array, options: ZlibOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    deflate(data, options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Builds the IHDR chunk: the size and the format of the image.
 */
function buildHeader(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = BIT_DEPTH;
  data[9] = COLOR_TYPE_RGBA;
  data[10] = 0; // compression method: deflate
  data[11] = 0; // filter method: adaptive
  data[12] = 0; // interlace method: none
  return buildChunk('IHDR', data);
}

/**
 * Lays the pixels out the way the PNG format wants them: every scanline is
 * prefixed with the type of the filter that was applied to it. Filter type 0
 * means "no filter", so the byte is simply a zero.
 */
function encodeImageData(canvas: Canvas, stride: number): Uint8Array {
  const raw = new Uint8Array((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const target = y * (stride + 1);
    raw[target] = 0;
    raw.set(canvas.data.subarray(y * stride, (y + 1) * stride), target + 1);
  }
  return raw;
}

/**
 * Wraps a payload into a PNG chunk: length, type, data and the CRC over
 * the type and the data.
 */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * The CRC-32 of the PNG specification: the reflected IEEE polynomial
 * `0xedb88320`, with the result inverted at both ends.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
