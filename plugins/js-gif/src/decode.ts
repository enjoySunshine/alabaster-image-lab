import GIF from "omggif";

import { markRootBuffer } from "./frame-binding.js";
import { Gif } from "./gif.js";
import { GifFrame, GifFrameInfo } from "./types.js";

/**
 * Decodes a GIF into full-canvas RGBA frames.
 *
 * Unlike decoding a single frame rectangle, this walks every frame in order
 * and reproduces what a GIF player shows: each frame's changed rectangle is
 * painted over the running canvas, palette-transparent pixels leave the
 * previous frame's colors in place, and the disposal methods (restore to
 * background / restore to previous) are honored before the next frame.
 */
export function decodeGif(data: Buffer): Gif {
  const reader = new GIF.GifReader(data);
  const width = reader.width;
  const height = reader.height;
  const frameCount = reader.numFrames();

  const frameInfos: GifFrameInfo[] = [];
  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i);
    frameInfos.push({
      x: info.x,
      y: info.y,
      width: info.width,
      height: info.height,
      delay: info.delay,
      disposal: info.disposal,
      transparentIndex: info.transparent_index,
      interlaced: info.interlaced,
      hasLocalPalette: info.has_local_palette,
      paletteSize: info.palette_size,
    });
  }

  // A single-frame GIF has no compositing to do: decoding frame 0 straight
  // into a canvas-sized buffer yields exactly the same picture as before.
  if (frameCount === 1) {
    const info = reader.frameInfo(0);
    const bitmap = {
      data: Buffer.alloc(width * height * 4),
      width,
      height,
    };
    reader.decodeAndBlitFrameRGBA(0, bitmap.data);

    const frame: GifFrame = {
      bitmap,
      delayCentisecs: info.delay,
      disposalMethod: info.disposal,
    };
    markRootBuffer(bitmap.data);

    return new Gif(width, height, reader.loopCount(), [frame], frameInfos);
  }

  const canvas = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(width * height * 4);
  const frames: GifFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i);

    // Remember the canvas so disposal method 3 can restore it later.
    previous.set(canvas);

    const patch = Buffer.alloc(info.width * info.height * 4);
    reader.decodeAndBlitFrameRGBA(i, patch);
    blitPatch(canvas, patch, width, info.x, info.y, info.width, info.height);

    // Snapshot the composited result; this is the frame the player displays.
    frames.push({
      bitmap: {
        data: Buffer.from(canvas),
        width,
        height,
      },
      delayCentisecs: info.delay,
      disposalMethod: info.disposal,
    });

    applyDisposal(canvas, previous, width, info);
  }

  markRootBuffer(frames[0]!.bitmap.data);

  return new Gif(width, height, reader.loopCount(), frames, frameInfos);
}

/**
 * Paints one decoded frame rectangle onto the running canvas. Pixels the GIF
 * marks transparent keep whatever color the canvas already had, which is what
 * makes overlapping partial frames render correctly.
 */
function blitPatch(
  canvas: Buffer,
  patch: Buffer,
  canvasWidth: number,
  offsetX: number,
  offsetY: number,
  frameWidth: number,
  frameHeight: number,
): void {
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const patchIndex = (y * frameWidth + x) * 4;

      // omggif leaves transparent pixels at zero alpha; skip them so the
      // colors inherited from earlier frames stay visible.
      if (patch[patchIndex + 3] === 0) {
        continue;
      }

      const canvasIndex = ((offsetY + y) * canvasWidth + (offsetX + x)) * 4;
      canvas[canvasIndex] = patch[patchIndex]!;
      canvas[canvasIndex + 1] = patch[patchIndex + 1]!;
      canvas[canvasIndex + 2] = patch[patchIndex + 2]!;
      canvas[canvasIndex + 3] = 255;
    }
  }
}

/**
 * Applies the frame's disposal method to the running canvas before the next
 * frame is decoded. Method 2 clears the frame rectangle to transparency and
 * method 3 restores the canvas captured before the frame was painted.
 */
function applyDisposal(
  canvas: Buffer,
  previous: Buffer,
  canvasWidth: number,
  info: GIF.Frame,
): void {
  if (info.disposal === 2) {
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const index = ((info.y + y) * canvasWidth + (info.x + x)) * 4;
        canvas[index + 3] = 0;
      }
    }
  } else if (info.disposal === 3) {
    canvas.set(previous);
  }
}
