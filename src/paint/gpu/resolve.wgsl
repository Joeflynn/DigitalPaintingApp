// Resolve pass: turns the stroke buffers into the layer as it should look.
// Paint thickness is treated as a height field; its slope gives a normal, and
// the normal is lit with a raking light for diffuse shading and a specular
// glint. The lit stroke is then laid over the base with the stroke opacity.
//
// A brush may also ask for a stroke effect, which changes where and how the
// stroke buffers are read: snapped to blocks, traced as an outline, split into
// colour channels and so on. Because the buffers hold the whole stroke, the
// effect treats it as one shape however many dabs built it.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var baseTex: texture_2d<f32>;
@group(0) @binding(2) var t0: texture_2d<f32>;
@group(0) @binding(3) var t1: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var tri = FULLSCREEN;
  return vec4f(tri[vi], 0.0, 1.0);
}

fn heightAt(p: vec2i, limit: vec2i) -> f32 {
  return textureLoad(t1, clamp(p, vec2i(0), limit), 0).g;
}

// The stroke at one pixel: lit paint (rgb, alpha) and how much of the pixel
// it covers. The paint is scaled by the cover, as it is in the buffers.
struct Mark {
  paint: vec4f,
  cover: f32,
}

fn lit(p: vec2i) -> Mark {
  let limit = vec2i(P.doc.xy) - vec2i(1);
  if (any(p < vec2i(0)) || any(p > limit)) {
    return Mark(vec4f(0.0), 0.0);
  }
  let a0 = textureLoad(t0, p, 0);
  let cover = a0.a;
  if (cover < 1e-4) {
    return Mark(vec4f(0.0), 0.0);
  }
  let a1 = textureLoad(t1, p, 0);
  var paint = a0.rgb;
  let alpha = a1.r;

  let relief = P.media.z;
  if (relief > 0.0) {
    let slope = vec2f(
      heightAt(p - vec2i(1, 0), limit) - heightAt(p + vec2i(1, 0), limit),
      heightAt(p - vec2i(0, 1), limit) - heightAt(p + vec2i(0, 1), limit),
    ) * relief * 5.0;
    let n = normalize(vec3f(slope, 1.0));
    let light = normalize(vec3f(-0.5, -0.62, 0.6));
    let halfway = normalize(light + vec3f(0.0, 0.0, 1.0));
    // Normalised so flat paint keeps its exact colour.
    let diffuse = dot(n, light) / light.z;
    // Gloss tightens the highlight as well as brightening it.
    let gloss = P.sim2.w;
    let shine = mix(14.0, 70.0, gloss);
    let glint = max(pow(max(dot(n, halfway), 0.0), shine) - pow(halfway.z, shine), 0.0);
    paint = paint * clamp(mix(1.0, diffuse, 0.6), 0.35, 1.5)
      + vec3f(1.0, 0.97, 0.9) * glint * relief * gloss * 0.9 * alpha;
    paint = min(paint, vec3f(alpha));
  }
  return Mark(vec4f(paint, alpha), cover);
}

fn lay(base: vec4f, m: Mark) -> vec4f {
  if (m.cover < 1e-4) {
    return base;
  }
  let k = clamp(m.cover * P.flow.y, 0.0, 1.0);
  return layPaint(base, m.paint / m.cover, k, P.flow.w);
}

// The same paint with its cover replaced, for effects that redraw the shape.
fn recover(m: Mark, cover: f32) -> Mark {
  return Mark(m.paint / max(m.cover, 1e-5) * cover, cover);
}

// The fullest mark on a ring of `count` pixels around p (and at p itself),
// and the emptiest cover found there.
struct Ring {
  most: Mark,
  least: f32,
}

