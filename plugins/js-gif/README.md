<div align="center">
  <img width="200" height="200"
    src="https://s3.amazonaws.com/pix.iemoji.com/images/emoji/apple/ios-11/256/crayon.png">
  <h1>@jimp/gif</h1>
  <p>Default Jimp gif decoder and encoder.</p>
</div>

## Animated GIFs

The format decodes every frame of an animated GIF. Each frame is stored as a
full-canvas RGBA bitmap, composited exactly the way a GIF player renders it:
partial-frame redraws are applied on top of the preceding frames, palette
transparent pixels keep the inherited colors instead of turning black, and the
GIF disposal methods are honored.

The decoded bitmap carries a `Gif` instance on `bitmap.gif`:

```ts
import { createJimp } from "@jimp/core";
import gif from "@jimp/js-gif";

const jimp = createJimp({ formats: [gif] });

const image = await jimp.read("animated.gif");
const animation = image.bitmap.gif;

animation.numFrames; // number of frames
animation.loopCount; // 0 = loop forever, n = repeat n times, null = play once
animation.frames[0].delayCentisecs; // frame duration in hundredths of a second

// Any frame as an ordinary bitmap, ready for resize/blit/...
const frame = jimp.fromBitmap(animation.getFrame(0));
frame.resize({ w: 320, h: 320 });
animation.frames[0].bitmap = frame.bitmap;

// Frame count, per-frame delays and loop count survive the export.
const buffer = await image.getBuffer("image/gif");
```

Single-frame GIFs keep behaving exactly like ordinary bitmaps: they decode to
one frame and never gain empty extra frames.

The plugin only depends on `omggif`, so it runs in both Node.js and browser
builds; no Node-only GIF libraries are used.
