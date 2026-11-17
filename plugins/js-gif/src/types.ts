import { Bitmap } from "@jimp/types";

import type { Gif } from "./gif.js";

/**
 * Metadata and fully-composited pixel data of a single GIF frame.
 *
 * The bitmap always covers the whole GIF canvas and holds the exact pixels a
 * player displays while the frame is visible: partial-frame redraws have
 * already been applied on top of the preceding frames and transparent pixels
 * keep showing the colors inherited from earlier frames instead of turning
 * black.
 */
export interface GifFrame {
  /** The frame rendered as a regular RGBA bitmap (one entry per canvas pixel) */
  bitmap: Bitmap;
  /** Frame duration in hundredths of a second, exactly as stored in the GIF */
  delayCentisecs: number;
  /**
   * GIF disposal method that followed this frame in the source file:
   * 0 = unspecified, 1 = do not dispose, 2 = restore to background,
   * 3 = restore to previous.
   */
  disposalMethod: number;
}

/** Static metadata describing one frame as it was laid out in the GIF stream. */
export interface GifFrameInfo {
  /** Left offset of the frame rectangle within the canvas */
  x: number;
  /** Top offset of the frame rectangle within the canvas */
  y: number;
  /** Width of the frame rectangle */
  width: number;
  /** Height of the frame rectangle */
  height: number;
  /** Frame duration in hundredths of a second */
  delay: number;
  /** GIF disposal method (0-3) */
  disposal: number;
  /** Palette index marked transparent, or null when the frame has none */
  transparentIndex: number | null;
  /** Whether the frame rectangle is interlaced */
  interlaced: boolean;
  /** Whether the frame carries a local color table */
  hasLocalPalette: boolean;
  /** Number of entries in the color table used by the frame */
  paletteSize: number | null;
}

export interface GifBitmap extends Bitmap {
  /**
   * Attached by the GIF decoder. Holds every frame together with the
   * animation timing. The GIF encoder reads it back when exporting so frame
   * count, per-frame delays and loop settings survive a round trip.
   */
  gif?: Gif;
}
