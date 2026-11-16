// Deposit pass: one instanced quad per dab, written into two float targets.
//
//   t0 = (paint.rgb, cover)          t1 = (paint.a, height, water, cover)
//
// Both use "one, one-minus-src-alpha" with the dab weight in alpha, so every
// channel is a true lerp towards the newest dab. That one rule gives opacity
// capping for inks, thinning for smudge (paint.a = 0) and erasing (paint = 0).
//
// A dab's coverage is built from up to four layers, each optional and each
// combined with the one before through a blend mode:
//
//   stamp        the tip, procedural or a raster image, in the dab's frame
//   dual stamp   a second shape in the same dab, with its own scale and jitter
//   stroke       a pattern in stroke space: distance along the path, position
//                across its tangent, so it runs continuously between dabs
//   texture      a pattern in document space, so neighbouring dabs agree on
//                what is under a pixel

struct Dab {
  a: vec4f, // centre.xy, diameter, tip angle
  b: vec4f, // flow, pressure, distance travelled, per-dab random
  c: vec4f, // hue shift (turns), saturation shift, luminance shift, secondary mix
  d: vec4f, // stroke heading, roundness, texture depth factor, water factor
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> dabs: array<Dab>;
@group(0) @binding(2) var reservoir: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;
@group(0) @binding(4) var rep: sampler;
@group(0) @binding(5) var tipTex: texture_2d<f32>;
@group(0) @binding(6) var dualTex: texture_2d<f32>;
@group(0) @binding(7) var paperTex: texture_2d<f32>;
@group(0) @binding(8) var strokeTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) idx: u32,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let d = dabs[ii];
  let uv = corners[vi];
  let q = uv * vec2f(1.0, d.d.y) * d.a.z * 0.5;
  let c = cos(d.a.w);
  let s = sin(d.a.w);
  let p = d.a.xy + vec2f(c * q.x - s * q.y, s * q.x + c * q.y);
  var o: VOut;
  o.pos = vec4f(p / P.doc.xy * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  o.uv = uv;
  o.idx = ii;
  return o;
}

struct FOut {
  @location(0) t0: vec4f,
  @location(1) t1: vec4f,
}

// Everything a procedural tip needs to know about the dab it is drawn in.
struct TipIn {
  uv: vec2f,     // -1..1 across the stamp
  aa: f32,       // one pixel, in uv units
  hard: f32,
  px: vec2f,     // document pixel
  size: f32,     // dab diameter
  dist: f32,     // distance travelled
  dseed: f32,    // per-dab random
  wetLoad: f32,  // paint left on the brush
}

