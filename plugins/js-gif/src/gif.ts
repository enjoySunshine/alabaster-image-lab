import { Bitmap } from "@jimp/types";

import { GifFrame, GifFrameInfo } from "./types.js";

/**
 * In-memory representation of an animated GIF.
 *
 * Every frame is stored as a full-canvas RGBA bitmap that looks exactly like
 * what a player displays for that frame, so frames can be handed to ordinary
 * bitmap operations (resize, blit, ...) without knowing anything about GIF
 * sub-rectangles, color tables or transparency indices.
 */
export class Gif {
  /** Canvas width of the source GIF */
  readonly width: number;
  /** Canvas height of the source GIF */
  readonly height: number;
  /**
   * How many times the animation repeats after the first play-through:
   * 0 means loop forever, a positive number gives the exact repeat count and
   * null means the GIF carries no loop instruction (it plays once).
   */
  readonly loopCount: number | null;
  /** The decoded frames, in playback order */
  readonly frames: GifFrame[];
  /** Raw frame descriptors parsed from the GIF stream, in playback order */
  readonly frameInfos: GifFrameInfo[];

  constructor(
    width: number,
    height: number,
    loopCount: number | null,
    frames: GifFrame[],
    frameInfos: GifFrameInfo[],
  ) {
    this.width = width;
    this.height = height;
    this.loopCount = loopCount;
    this.frames = frames;
    this.frameInfos = frameInfos;
  }

  /** Number of frames in the animation (always at least one) */
  get numFrames(): number {
    return this.frames.length;
  }

  /** Bitmap of the first frame; this is what plain single-image APIs expose */
  get bitmap(): Bitmap {
    return this.frames[0]!.bitmap;
  }

  /**
   * Width of the canvas the frames are exported with. Frames processed with
   * ordinary bitmap operations may have changed size, so the output canvas
   * grows to fit the widest frame instead of assuming the source dimensions.
   */
  get outputWidth(): number {
    return this.frames.reduce(
      (max, frame) => Math.max(max, frame.bitmap.width),
      0,
    );
  }

  /**
   * Height of the canvas the frames are exported with. See outputWidth.
   */
  get outputHeight(): number {
    return this.frames.reduce(
      (max, frame) => Math.max(max, frame.bitmap.height),
      0,
    );
  }

  /**
   * Returns the fully-composited bitmap of any single frame. The returned
   * bitmap is the frame's own buffer, so mutating it (for example through a
   * Jimp operation) changes the frame that gets exported later.
   */
  getFrame(index: number): Bitmap {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      throw new RangeError(
        `Frame index ${index} is out of range for a GIF with ${this.frames.length} frame(s)`,
      );
    }

    return this.frames[index]!.bitmap;
  }

  /** Duration of a frame in hundredths of a second */
  getFrameDelay(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      throw new RangeError(
        `Frame index ${index} is out of range for a GIF with ${this.frames.length} frame(s)`,
      );
    }

    return this.frames[index]!.delayCentisecs;
  }
}
