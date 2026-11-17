import GIF from "omggif";

import { Gif } from "./gif.js";
import { GifFrame } from "./types.js";

const MAX_PALETTE_SIZE = 256;

interface QuantizedFrame {
  palette: number[];
  indexedPixels: Uint8Array;
  transparentIndex: number | null;
}

/**
 * Encodes a decoded (and possibly re-processed) GIF back into a GIF buffer.
 *
 * Each frame is quantized to its own local color table, so frames keep the
 * exact animation timing (per-frame delays) and loop settings that were read
 * from the source file. Frames are written as full-canvas images with
 * "do not dispose", which plays identically to the composited bitmaps.
 */
export function encodeGif(gif: Gif): Buffer {
  const frames = gif.frames;
  const writer = createWriter(gif, frames);

  for (const frame of frames) {
    writeFrame(writer, frame);
  }

  const end = writer.gifWriter.end();
  return writer.buffer.subarray(0, end);
}

interface WriterState {
  gifWriter: GIF.GifWriter;
  buffer: Buffer;
}

function createWriter(gif: Gif, frames: GifFrame[]): WriterState {
  // Estimated upper bound: raw indexed pixels per frame plus per-frame and
  // global overhead. The buffer grows automatically if the estimate is short.
  const perFrame = gif.outputWidth * gif.outputHeight + 1024;
  const buffer = Buffer.alloc(perFrame * frames.length + 768);

  const options: GIF.GifOptions = {};
  // omggif only writes the Netscape loop extension when a loop count exists.
  // A source GIF without a loop instruction plays once, which we preserve by
  // omitting the option entirely for null loop counts.
  if (gif.loopCount !== null) {
    options.loop = gif.loopCount;
  }

  const gifWriter = new GIF.GifWriter(
    buffer,
    gif.outputWidth,
    gif.outputHeight,
    options,
  );

  return { gifWriter, buffer };
}

function writeFrame(writer: WriterState, frame: GifFrame): void {
  const { width, height } = frame.bitmap;
  const quantized = quantize(frame.bitmap.data);
  const options: GIF.FrameOptions = {
    palette: quantized.palette,
    // GIF delays are unsigned 16-bit values in hundredths of a second.
    delay: clampDelay(frame.delayCentisecs),
    // Frames are independent full bitmaps, so nothing is disposed between
    // frames.
    disposal: 1,
  };

  if (quantized.transparentIndex !== null) {
    options.transparent = quantized.transparentIndex;
  }

  // omggif accepts any indexable sequence of palette indices; its type
  // declaration is just narrower than its runtime implementation.
  const indexedPixels = quantized.indexedPixels as unknown as number[];

  let start = writer.gifWriter.getOutputBufferPosition();
  let end = writer.gifWriter.addFrame(
    0,
    0,
    width,
    height,
    indexedPixels,
    options,
  );

  // Grow the output buffer and retry the frame if the estimate was too small.
  while (end >= writer.buffer.length - 1) {
    const bigger = Buffer.alloc(writer.buffer.length * 2);
    writer.buffer.copy(bigger);
    writer.buffer = bigger;
    writer.gifWriter.setOutputBuffer(bigger);
    writer.gifWriter.setOutputBufferPosition(start);
    start = writer.gifWriter.getOutputBufferPosition();
    end = writer.gifWriter.addFrame(
      0,
      0,
      width,
      height,
      indexedPixels,
      options,
    );
  }
}

function clampDelay(delayCentisecs: number): number {
  if (!Number.isFinite(delayCentisecs) || delayCentisecs < 0) {
    return 0;
  }

  return Math.min(0xffff, Math.round(delayCentisecs));
}

/**
 * Reduces an RGBA bitmap to palette-indexed pixels using median cut. Exact
 * colors are kept whenever they fit into a GIF color table; otherwise the
 * closest palette entry is used. Transparent pixels (alpha 0) share a reserved
 * palette slot and become the GIF's transparent index.
 */