// mask, height, tone
fn tipShape(kind: u32, t: TipIn) -> vec3f {
  let nominal = max(P.doc.z, 1.0);
  let seed = P.doc.w;
  let r = length(t.uv);
  // Hard tips keep about a pixel and a half of soft edge at any size.
  let hard = clamp(min(t.hard, 1.0 - t.aa * 1.5), 0.0, 0.999);
  let disc = 1.0 - smoothstep(hard, 1.0, r);

  var mask = disc;
  var height = 0.55;
  var tone = 1.0;

  switch kind {
    case 1u: {
      // Graphite: grit is locked to the page, so layering dabs builds tone
      // in the same specks instead of averaging to a flat grey.
      let grit = hash21(floor(t.px));
      mask = disc * smoothstep(0.3, 0.85, grit * 0.55 + paper(t.px, P.tex.y) * 0.75);
      height = 0.1;
    }
    case 2u: {
      // Bristles in stroke space.
      let count = max(P.tip.z, 2.0);
      let across = t.uv.y;
      let along = (t.dist + t.uv.x * t.size * 0.5) / nominal;
      // Strand positions are fixed in pixels, not in tip units: when pressure
      // narrows the tip the outer strands lift off rather than all of them
      // sliding inwards, so successive dabs agree on where each strand runs.
      let sx = (across * t.size / nominal * 0.5 + 0.5) * count;
      let sid = floor(sx);
      let sf = abs(fract(sx) - 0.5) * 2.0;
      let h1 = hash21(vec2f(sid, seed));
      let h2 = hash21(vec2f(sid + 91.0, seed));
      // Bristles meet the surface along a line across the stroke, not a disc.
      // Each pixel is then marked once, as that line sweeps over it, so the
      // strands stay continuous round curves. Strands differ in length,
      // which staggers the line and leaves ragged ends.
      let lead = (t.uv.x - (h2 - 0.5) * 0.5) / 0.16;
      let contact = exp(-lead * lead);
      let silhouette = contact * (1.0 - smoothstep(0.86, 1.0, abs(across)));
      // Long streaks per strand, plus broader clumps spanning several strands.
      let streak = fbm(vec2f(along * 3.2 + h1 * 40.0, sid * 0.73 + seed));
      let clump = fbm(vec2f(along * 1.1 + seed, across * 2.3));
      let body = streak * 0.55 + clump * 0.45 + (h1 - 0.5) * 0.3;
      // A loaded brush covers fully; as it dries only the fullest strands mark.
      let threshold = mix(0.8, 0.1, t.wetLoad);
      let cover = smoothstep(threshold - 0.1, threshold + 0.1, body);
      let strand = 1.0 - sf * sf * mix(0.9, 0.2, t.wetLoad);
      mask = silhouette * cover * strand;
      height = (0.3 + 0.7 * h1) * (1.0 - sf * 0.75) * (0.55 + 0.9 * streak);
      tone = 1.0 + (h1 - 0.5) * 0.14 + (streak - 0.5) * 0.1;
    }
    case 3u: {
      // Splatter: a jittered grid of droplets, reshuffled for every dab.
      let g = t.uv * 4.0 + vec2f(t.dseed * 13.0, t.dseed * 7.0);
      let cell = floor(g);
      let offset = vec2f(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
      let radius = 0.07 + 0.3 * hash21(cell + 11.3);
      let dd = length(fract(g) - 0.5 - offset * 0.5);
      let lit = step(0.45, hash21(cell + 19.0 + floor(t.dseed * 64.0)));
      mask = (1.0 - smoothstep(radius - 0.07, radius, dd)) * lit
        * (1.0 - smoothstep(0.75, 1.0, r));
      height = 0.8;
    }
    case 4u: {
      // Chalk: a crumbly stick with a rough outline.
      let block = hash21(floor(t.px / max(1.0, t.size / 14.0)));
      let rough = vnoise(t.uv * 5.0 + seed);
      let outline = 1.0 - smoothstep(0.68, 0.95, r + (rough - 0.5) * 0.4);
      mask = outline * (0.5 + 0.5 * block);
      height = 0.25;
    }
    case 5u: {
      // Flat: a square-ended tip with slightly rounded corners.
      let q = abs(t.uv) - vec2f(0.82);
      let box = length(max(q, vec2f(0.0))) / 0.18 + min(max(q.x, q.y), 0.0) / 0.82 + 1.0;
      mask = 1.0 - smoothstep(hard, 1.0, clamp(box, 0.0, 2.0));
    }
    case 6u: {
      // Sponge: soft cells that merge into an open, pitted mass.
      let g = t.uv * 3.2 + vec2f(t.dseed * 11.0, t.dseed * 5.0);
      let cell = floor(g);
      var near = 9.0;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          let c = cell + vec2f(f32(i), f32(j));
          let centre = c + vec2f(hash21(c + 1.7), hash21(c + 8.3));
          near = min(near, length(g - centre) / (0.35 + 0.5 * hash21(c + 4.1)));
        }
      }
      let pore = vnoise(t.uv * 9.0 + t.dseed * 31.0);
      mask = (1.0 - smoothstep(0.55, 1.0, near)) * smoothstep(0.2, 0.5, pore + 0.25)
        * (1.0 - smoothstep(0.7, 1.0, r));
      height = 0.4;
    }
    case 7u: {
      // Five-pointed star.
      let k1 = vec2f(0.809016994, -0.587785252);
      let k2 = vec2f(-k1.x, k1.y);
      var q = vec2f(abs(t.uv.x), -t.uv.y);
      q -= 2.0 * max(dot(k1, q), 0.0) * k1;
      q -= 2.0 * max(dot(k2, q), 0.0) * k2;
      q = vec2f(abs(q.x), q.y - 0.92);
      let ba = 0.45 * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
      let h = clamp(dot(q, ba) / dot(ba, ba), 0.0, 0.92);
      let sd = length(q - ba * h) * sign(q.y * ba.x - q.x * ba.y);
      let soft = max((1.0 - hard) * 0.4, t.aa * 1.5);
      mask = 1.0 - smoothstep(-soft, 0.0, sd);
    }
    default: {}
  }
  return vec3f(mask, height, tone);
}

