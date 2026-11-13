// Shared by every pass. Only vec4f fields, so the layout is 9 × 16 bytes with
// no padding surprises; gpu-brush.ts writes it as a flat Float32Array.
struct Params {
  doc: vec4f,    // width, height, nominal brush diameter, stroke seed
  color: vec4f,  // brush paint, premultiplied
  tip: vec4f,    // tip kind, hardness, bristle count, paper scale
  media: vec4f,  // paper tooth, wetness, pickup, relief
  flow: vec4f,   // depletion, drip, stroke opacity, flags (1 erase, 2 alpha lock)
  res0: vec4f,   // reservoir footprint: centre.xy, diameter, angle
  res1: vec4f,   // reservoir: pickup rate, reload rate, thin on bare canvas, unused
  sim: vec4f,    // bleed, edge pooling, drip speed, drying factor
  shape: vec4f,  // roundness, unused ×3
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

// Mixes two premultiplied paints. Colour is blended partway between a linear
// and a geometric mean, so blue and yellow lean green instead of grey.
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
  let straight = mix(ca, cb, u);
  let geometric = exp(mix(log(max(ca, vec3f(0.004))), log(max(cb, vec3f(0.004))), u));
  return vec4f(mix(straight, geometric, 0.55) * alpha, alpha);
}

// The layer as it looks right now: the stroke buffers laid over the base.
fn composite(base: vec4f, t0: vec4f, t1: vec4f, opacity: f32) -> vec4f {
  let cover = t0.a;
  if (cover < 1e-5) {
    return base;
  }
  let k = clamp(cover * opacity, 0.0, 1.0);
  return base * (1.0 - k) + vec4f(t0.rgb, t1.r) * (k / cover);
}

const FULLSCREEN = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