export function quantize(data: Buffer): QuantizedFrame {
  const pixelCount = data.length / 4;
  const opaqueColors = new Set<number>();
  let hasTransparency = false;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      hasTransparency = true;
    } else {
      opaqueColors.add(readRgb(data, i));
    }
  }

  const maxOpaqueColors = hasTransparency
    ? MAX_PALETTE_SIZE - 1
    : MAX_PALETTE_SIZE;

  let colors: number[];
  if (opaqueColors.size <= maxOpaqueColors) {
    colors = [...opaqueColors];
  } else {
    colors = medianCut([...opaqueColors], maxOpaqueColors);
  }

  // Color tables must have a power-of-two size (minimum two entries). The
  // transparent color takes the final slot.
  let paletteSize = 2;
  while (paletteSize < colors.length + (hasTransparency ? 1 : 0)) {
    paletteSize <<= 1;
  }

  const palette = new Array<number>(paletteSize).fill(0);
  colors.forEach((color, index) => {
    palette[index] = color;
  });
  const transparentIndex = hasTransparency ? paletteSize - 1 : null;

  const exactIndex = new Map<number, number>();
  palette.forEach((color, index) => {
    exactIndex.set(color, index);
  });
  const nearestCache = new Map<number, number>();

  const indexedPixels = new Uint8Array(pixelCount);
  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    if (hasTransparency && data[i + 3] === 0) {
      indexedPixels[p] = transparentIndex!;
      continue;
    }

    const rgb = readRgb(data, i);
    const exact = exactIndex.get(rgb);
    if (exact !== undefined) {
      indexedPixels[p] = exact;
    } else {
      indexedPixels[p] = nearestColor(rgb, palette, nearestCache);
    }
  }

  return { palette, indexedPixels, transparentIndex };
}

function readRgb(data: Buffer, index: number): number {
  return (
    ((data[index]! << 16) | (data[index + 1]! << 8) | data[index + 2]!) >>> 0
  );
}

/**
 * Median-cut color reduction: repeatedly split the color bucket with the
 * widest channel range along that channel until at most maxColors buckets
 * remain, then average each bucket into one palette color.
 */
function medianCut(colors: number[], maxColors: number): number[] {
  const buckets: number[][] = [colors];

  while (buckets.length < maxColors) {
    let bucketIndex = -1;
    let widestRange = -1;
    let widestChannel = 0;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      if (bucket.length < 2) {
        continue;
      }

      const min = [256, 256, 256];
      const max = [-1, -1, -1];
      for (const color of bucket) {
        const channels = [
          (color >> 16) & 0xff,
          (color >> 8) & 0xff,
          color & 0xff,
        ];
        for (let channel = 0; channel < 3; channel++) {
          min[channel] = Math.min(min[channel]!, channels[channel]!);
          max[channel] = Math.max(max[channel]!, channels[channel]!);
        }
      }

      const ranges = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
      let channel = 0;
      for (let c = 1; c < 3; c++) {
        if (ranges[c]! > ranges[channel]!) {
          channel = c;
        }
      }

      if (ranges[channel]! > widestRange) {
        widestRange = ranges[channel]!;
        widestChannel = channel;
        bucketIndex = i;
      }
    }

    if (bucketIndex === -1) {
      break;
    }

    const bucket = buckets.splice(bucketIndex, 1)[0]!;
    const shift = widestChannel === 0 ? 16 : widestChannel === 1 ? 8 : 0;
    bucket.sort((a, b) => ((a >> shift) & 0xff) - ((b >> shift) & 0xff));
    const middle = bucket.length >> 1;
    buckets.push(bucket.slice(0, middle), bucket.slice(middle));
  }

  return buckets.map((bucket) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    for (const color of bucket) {
      red += (color >> 16) & 0xff;
      green += (color >> 8) & 0xff;
      blue += color & 0xff;
    }

    const count = bucket.length;
    return (
      ((Math.round(red / count) << 16) |
        (Math.round(green / count) << 8) |
        Math.round(blue / count)) >>>
      0
    );
  });
}

function nearestColor(
  rgb: number,
  palette: number[],
  cache: Map<number, number>,
): number {
  const cached = cache.get(rgb);
  if (cached !== undefined) {
    return cached;
  }

  const red = (rgb >> 16) & 0xff;
  const green = (rgb >> 8) & 0xff;
  const blue = rgb & 0xff;

  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i]!;
    const dr = red - ((color >> 16) & 0xff);
    const dg = green - ((color >> 8) & 0xff);
    const db = blue - (color & 0xff);
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      if (distance === 0) {
        break;
      }
    }
  }

  cache.set(rgb, bestIndex);
  return bestIndex;
}