// A canvas-level pattern in document pixels; 1 is a ridge, 0 a valley.
fn canvasTexture(kind: u32, px: vec2f, scale: f32) -> f32 {
  let s = max(scale, 0.2);
  switch kind {
    case 1u: {
      // Woven canvas: threads pass over and under each other.
      let q = px / (s * 5.0);
      let over = (floor(q.x) + floor(q.y)) % 2.0;
      let warp = abs(sin(q.x * 3.14159265));
      let weft = abs(sin(q.y * 3.14159265));
      let thread = mix(warp * (0.45 + 0.55 * weft), weft * (0.45 + 0.55 * warp), abs(over));
      return clamp(pow(thread, 0.7) * (0.82 + 0.3 * gnoise(px / (s * 2.3))), 0.0, 1.0);
    }
    case 2u: {
      // Laid paper: fine ribs with wider chain lines across them.
      let rib = 0.5 + 0.5 * sin(px.y * 6.2831853 / (s * 3.2) + gnoise(px / (s * 40.0)) * 2.0);
      let chain = smoothstep(0.9, 1.0, abs(sin(px.x * 3.14159265 / (s * 46.0))));
      return clamp(rib * 0.65 + fbm(px / (s * 7.0)) * 0.45 - chain * 0.4, 0.0, 1.0);
    }
    case 3u: {
      // Rough, cold-pressed paper: broad pits with a little grit.
      let pit = fbm(px / (s * 9.0));
      let grit = gnoise(px / (s * 1.6) + 51.3);
      return clamp((pit * 0.78 + grit * 0.22 - 0.5) * 2.6 + 0.5, 0.0, 1.0);
    }
    case 4u: {
      // Halftone: a screen of dots at 45 degrees.
      let q = vec2f(px.x + px.y, px.x - px.y) * 0.70710678 / (s * 7.0);
      return 1.0 - smoothstep(0.1, 0.62, length(fract(q) - 0.5) * 1.4142);
    }
    case 5u: {
      // Hatching: slightly wavering diagonal lines.
      let wobble = gnoise(px / (s * 30.0)) * 0.6;
      let line = abs(fract((px.x + px.y) / (s * 9.0) + wobble) - 0.5) * 2.0;
      return smoothstep(0.25, 0.75, line);
    }
    case 6u: {
      // Grit: hard-edged specks.
      return hash21(floor(px / s));
    }
    default: {
      return paper(px, scale);
    }
  }
}

// A stroke-space pattern. `along` is in brush diameters, `across` runs -1..1
// over the nominal width of the stroke.
fn strokeTexture(kind: u32, along: f32, across: f32, scale: f32, wetLoad: f32) -> f32 {
  let s = max(scale, 0.1);
  let seed = P.doc.w;
  switch kind {
    case 1u: {
      // Dry brush: patches where the tip skips, more of them as paint runs out.
      let blotch = fbm(vec2f(along * 1.3 / s + seed, across * 3.4 / s));
      let fine = fbm(vec2f(along * 5.0 / s, across * 16.0 / s + seed));
      let threshold = mix(0.62, 0.3, wetLoad);
      return smoothstep(threshold - 0.12, threshold + 0.12, blotch * 0.65 + fine * 0.35);
    }
    case 2u: {
      // Dashes.
      let f = fract(along / (s * 1.6));
      return smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.56, 0.62, f));
    }
    case 3u: {
      // Waves: bands that ripple across the stroke.
      return 0.5 + 0.5 * sin(along * 9.0 / s + sin(across * 3.0) * 1.4);
    }
    default: {
      // Fibres: long streaks, one per strand of the tip.
      let strands = 22.0 / s;
      let sx = (across * 0.5 + 0.5) * strands;
      let sid = floor(sx);
      let h = hash21(vec2f(sid, seed + 7.0));
      let streak = fbm(vec2f(along * 2.6 + h * 37.0, sid * 0.61 + seed));
      let gap = 1.0 - pow(abs(fract(sx) - 0.5) * 2.0, 3.0) * 0.6;
      return clamp((streak * 0.8 + h * 0.4) * gap * 1.25, 0.0, 1.0);
    }
  }
}