fn ring(p: vec2f, radius: f32, count: i32) -> Ring {
  var most = lit(vec2i(p));
  var least = most.cover;
  for (var i = 0; i < count; i++) {
    let a = (f32(i) + 0.5) * 6.2831853 / f32(count);
    let m = lit(vec2i(p + vec2f(cos(a), sin(a)) * radius));
    least = min(least, m.cover);
    if (m.cover > most.cover) {
      most = m;
    }
  }
  return Ring(most, least);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(pos.xy);
  let pf = pos.xy;
  let base = textureLoad(baseTex, p, 0);
  let effect = u32(P.spare.y + 0.5);
  let E = max(P.spare.z, 1.0);
  let painting = P.color.a > 0.0;
  var o = base;

  switch effect {
    case 1u: {
      // Pixel: the stroke snapped to hard-edged blocks.
      let m = lit(vec2i(floor(pf / E) * E + E * 0.5));
      o = lay(base, recover(m, smoothstep(0.3, 0.5, m.cover)));
    }
    case 2u: {
      // Outline: only the rim of the stroke's whole silhouette is drawn.
      let r = ring(pf, E * 0.5, 12);
      let edge = smoothstep(0.3, 0.6, r.most.cover) * (1.0 - smoothstep(0.4, 0.7, r.least));
      o = lay(base, recover(r.most, edge));
    }
    case 3u: {
      // Sticker: a white border round the stroke and a shadow beneath it.
      if (painting) {
        let shadow = smoothstep(0.3, 0.6, ring(pf - vec2f(E * 0.45, E * 0.7), E, 8).most.cover);
        let rim = smoothstep(0.3, 0.6, ring(pf, E, 12).most.cover);
        o = layPaint(o, vec4f(0.0, 0.0, 0.0, 1.0), shadow * 0.35 * P.flow.y, 0.0);
        o = layPaint(o, vec4f(1.0), rim * P.flow.y, 0.0);
      }
      o = lay(o, lit(p));
    }
    case 4u, 5u: {
      // Chroma: red and blue slide apart. Glitch also tears the stroke into
      // rows that jump sideways.
      var shift = 0.0;
      var split = E;
      if (effect == 5u) {
        let rows = max(2.0, P.doc.z * 0.09);
        let on = step(0.45, hash21(vec2f(floor(pf.y / (rows * 3.7)), P.doc.w + 5.0)));
        shift = (hash21(vec2f(floor(pf.y / rows), P.doc.w)) - 0.5) * 2.0 * E * on;
        split = E * 0.12 * on;
      }
      let r = lay(base, lit(vec2i(pf + vec2f(shift - split, 0.0))));
      let g = lay(base, lit(vec2i(pf + vec2f(shift, 0.0))));
      let b = lay(base, lit(vec2i(pf + vec2f(shift + split, 0.0))));
      o = vec4f(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
    }
    case 6u: {
      // Mosaic: irregular tiles, each one colour, with dark lines between.
      let q = pf / E;
      let cell = floor(q);
      var f1 = 9.0;
      var f2 = 9.0;
      var id = cell;
      var centre = q;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let c = cell + vec2f(f32(i), f32(j));
          let site = c + vec2f(hash21(c + 1.7), hash21(c + 8.3));
          let dd = length(q - site);
          if (dd < f1) {
            f2 = f1;
            f1 = dd;
            id = c;
            centre = site;
          } else if (dd < f2) {
            f2 = dd;
          }
        }
      }
      let m = lit(vec2i(centre * E));
      let lead = smoothstep(0.04, 0.12, f2 - f1);
      let tone = (0.8 + 0.4 * hash21(id + 23.0)) * mix(0.15, 1.0, lead);
      var tile = recover(m, smoothstep(0.25, 0.45, m.cover));
      tile.paint = vec4f(min(tile.paint.rgb * tone, vec3f(tile.paint.a)), tile.paint.a);
      o = lay(base, tile);
    }
    default: {
      o = lay(base, lit(p));
    }
  }

  if ((u32(P.flow.z) & 2u) != 0u) {
    // Alpha lock: recolour existing pixels, never change their coverage.
    if (base.a <= 0.0) {
      return vec4f(0.0);
    }
    o = vec4f(o.rgb / max(o.a, 1e-5) * base.a, base.a);
  }

  let a = clamp(o.a, 0.0, 1.0);
  return vec4f(clamp(o.rgb, vec3f(0.0), vec3f(a)), a);
}
