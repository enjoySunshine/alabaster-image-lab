import { expect, test, describe } from "vitest";
import { createJimp } from "@jimp/core";
import { getTestImagePath } from "@jimp/test-utils";
import { methods as blitMethods } from "@jimp/plugin-blit";
import { methods as resizeMethods } from "@jimp/plugin-resize";
import omggif from "omggif";

import gif, { Gif, GifBitmap, decodeGif } from "./index.js";

const jimp = createJimp({
  formats: [gif],
  plugins: [resizeMethods, blitMethods],
});

async function readGif(name: "flower.gif" | "animated.gif") {
  return jimp.read(getTestImagePath(name));
}

function gifOf(image: Awaited<ReturnType<typeof readGif>>): Gif {
  const data = image.bitmap as GifBitmap;
  if (!data.gif) {
    throw new Error("decoded bitmap is missing its GIF frame data");
  }
  return data.gif;
}

/**
 * Minimal block-level GIF parser. It does not decode image data, it only walks
 * the GIF structure the same way an independent player would, so tests can
 * assert frame counts, timing and loop settings without trusting our own
 * decoder.
 */
function parseGifStructure(buffer: Buffer) {
  const data = new Uint8Array(buffer);
  let p = 6;
  const width = data[p]! | (data[p + 1]! << 8);
  const height = data[p + 2]! | (data[p + 3]! << 8);
  const packed = data[p + 4]!;
  p += 7;
  if (packed & 0x80) {
    p += 2 ** ((packed & 0x7) + 1) * 3;
  }

  let loopCount: number | null = null;
  const frames: {
    x: number;
    y: number;
    width: number;
    height: number;
    delay: number;
    disposal: number;
    transparentIndex: number | null;
    hasLocalPalette: boolean;
  }[] = [];

  let delay = 0;
  let disposal = 0;
  let transparentIndex: number | null = null;

  const skipSubBlocks = () => {
    while (data[p] !== 0) {
      const size = data[p]!;
      p += 1 + size;
    }
    p += 1;
  };

  while (p < data.length) {
    const block = data[p++]!;
    if (block === 0x3b) {
      break;
    }

    if (block === 0x21) {
      const label = data[p++]!;
      if (label === 0xf9) {
        p += 1;
        const gcePacked = data[p]!;
        delay = data[p + 1]! | (data[p + 2]! << 8);
        transparentIndex = data[p + 3]!;
        p += 4;
        if ((gcePacked & 1) === 0) {
          transparentIndex = null;
        }
        disposal = (gcePacked >> 2) & 0x7;
        p += 1;
      } else if (label === 0xff) {
        const size = data[p]!;
        const appId = buffer.subarray(p + 1, p + 1 + size).toString("latin1");
        p += 1 + size;
        if (appId === "NETSCAPE2.0") {
          const subSize = data[p]!;
          if (subSize === 3 && data[p + 1] === 1) {
            loopCount = data[p + 2]! | (data[p + 3]! << 8);
            p += 4;
            p += 1;
          } else {
            skipSubBlocks();
          }
        } else {
          skipSubBlocks();
        }
      } else {
        skipSubBlocks();
      }
    } else if (block === 0x2c) {
      const x = data[p]! | (data[p + 1]! << 8);
      const y = data[p + 2]! | (data[p + 3]! << 8);
      const frameWidth = data[p + 4]! | (data[p + 5]! << 8);
      const frameHeight = data[p + 6]! | (data[p + 7]! << 8);
      const imagePacked = data[p + 8]!;
      p += 9;
      const hasLocalPalette = !!(imagePacked & 0x80);
      if (hasLocalPalette) {
        p += 2 ** ((imagePacked & 0x7) + 1) * 3;
      }
      p += 1;
      skipSubBlocks();
      frames.push({
        x,
        y,
        width: frameWidth,
        height: frameHeight,
        delay,
        disposal,
        transparentIndex,
        hasLocalPalette,
      });
    } else {
      throw new Error(`Unexpected GIF block 0x${block.toString(16)}`);
    }
  }

  return { width, height, loopCount, frames };
}