// Combines the mark so far (a) with a new layer (b). `bound` keeps modes that
// can add coverage inside the dab; `reach` is how far pressure pushes paint
// into the valleys of a height texture.
//
// Dabs overlap, and each one lerps coverage a little further towards full, so
// a pattern that every dab agrees on would fill in after a few of them.
// `overlap` is roughly how many dabs land on a pixel; the pattern's share of
// each dab is reduced so that it is their sum that matches the pattern.
fn blendMask(a: f32, b: f32, mode: u32, depth: f32, bound: f32, reach: f32, overlap: f32) -> f32 {
  var r = a * b;
  switch mode {
    case 1u: { r = max(a - b, 0.0); }
    case 2u: { r = min(a, b); }
    case 3u: { r = max(a, b * bound); }
    case 4u: { r = a + b * bound - a * b * bound; }
    case 5u: { r = select(1.0 - 2.0 * (1.0 - a) * (1.0 - b), 2.0 * a * b, a < 0.5) * step(1e-4, a); }
    case 6u: { r = abs(a - b * bound); }
    case 7u: { r = a * smoothstep(0.82 - reach, 1.18 - reach, b); }
    default: {}
  }
  let o = mix(a, clamp(r, 0.0, 1.0), clamp(depth, 0.0, 1.0));
  if (overlap > 1.0 && mode != 7u && o < a) {
    return a * (1.0 - pow(1.0 - o / a, 1.0 / overlap));
  }
  return o;
}

