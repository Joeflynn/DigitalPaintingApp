# Brush renderer

Every brush mark is drawn by WGSL shaders in `gpu/`, driven by `gpu-brush.ts`.
The 2D canvas API is only used to hold committed layers and composite them to
the screen.

## What the reference shaders contributed

The four Shadertoy exports were read for technique, not ported. They rely on
external noise textures that are not in the archives, so all noise here is
procedural.

- **Fabrice Neyret, "painting texture" (NlVBzW).** Paint a coordinate field,
  then texture it, instead of splatting textured stamps. Here bristles are
  evaluated in stroke space (distance along the path, position across the
  tip) and paper in document space, so neighbouring dabs agree on what is
  under a pixel and streaks run continuously.
- **mdb, "brush tex" (sdBfRw).** Anisotropic FBM stretched along the stroke,
  thresholded into broken coverage, with a second noise for tonal variation.
  This is the bristle model: long per-strand streaks plus broader clumps, with
  the threshold tied to how much paint is left on the brush.
- **Leon Denise, "Brush toy" (NlSBW3).** Treat accumulated paint as a height
  field, take its slope as a normal and light it. The resolve pass does this
  for any brush with thickness.
- **Leon Denise, "Fraggiti" (NldfR4).** Wet paint that keeps moving after it
  is laid down, sampled from upstream each frame so it leaks downhill. The
  flow pass uses the same feedback idea for drips, bleed and pooling.

## Pipeline

A stroke lives in two `rgba16float` buffers laid over a snapshot of the layer:

    t0 = (paint.rgb, cover)      t1 = (paint.a, height, water, cover)

1. **Dabs** (`stroke.ts`). Pointer samples are smoothed, joined with curves
   and walked at the brush spacing. Each dab is sixteen floats: position,
   size, angle, flow, pressure, distance travelled, a random value, a colour
   shift (hue, saturation, luminance, secondary mix), the stroke heading,
   roundness and scale factors for texture depth and water. A brush's `links`
   are evaluated here: each maps pressure, speed, tilt, fade or chance onto
   one property.
2. **Reservoir** (`reservoir.wgsl`). A 32 × 32 texture laid over the tip holds
   what each part of the tip is carrying. Every fraction of a brush width it
   soaks up some of the canvas just ahead of the tip and is topped up with
   fresh paint. Oils, the palette knife and the smudge tool all work this way.
   The `load` link target scales the top-up: at zero the tip gets no fresh
   paint and thins over bare canvas, which is exactly the smudge tool, so
   "light pressure blends, heavy pressure paints" is one link.
3. **Deposit** (`deposit.wgsl`). One instanced quad per dab. Both targets
   blend as a lerp towards the newest dab, weighted by the dab's coverage.
   That single rule gives opacity capping for inks, thinning for smudge
   (paint alpha 0) and erasing (paint 0). Coverage is built from four
   optional layers, each combined with the last through a blend mode:
   the **stamp** (procedural or raster), a **dual stamp** in the same dab,
   a **stroke texture** in stroke space (distance along the path, position
   across its tangent) and a **canvas texture** in document space.
4. **Flow** (`flow.wgsl`). While paint is wet, one step per frame ping-pongs
   the buffers: bleed into neighbours, feathering down the water gradient,
   pooling towards edges, granulation and drips. It keeps running for a
   short time after the pen lifts.
5. **Resolve** (`resolve.wgsl`). Lights the height field, lays the stroke over
   the base with the stroke opacity and the brush's paint blend (opaque,
   glaze, glow or invert), applies alpha lock, and writes the whole layer to
   the WebGPU canvas. A brush's **stroke effect** (pixel, outline, sticker,
   colour split, glitch, mosaic) is applied here by changing where the stroke
   buffers are read, so it treats the whole stroke as one shape. Effects draw
   outside the dabs, so `margin` grows by twice the effect's scale. The engine shows that canvas in place of the layer while
   the stroke is live and copies the affected rectangle into the layer when
   it commits.

## One brush, three tools

Painting, smudging and erasing all mark the canvas with the whole brush:
stamp, dual stamp, stroke pattern, canvas texture and dynamics. Painting lays
pigment through that mark, erasing lifts it (paint 0), and smudging is the
same brush run dry (`dryBrush`): the reservoir starts empty, never reloads,
and only drags what it soaks up from the canvas.

## Things that are easy to get wrong

- **Textures and overlap.** Dabs overlap, and each lerps coverage further
  towards full, so a pattern every dab agrees on fills in after a few of
  them. `blendMask` therefore shrinks the pattern's share of each dab by the
  number of dabs that land on a pixel (`P.spare.x`, from the spacing) so that
  their sum matches the pattern. The `height` blend is exempt: it thresholds,
  and zero stays zero however often it is repeated.
- **Raster images** are 256 × 256 single-channel textures with mips, keyed by
  data URL and decoded in the background. A stroke begun before its image has
  arrived paints with a blank one, so callers `preload` when a brush is
  picked or edited.
- **Mixing** goes through a per-channel Kubelka-Munk transform in `mixPaint`.
  It is what makes pickup look like pigment; do not replace it with a lerp.

## Limits

- Thickness is baked into colour when a stroke commits. Layers do not keep a
  height map, so earlier strokes cannot be relit or pushed around as relief.
- Pickup reads the layer being painted on, not the layers beneath it.
- Colour mixing is Kubelka-Munk on three channels, not a spectral pigment
  model: it handles blue and yellow well but has no real pigment data.
- Paint is only wet within the stroke that laid it. A new wash does not
  reactivate an earlier one, so there are no true wet-in-wet backruns between
  strokes.
- The dual stamp shares the stamp's spacing and scatter; it is a second shape
  per dab, not an independent second brush.
- Raster stamps are stored at 256 px, so very large tips look soft.
- The flow pass is an image-space approximation, not a fluid solver.
- A document needs five full-size textures while a stroke is live (about
  100 MB at 2000 × 1400).

## Checking changes

Open `/tests/brush-lab.html` under the Vite dev server. It renders every
preset over bands of existing paint through the production renderer, plus
erase, smudge and alpha-lock cases, and lists pass/fail checks underneath.