/** Encodes an in-memory animated GIF with omggif for building test fixtures. */
function makeTestBitmap(width: number, height: number, colors: number[]) {
  const data = Buffer.alloc(width * height * 4);
  colors.forEach((color, index) => data.writeUInt32BE(color, index * 4));
  return { data, width, height };
}

/** Encodes an in-memory animated GIF with omggif for building test fixtures. */
function makeGif(
  width: number,
  height: number,
  frames: {
    indices: ArrayLike<number>;
    delay?: number;
    transparent?: number;
    disposal?: number;
  }[],
  options: omggif.GifOptions = {},
): Buffer {
  const buffer = Buffer.alloc(4096);
  const writer = new omggif.GifWriter(buffer, width, height, options);
  for (const frame of frames) {
    writer.addFrame(0, 0, width, height, frame.indices as number[], {
      delay: frame.delay ?? 0,
      transparent: frame.transparent,
      disposal: frame.disposal,
    });
  }
  const size = writer.end();
  return buffer.subarray(0, size);
}

describe("GIF", () => {
  test("load GIF", async () => {
    const image = await readGif("flower.gif");
    expect(image.getPixelColor(10, 10)).toBe(0xfefefeff);
  });

  test("load animated GIF", async () => {
    const image = await readGif("animated.gif");
    expect(image.getPixelColor(10, 10)).toBe(0xa1d2f1ff);
  });

  test("export GIF", async () => {
    const image = await readGif("flower.gif");
    const buffer = await image.getBuffer("image/gif");
    expect(buffer.toString()).toMatch(/^GIF/);
  });

  test("single-frame GIF stays a single frame", async () => {
    const image = await readGif("flower.gif");
    const data = gifOf(image);

    expect(data).toBeInstanceOf(Gif);
    expect(data.numFrames).toBe(1);
    expect(data.getFrame(0)).toBe(data.bitmap);

    const buffer = await image.getBuffer("image/gif");
    const structure = parseGifStructure(buffer);
    expect(structure.frames).toHaveLength(1);
  });

  test("exposes frame count, delays and loop count for animated GIF", async () => {
    const image = await readGif("animated.gif");
    const data = gifOf(image);

    expect(data.numFrames).toBe(10);
    expect(data.width).toBe(320);
    expect(data.height).toBe(320);
    expect(data.loopCount).toBe(0);

    // Cross-check against omggif's own raw frame descriptors rather than our
    // compositing layer.
    const output = await image.getBuffer("image/gif");
    const reader = new omggif.GifReader(new Uint8Array(output));
    expect(reader.numFrames()).toBe(10);
    expect(reader.loopCount()).toBe(0);
    expect(
      Array.from(
        { length: reader.numFrames() },
        (_, i) => reader.frameInfo(i).delay,
      ),
    ).toEqual(data.frames.map((frame) => frame.delayCentisecs));

    expect(data.frameInfos.map((info) => info.y)).toEqual([
      0, 51, 68, 23, 10, 10, 42, 62, 31, 31,
    ]);
    expect(data.frameInfos.map((info) => info.height)).toEqual([
      320, 269, 245, 281, 310, 310, 278, 246, 289, 284,
    ]);
  });

  test("every extracted frame is a full composited canvas", async () => {
    const image = await readGif("animated.gif");
    const data = gifOf(image);

    for (const frame of data.frames) {
      expect(frame.bitmap.width).toBe(320);
      expect(frame.bitmap.height).toBe(320);
      expect(frame.bitmap.data.length).toBe(320 * 320 * 4);
    }

    // The second frame only redraws rows 51..319: rows above it must retain
    // the first frame's pixels instead of turning black.
    const first = data.getFrame(0);
    const second = data.getFrame(1);
    const index = (10 * 320 + 10) * 4;
    expect(second.data.readUInt32BE(index)).toBe(
      first.data.readUInt32BE(index),
    );
    expect(second.data.readUInt32BE(index)).toBe(0xa1d2f1ff);

    expect(() => data.getFrame(10)).toThrow(RangeError);
    expect(() => data.getFrame(-1)).toThrow(RangeError);
  });

  test("round trip preserves frame count, delays, loop and frame pixels", async () => {
    const image = await readGif("animated.gif");
    const source = gifOf(image);
    const output = await image.getBuffer("image/gif");

    const structure = parseGifStructure(output);
    expect(structure.width).toBe(320);
    expect(structure.height).toBe(320);
    expect(structure.frames).toHaveLength(10);
    expect(structure.loopCount).toBe(0);
    expect(structure.frames.map((frame) => frame.delay)).toEqual(
      source.frames.map((frame) => frame.delayCentisecs),
    );

    const redecoded = decodeGif(output);
    expect(redecoded.numFrames).toBe(10);
    expect(redecoded.loopCount).toBe(0);
    expect(redecoded.frames.map((frame) => frame.delayCentisecs)).toEqual(
      source.frames.map((frame) => frame.delayCentisecs),
    );

    for (let i = 0; i < source.numFrames; i++) {
      expect(source.getFrame(i).data.equals(redecoded.getFrame(i).data)).toBe(
        true,
      );
    }

    // Re-reading through Jimp yields the same timing information again.
    const reread = await jimp.read(output);
    const rereadGif = gifOf(reread);
    expect(rereadGif.numFrames).toBe(10);
    expect(rereadGif.loopCount).toBe(0);
    expect(rereadGif.frames.map((frame) => frame.delayCentisecs)).toEqual(
      source.frames.map((frame) => frame.delayCentisecs),
    );
  });

  test("resize and blit apply to every frame while timing is retained", async () => {
    const image = await readGif("animated.gif");
    const source = gifOf(image);
    const targetSize = 64;
    const badge = new jimp({ width: 16, height: 16, color: 0xff0000ff });

    for (let i = 0; i < source.numFrames; i++) {
      const frame = jimp.fromBitmap(source.getFrame(i));
      frame.resize({ w: targetSize, h: targetSize });
      frame.composite(badge, targetSize - 16, targetSize - 16);
      source.frames[i]!.bitmap = frame.bitmap;
    }

    const output = await image.getBuffer("image/gif");
    const structure = parseGifStructure(output);
    expect(structure.width).toBe(targetSize);
    expect(structure.height).toBe(targetSize);
    expect(structure.frames).toHaveLength(10);
    expect(structure.loopCount).toBe(0);

    const redecoded = decodeGif(output);
    expect(redecoded.numFrames).toBe(10);
    for (const frame of redecoded.frames) {
      expect(frame.bitmap.width).toBe(targetSize);
      expect(frame.bitmap.height).toBe(targetSize);
      const badgeIndex = ((targetSize - 2) * targetSize + (targetSize - 2)) * 4;
      expect(frame.bitmap.data.readUInt32BE(badgeIndex)).toBe(0xff0000ff);
    }
    expect(redecoded.frames.map((frame) => frame.delayCentisecs)).toEqual(
      source.frames.map((frame) => frame.delayCentisecs),
    );
  });

  test("transparent pixels composite onto previous frames, never black", () => {
    // Frame 0 fills the canvas red using palette index 0. Frame 1 paints only
    // pixel (1, 1) green (index 1) and marks every other pixel transparent
    // (index 2). A correct render keeps red everywhere else instead of
    // flattening the transparent indices to black.
    const width = 4;
    const height = 4;
    const palette = [0xff0000, 0x00ff00, 0x000000, 0x000000];
    const firstIndices = new Uint8Array(width * height).fill(0);
    const secondIndices = new Uint8Array(width * height).fill(2);
    secondIndices[1 * width + 1] = 1;

    const raw = makeGif(
      width,
      height,
      [
        { indices: firstIndices, delay: 5 },
        { indices: secondIndices, delay: 7, transparent: 2 },
      ],
      { loop: 0, palette },
    );

    const decoded = decodeGif(raw);
    expect(decoded.numFrames).toBe(2);
    expect(decoded.getFrameDelay(0)).toBe(5);
    expect(decoded.getFrameDelay(1)).toBe(7);

    const second = decoded.getFrame(1);
    expect(second.data.readUInt32BE(1 * width * 4)).toBe(0xff0000ff);
    expect(second.data.readUInt32BE((1 * width + 1) * 4)).toBe(0x00ff00ff);
    expect(second.data.readUInt32BE(0)).toBe(0xff0000ff);
    for (let i = 3; i < second.data.length; i += 4) {
      expect(second.data[i]).toBe(255);
    }
  });

  test("custom loop count and per-frame delays survive the round trip", async () => {
    const image = await readGif("animated.gif");
    const source = gifOf(image);
    const retimed = new Gif(
      source.width,
      source.height,
      3,
      source.frames.map((frame, index) => ({
        ...frame,
        delayCentisecs: (index + 1) * 2,
      })),
      source.frameInfos,
    );
    (image.bitmap as GifBitmap).gif = retimed;

    const output = await image.getBuffer("image/gif");
    const structure = parseGifStructure(output);
    expect(structure.loopCount).toBe(3);
    expect(structure.frames.map((frame) => frame.delay)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20,
    ]);

    const redecoded = decodeGif(output);
    expect(redecoded.loopCount).toBe(3);
    expect(redecoded.frames.map((frame) => frame.delayCentisecs)).toEqual([
      2, 4, 6, 8, 10, 12, 14, 16, 18, 20,
    ]);
  });

  test("a root-level bitmap operation stays in sync with frame zero", async () => {
    const image = await readGif("animated.gif");
    const source = gifOf(image);
    const originalDelays = source.frames.map((frame) => frame.delayCentisecs);

    // resize() is applied to the Jimp root bitmap only; frame zero must pick
    // the resized bitmap up while the other nine frames remain untouched.
    image.resize({ w: 100, h: 100 });
    const output = await image.getBuffer("image/gif");

    const redecoded = decodeGif(output);
    expect(redecoded.numFrames).toBe(10);
    // Only frame zero changed size, so the canvas keeps fitting 320x320
    // frames while frame zero is written as a 100x100 image descriptor.
    expect(redecoded.outputWidth).toBe(320);
    expect(redecoded.outputHeight).toBe(320);
    expect(redecoded.frameInfos[0]!.width).toBe(100);
    expect(redecoded.frameInfos[0]!.height).toBe(100);
    expect(redecoded.frameInfos[1]!.width).toBe(320);
    // Decoded frames always cover the full canvas regardless of descriptor.
    expect(redecoded.getFrame(0).width).toBe(320);
    expect(redecoded.frames.map((frame) => frame.delayCentisecs)).toEqual(
      originalDelays,
    );
  });

  test("memory and decode time stay within the animated-sticker budget", async () => {
    const image = await readGif("animated.gif");
    const data = gifOf(image);

    // Ten 320x320 RGBA frames occupy about 4 MB of pixel buffers, well inside
    // the "teens of megabytes" budget once decoder overhead is included.
    const frameBytes = data.frames.reduce(
      (total, frame) => total + frame.bitmap.data.length,
      0,
    );
    expect(frameBytes).toBe(10 * 320 * 320 * 4);
    expect(frameBytes).toBeLessThan(20 * 1024 * 1024);

    // Decoding and compositing all ten frames one after another must not scale
    // linearly into hundreds of milliseconds. The bound is deliberately loose
    // for CI machines but still catches a frame-count blow-up.
    const raw = await image.getBuffer("image/gif");
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      const decoded = decodeGif(raw);
      for (let frame = 0; frame < decoded.numFrames; frame++) {
        decoded.getFrame(frame);
      }
    }
    const perRun = (Date.now() - start) / 5;
    expect(perRun).toBeLessThan(500);
  });

  test("disposal methods restore background and previous frames", () => {
    // 2x2 canvas, palette: 0 = red, 1 = green, 2 = blue, 3 = transparent.
    const width = 2;
    const height = 2;
    const palette = [0xff0000, 0x00ff00, 0x0000ff, 0x000000];
    const allRed = [0, 0, 0, 0];
    const greenTop = [1, 1, 3, 3];
    const blueBottom = [3, 3, 2, 2];

    // Frame 1 paints green on top and asks to restore the background
    // (disposal 2); frame 2 paints blue on the bottom.
    const restoreBackground = makeGif(
      width,
      height,
      [
        { indices: allRed },
        { indices: greenTop, transparent: 3, disposal: 2 },
        { indices: blueBottom, transparent: 3 },
      ],
      { loop: 0, palette },
    );

    const decoded2 = decodeGif(restoreBackground);
    const frame2 = decoded2.getFrame(2);
    // The top row was cleared back to transparency after frame 1...
    expect(frame2.data[0 * 4 + 3]).toBe(0);
    expect(frame2.data[1 * 4 + 3]).toBe(0);
    // ...and frame 2 paints its blue bottom row opaquely.
    expect(frame2.data.readUInt32BE(2 * 4)).toBe(0x0000ffff);
    expect(frame2.data.readUInt32BE(3 * 4)).toBe(0x0000ffff);

    // With disposal 3, frame 1's green top is undone by restoring frame 0,
    // so frame 2's transparent top shows red again.
    const restorePrevious = makeGif(
      width,
      height,
      [
        { indices: allRed },
        { indices: greenTop, transparent: 3, disposal: 3 },
        { indices: blueBottom, transparent: 3 },
      ],
      { loop: 0, palette },
    );

    const decoded3 = decodeGif(restorePrevious);
    const frame3 = decoded3.getFrame(2);
    expect(frame3.data.readUInt32BE(0 * 4)).toBe(0xff0000ff);
    expect(frame3.data.readUInt32BE(1 * 4)).toBe(0xff0000ff);
    expect(frame3.data.readUInt32BE(3 * 4)).toBe(0x0000ffff);
  });

  test("a plain bitmap can still be exported as a single-frame GIF", async () => {
    const bitmap = jimp.fromBitmap(
      makeTestBitmap(2, 2, [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0xffffffff]),
    );
    expect((bitmap.bitmap as GifBitmap).gif).toBeUndefined();

    const output = await bitmap.getBuffer("image/gif");
    expect(output.subarray(0, 3).toString("latin1")).toBe("GIF");

    const structure = parseGifStructure(output);
    expect(structure.frames).toHaveLength(1);
    const redecoded = decodeGif(output);
    expect(redecoded.numFrames).toBe(1);
    expect(redecoded.getFrame(0).data.readUInt32BE(0)).toBe(0xff0000ff);
    expect(redecoded.getFrame(0).data.readUInt32BE(4)).toBe(0x00ff00ff);
  });

  test("a GIF without a loop extension still plays once after round trip", () => {
    const width = 2;
    const height = 2;
    const raw = makeGif(
      width,
      height,
      [{ indices: new Uint8Array(width * height) }],
      { palette: [0x000000, 0xffffff] },
    );

    const decoded = decodeGif(raw);
    expect(decoded.loopCount).toBeNull();
    expect(decoded.numFrames).toBe(1);

    const image = jimp.fromBitmap(decoded.bitmap);
    (image.bitmap as GifBitmap).gif = decoded;
    return image.getBuffer("image/gif").then((output: Buffer) => {
      const structure = parseGifStructure(output);
      expect(structure.loopCount).toBeNull();
      expect(structure.frames).toHaveLength(1);
    });
  });
});