// Rotates hue about the grey axis, then shifts saturation and luminance.
fn shiftColor(c: vec3f, s: vec3f) -> vec3f {
  let ang = s.x * 6.2831853;
  let k = vec3f(0.57735027);
  let ca = cos(ang);
  let sa = sin(ang);
  var o = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
  let l = dot(o, vec3f(0.299, 0.587, 0.114));
  o = mix(vec3f(l), o, 1.0 + s.y);
  o = select(o * (1.0 + s.z), mix(o, vec3f(1.0), s.z), s.z > 0.0);
  return clamp(o, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(v: VOut) -> FOut {
  let d = dabs[v.idx];
  let size = d.a.z;
  let flow = d.b.x;
  let pressure = d.b.y;
  let dist = d.b.z;
  let dseed = d.b.w;
  let nominal = max(P.doc.z, 1.0);
  let wetness = P.media.x * d.d.w;
  let flags = u32(P.flow.z);

  let r = length(v.uv);
  let aa = max(fwidth(r), 1e-4);
  let px = v.pos.xy;
  let bound = 1.0 - smoothstep(0.82, 1.0, r);

  // Paint left on the brush: it runs out with distance, faster when depleting.
  let load = exp(-P.media.w * dist / nominal * 0.1);
  let wetLoad = clamp(load * (0.3 + 0.7 * pressure), 0.0, 1.0);
  let reach = mix(0.12, 0.98, pressure * mix(1.0, load, 0.6));

  // ---- stamp ---------------------------------------------------------------
  var tin: TipIn;
  tin.uv = v.uv;
  tin.aa = aa;
  tin.hard = P.tip.y;
  tin.px = px;
  tin.size = size;
  tin.dist = dist;
  tin.dseed = dseed;
  tin.wetLoad = wetLoad;

  var mask = 0.0;
  var height = 0.55;
  var tone = 1.0;
  // Mip level for a raster stamp: texels covered by one pixel.
  let texel = aa * 0.5;
  if (P.tip.x > 99.0) {
    let dims = f32(textureDimensions(tipTex).x);
    mask = textureSampleLevel(tipTex, lin, v.uv * 0.5 + 0.5, log2(max(texel * dims, 1.0))).r;
  } else {
    let shape = tipShape(u32(P.tip.x), tin);
    mask = shape.x;
    height = shape.y;
    tone = shape.z;
  }

  // ---- dual stamp ----------------------------------------------------------
  if (P.dual.x >= 0.0) {
    let turn = (hash21(vec2f(dseed * 91.7, 3.3)) - 0.5) * 6.2831853 * P.dual2.x;
    let shift = (vec2f(hash21(vec2f(dseed * 17.3, 1.1)), hash21(vec2f(dseed * 29.9, 2.2))) - 0.5)
      * 2.0 * P.dual2.y;
    let c = cos(turn);
    let s = sin(turn);
    let q = (v.uv - shift) / max(P.dual.y, 0.05);
    let uv2 = vec2f(c * q.x + s * q.y, -s * q.x + c * q.y);
    var m2 = 0.0;
    if (P.dual.x > 99.0) {
      let dims = f32(textureDimensions(dualTex).x);
      let inside = step(max(abs(uv2.x), abs(uv2.y)), 1.0);
      m2 = textureSampleLevel(dualTex, lin, uv2 * 0.5 + 0.5,
        log2(max(texel / max(P.dual.y, 0.05) * dims, 1.0))).r * inside;
    } else {
      var din = tin;
      din.uv = uv2;
      din.aa = aa / max(P.dual.y, 0.05);
      din.dseed = fract(dseed * 7.31 + 0.37);
      m2 = tipShape(u32(P.dual.x), din).x;
    }
    mask = blendMask(mask, m2, u32(P.dual.z), P.dual.w, bound, reach, 1.0);
  }

  // ---- stroke texture ------------------------------------------------------
  if (P.stk.x >= 0.0) {
    let rel = px - d.a.xy;
    let dir = vec2f(cos(d.d.x), sin(d.d.x));
    let along = (dist + dot(rel, dir)) / nominal;
    let across = dot(rel, vec2f(-dir.y, dir.x)) / (nominal * 0.5);
    var st = 0.0;
    if (P.stk.x > 99.0) {
      let dims = f32(textureDimensions(strokeTex).x);
      let lod = log2(max(dims / (max(P.stk.y, 0.1) * nominal), 1.0));
      st = textureSampleLevel(strokeTex, rep,
        vec2f(along / max(P.stk.y, 0.1), clamp(across * 0.5 + 0.5, 0.0, 1.0)), lod).r;
    } else {
      st = strokeTexture(u32(P.stk.x), along, across, P.stk.y, wetLoad);
    }
    st = mix(st, 1.0 - st, P.stk2.x);
    mask = blendMask(mask, st, u32(P.stk.z), P.stk.w, bound, reach, P.spare.x);
  }

  // ---- canvas texture ------------------------------------------------------
  if (P.tex.x >= 0.0) {
    var tooth = 0.5;
    if (P.tex.x > 99.0) {
      let dims = f32(textureDimensions(paperTex).x);
      let span = dims * max(P.tex.y, 0.1);
      tooth = textureSampleLevel(paperTex, rep, px / span, log2(max(1.0 / max(P.tex.y, 0.1), 1.0))).r;
    } else {
      tooth = canvasTexture(u32(P.tex.x), px, P.tex.y);
    }
    tooth = mix(tooth, 1.0 - tooth, P.tex2.x);
    mask = blendMask(mask, tooth, u32(P.tex.z), P.tex.w * d.d.z, bound, reach, P.spare.x);
  }

  if (wetness > 0.0) {
    // Granulation: suspended pigment settles into the valleys of the paper.
    mask *= mix(1.0, 0.45 + 1.1 * (1.0 - granule(px, P.tex.y)), P.sim2.x);
    // Pigment never disperses evenly through a wash.
    let cloud = fbm(px / (max(P.tex.y, 0.3) * 38.0) + P.doc.w * 1.7);
    mask *= 1.0 + (cloud - 0.5) * 1.5 * P.sim2.z;
  }

  // ---- colour --------------------------------------------------------------
  var paint = P.color;
  if ((flags & 4u) != 0u) {
    // Each part of the tip carries whatever it has picked up from the canvas.
    paint = textureSampleLevel(reservoir, lin, v.uv * 0.5 + 0.5, 0.0);
  }
  if (paint.a > 1e-4) {
    var rgb = paint.rgb / paint.a;
    rgb = mix(rgb, P.color2.rgb, d.c.w);
    rgb = shiftColor(rgb, d.c.xyz);
    paint = vec4f(rgb * paint.a, paint.a);
  }
  paint = vec4f(min(paint.rgb * tone, vec3f(paint.a)), paint.a);
  if ((flags & 1u) != 0u) {
    paint = vec4f(0.0);
  }

  let w = clamp(flow * mask * mix(1.0, load, 0.5), 0.0, 1.0);
  let water = max(wetness, step(0.001, P.flow.x));

  var o: FOut;
  o.t0 = vec4f(paint.rgb * w, w);
  o.t1 = vec4f(paint.a * w, height * w, clamp(water, 0.0, 1.0) * w, w);
  return o;
}
