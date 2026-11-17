// Shared by every pass. Only vec4f fields, so the layout is 17 × 16 bytes with
// no padding surprises; gpu-brush.ts writes it as a flat Float32Array.
struct Params {
  doc: vec4f,    // width, height, nominal brush diameter, stroke seed
  color: vec4f,  // brush paint, premultiplied
  color2: vec4f, // secondary colour, straight rgb
  tip: vec4f,    // tip kind (100 = raster), hardness, bristle count, unused
  media: vec4f,  // wetness, pickup, relief, depletion
  flow: vec4f,   // drip, stroke opacity, flags (1 erase, 2 alpha lock, 4 reservoir), paint blend
  res0: vec4f,   // reservoir footprint: centre.xy, diameter, angle
  res1: vec4f,   // reservoir: pickup rate, reload rate, thin on bare canvas, roundness
  sim: vec4f,    // bleed, edge pooling, drip speed, drying factor
  sim2: vec4f,   // granulation, feathering, pigment variation, gloss
  dual: vec4f,   // second stamp: kind (-1 off, 100 raster), scale, blend, depth
  dual2: vec4f,  // second stamp: rotation jitter, offset jitter, unused ×2
  tex: vec4f,    // canvas texture: kind (-1 off, 100 raster), scale, blend, depth
  tex2: vec4f,   // canvas texture: invert, unused ×3
  stk: vec4f,    // stroke texture: kind (-1 off, 100 raster), scale, blend, depth
  stk2: vec4f,   // stroke texture: invert, unused ×3
  spare: vec4f,  // dabs overlapping a pixel, stroke effect, effect scale in px, unused
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y,
  );
}

// Gradient noise, remapped to roughly 0..1. Smoother and far less grid-like
// than value noise, which matters once the simulation starts sharpening it.
fn gnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = hash21(i) * 6.2831853;
  let b = hash21(i + vec2f(1.0, 0.0)) * 6.2831853;
  let c = hash21(i + vec2f(0.0, 1.0)) * 6.2831853;
  let d = hash21(i + vec2f(1.0, 1.0)) * 6.2831853;
  let va = dot(vec2f(cos(a), sin(a)), f);
  let vb = dot(vec2f(cos(b), sin(b)), f - vec2f(1.0, 0.0));
  let vc = dot(vec2f(cos(c), sin(c)), f - vec2f(0.0, 1.0));
  let vd = dot(vec2f(cos(d), sin(d)), f - vec2f(1.0, 1.0));
  return clamp(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 0.75 + 0.5, 0.0, 1.0);
}

fn fbm(p: vec2f) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    sum += amp * gnoise(q);
    // Rotate each octave so the lattice of one never lines up with the next.
    q = vec2f(q.x * 1.62 - q.y * 1.21, q.x * 1.21 + q.y * 1.62) + vec2f(17.1, 9.7);
    amp *= 0.5;
  }
  return sum / 0.9375;
}

// Paper height in document space: broad tooth, fine grit and long fibres.
// 0 is the bottom of a valley, 1 the top of a ridge.
fn paper(p: vec2f, scale: f32) -> f32 {
  let q = p / max(scale, 0.2);
  let tooth = fbm(q * 0.3);
  let grit = fbm(vec2f(q.x * 0.9 + q.y * 0.5, q.y * 0.9 - q.x * 0.5) + 31.7);
  let fibre = gnoise(vec2f(q.x * 0.09 + tooth * 2.0, q.y * 0.8 + q.x * 0.21));
  // Stretch the contrast: summed noise bunches up around the middle.
  let h = tooth * 0.58 + grit * 0.3 + fibre * 0.12;
  return clamp((h - 0.5) * 1.9 + 0.5, 0.0, 1.0);
}

// Where pigment granulates: broad, irregular hollows rather than the fine
// tooth, so a wash settles into mottled clouds instead of a regular speckle.
// 1 is a ridge that sheds pigment, 0 a hollow that collects it.
fn granule(p: vec2f, scale: f32) -> f32 {
  let s = max(scale, 0.3);
  let broad = fbm(p / (s * 6.5) + 13.0);
  let fine = fbm(vec2f(p.x * 0.8 + p.y * 0.6, p.y * 0.8 - p.x * 0.6) / (s * 2.1) + 71.0);
  return clamp((broad * 0.62 + fine * 0.38 - 0.5) * 2.6 + 0.5, 0.0, 1.0);
}

// Reflectance to absorption/scattering ratio and back (Kubelka-Munk, one
// constant per channel). Mixing in this space behaves like pigment: blue and
// yellow go green, and a little dark paint goes a long way.
fn toKS(c: vec3f) -> vec3f {
  let r = clamp(c, vec3f(0.02), vec3f(1.0));
  return (1.0 - r) * (1.0 - r) / (2.0 * r);
}

fn fromKS(k: vec3f) -> vec3f {
  return 1.0 + k - sqrt(k * k + 2.0 * k);
}

// Mixes two premultiplied paints as pigments.
fn mixPaint(a: vec4f, b: vec4f, t: f32) -> vec4f {
  let wa = a.a * (1.0 - t);
  let wb = b.a * t;
  let alpha = wa + wb;
  if (alpha < 1e-5) {
    return vec4f(0.0);
  }
  let u = wb / alpha;
  let ca = a.rgb / max(a.a, 1e-5);
  let cb = b.rgb / max(b.a, 1e-5);
  let pigment = fromKS(mix(toKS(ca), toKS(cb), u));
  // Keep a little of the plain average so pure hues do not go muddy.
  return vec4f(mix(mix(ca, cb, u), pigment, 0.8) * alpha, alpha);
}

// Lays paint over the base. `src` is the paint at full coverage,
// premultiplied; `k` is how much of the pixel it covers. The paint blend
// picks opaque paint, a transparent glaze that darkens what is beneath it
// like watercolour, light that adds to it, or a negative of what is there.
fn layPaint(base: vec4f, src: vec4f, k: f32, blend: f32) -> vec4f {
  if (blend > 2.5) {
    // Bare canvas counts as white paper, so it inverts to black.
    let under = mix(vec3f(1.0), base.rgb / max(base.a, 1e-5), base.a);
    return base * (1.0 - k) + vec4f((1.0 - under) * src.a, src.a) * k;
  }
  if (blend > 1.5) {
    let a = base.a + src.a * k * (1.0 - base.a);
    return vec4f(min(base.rgb + src.rgb * k, vec3f(a)), a);
  }
  var s = src;
  if (blend > 0.5) {
    let under = mix(vec3f(1.0), base.rgb / max(base.a, 1e-5), base.a);
    s = vec4f(src.rgb * under, src.a);
  }
  return base * (1.0 - k) + s * k;
}

// The layer as it looks right now: the stroke buffers laid over the base.
fn composite(base: vec4f, t0: vec4f, t1: vec4f, opacity: f32, blend: f32) -> vec4f {
  let cover = t0.a;
  if (cover < 1e-5) {
    return base;
  }
  let k = clamp(cover * opacity, 0.0, 1.0);
  return layPaint(base, vec4f(t0.rgb, t1.r) / cover, k, blend);
}

const FULLSCREEN = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
