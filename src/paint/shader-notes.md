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
   and walked at the brush spacing. Each dab is eight floats: position, size,
   angle, flow, pressure, distance travelled and a random value.
2. **Reservoir** (`reservoir.wgsl`). A 32 × 32 texture laid over the tip holds
   what each part of the tip is carrying. Every fraction of a brush width it
   soaks up some of the canvas just ahead of the tip and is topped up with
   fresh paint. Oils, the palette knife and the smudge tool all work this way.
3. **Deposit** (`deposit.wgsl`). One instanced quad per dab. Both targets
   blend as a lerp towards the newest dab, weighted by the dab's coverage.
   That single rule gives opacity capping for inks, thinning for smudge
   (paint alpha 0) and erasing (paint 0).
4. **Flow** (`flow.wgsl`). While paint is wet, one step per frame ping-pongs
   the buffers: bleed into neighbours, pooling towards edges, and drips. It
   keeps running for a short time after the pen lifts.
5. **Resolve** (`resolve.wgsl`). Lights the height field, lays the stroke over
   the base with the stroke opacity, applies alpha lock, and writes the whole
   layer to the WebGPU canvas. The engine shows that canvas in place of the
   layer while the stroke is live and copies the affected rectangle into the
   layer when it commits.

## Limits

- Thickness is baked into colour when a stroke commits. Layers do not keep a
  height map, so earlier strokes cannot be relit or pushed around as relief.
- Pickup reads the layer being painted on, not the layers beneath it.
- Colour mixing is a blend of linear and geometric means, not a spectral
  pigment model.
- The flow pass is an image-space approximation, not a fluid solver.
- A document needs five full-size textures while a stroke is live (about
  100 MB at 2000 × 1400).

## Checking changes

Open `/tests/brush-lab.html` under the Vite dev server. It renders every
preset over bands of existing paint through the production renderer, plus
erase, smudge and alpha-lock cases, and lists pass/fail checks underneath.
