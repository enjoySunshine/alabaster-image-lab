import { Format } from "@jimp/types";

import { decodeGif } from "./decode.js";
import { encodeGif } from "./encode.js";
import { isRootBuffer, markRootBuffer } from "./frame-binding.js";
import { Gif } from "./gif.js";
import { GifBitmap } from "./types.js";

export { Gif } from "./gif.js";
export { decodeGif } from "./decode.js";
export { encodeGif } from "./encode.js";
export type { GifFrame, GifFrameInfo, GifBitmap } from "./types.js";

export interface GifExportOptions {
  /**
   * Loop count to write instead of the one carried by the decoded GIF:
   * 0 loops forever, a positive number gives the exact repeat count and
   * null omits the loop extension so the animation plays once.
   */
  loop?: number | null;
}

export default function gif() {
  return {
    mime: "image/gif",
    hasAlpha: true,
    encode: (bitmap: GifBitmap, options?: GifExportOptions): Buffer => {
      // A bitmap that never came from a GIF (for example a freshly created
      // image) is exported as a single-frame GIF.
      if (!bitmap.gif) {
        const singleFrame = new Gif(
          bitmap.width,
          bitmap.height,
          options && "loop" in options ? (options.loop ?? null) : null,
          [
            {
              bitmap: {
                data: bitmap.data,
                width: bitmap.width,
                height: bitmap.height,
              },
              delayCentisecs: 0,
              disposalMethod: 0,
            },
          ],
          [],
        );

        return encodeGif(singleFrame);
      }

      syncFirstFrame(bitmap);

      const gif =
        options && "loop" in options
          ? withLoopCount(bitmap.gif, options.loop ?? null)
          : bitmap.gif;

      return encodeGif(gif);
    },
    decode: (data: Buffer): GifBitmap => {
      const gif = decodeGif(data);
      const bitmap = gif.bitmap;

      return {
        data: bitmap.data,
        width: gif.width,
        height: gif.height,
        gif,
      };
    },
  } satisfies Format<"image/gif", GifExportOptions>;
}

/**
 * Keeps frame zero aligned with the Jimp root bitmap.
 *
 * A root-level operation like `image.resize()` replaces the root bitmap while
 * frame zero still references the original, marked buffer: the root bitmap is
 * the new first frame in that case. When frame zero was replaced explicitly
 * through the per-frame API (its buffer is no longer a marked root buffer),
 * the replacement is left untouched.
 */
function syncFirstFrame(bitmap: GifBitmap): void {
  const gif = bitmap.gif!;
  const firstFrame = gif.frames[0]!;

  if (
    bitmap.data !== firstFrame.bitmap.data &&
    isRootBuffer(firstFrame.bitmap.data)
  ) {
    firstFrame.bitmap = {
      data: bitmap.data,
      width: bitmap.width,
      height: bitmap.height,
    };
    markRootBuffer(bitmap.data);
  }
}

function withLoopCount(source: Gif, loopCount: number | null): Gif {
  return new Gif(
    source.width,
    source.height,
    loopCount,
    source.frames,
    source.frameInfos,
  );
}
