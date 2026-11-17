/**
 * Buffers that the decoder exposed as the Jimp root bitmap (frame zero).
 *
 * The encoder uses this to distinguish two otherwise identical situations:
 * - a Jimp operation such as `resize()` replaced the root bitmap in place, in
 *   which case frame zero must follow the root bitmap, and
 * - frame zero's bitmap was deliberately replaced through the per-frame API,
 *   in which case the replacement must be exported untouched.
 *
 * A WeakSet keeps the bookkeeping off the bitmap objects themselves (so plain
 * bitmap equality stays unaffected) and avoids retaining decoded buffers.
 */
const rootBuffers = new WeakSet<Buffer>();

export function markRootBuffer(data: Buffer): void {
  rootBuffers.add(data);
}

export function isRootBuffer(data: Buffer): boolean {
  return rootBuffers.has(data);
}
