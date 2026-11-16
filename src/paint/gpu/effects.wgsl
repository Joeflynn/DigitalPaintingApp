// Adjustment-layer effects. Every effect is one fullscreen pass over the
// (premultiplied) image beneath the layer; the ones that need a soft copy of
// it — blur, sharpen, glow — first run the separable Gaussian in `fsBlur`
// horizontally then vertically and read the result from `aux`.

struct U {
  doc: vec4f,   // width, height, effect code, layer opacity
  a: vec4f,     // effect parameters 0–3
  b: vec4f,     // effect parameters 4–7
  blur: vec4f,  // direction x, direction y, sigma, tap spacing
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var aux: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(tri[vi], 0.0, 1.0);
}

@fragment
fn fsBlur(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.doc.xy;
  let dir = u.blur.xy / u.doc.xy;
  let sigma = max(u.blur.z, 0.01);
  var acc = textureSampleLevel(src, smp, uv, 0.0);
  var total = 1.0;
  for (var i = 1; i <= 32; i++) {
    let d = f32(i) * u.blur.w;
    let w = exp(-0.5 * d * d / (sigma * sigma));
    acc += (textureSampleLevel(src, smp, uv + dir * d, 0.0)
      + textureSampleLevel(src, smp, uv - dir * d, 0.0)) * w;
    total += 2.0 * w;
  }
  return acc / total;
}

fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let k = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let p = abs(fract(c.xxx + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), c.y);
}

fn hash(p: vec2f) -> f32 {
  var q = fract(vec3f(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn tap(uv: vec2f) -> vec4f {
  return textureSampleLevel(src, smp, uv, 0.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.doc.xy;
  let o = tap(uv);
  let soft = textureSampleLevel(aux, smp, uv, 0.0);
  // Colour adjustments work on straight colour `c` and keep the coverage;
  // spatial effects write the premultiplied result `r` themselves.
  var c = o.rgb / max(o.a, 1e-5);
  var r = o;
  var spatial = false;

  switch i32(u.doc.z) {
    case 0 { // brightness / contrast
      let k = tan((clamp(u.a.y, -0.98, 0.98) + 1.0) * 0.7853982);
      c = (c - 0.5) * k + 0.5 + u.a.x * 0.5;
    }
    case 1 { // hue / saturation / lightness
      var h = rgb2hsv(clamp(c, vec3f(0.0), vec3f(1.0)));
      h.x = fract(h.x + u.a.x / 360.0 + 1.0);
      c = hsv2rgb(h);
      let s = u.a.y;
      c = mix(vec3f(luma(c)), c, 1.0 + s * select(1.0, 2.0, s > 0.0));
      let l = u.a.z;
      c = mix(c, vec3f(select(0.0, 1.0, l > 0.0)), abs(l));
    }
    case 2 { // temperature / tint
      let t = u.a.x;
      let g = u.a.y;
      c *= vec3f(1.0 + 0.25 * t + 0.1 * g, 1.0 - 0.2 * g, 1.0 - 0.25 * t + 0.1 * g);
    }
    case 3 { // levels
      let span = max(u.a.y - u.a.x, 0.004);
      c = pow(clamp((c - u.a.x) / span, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / max(u.a.z, 0.05)));
    }
    case 4 { // invert
      c = 1.0 - c;
    }
    case 5 { // monochrome with tint
      let l = luma(c);
      let hue = hsv2rgb(vec3f(u.a.x / 360.0, 1.0, 1.0));
      c = vec3f(l) + (hue - 0.5) * (1.0 - abs(2.0 * l - 1.0)) * u.a.y;
    }
    case 6 { // posterize
      let n = max(round(u.a.x), 2.0) - 1.0;
      c = round(clamp(c, vec3f(0.0), vec3f(1.0)) * n) / n;
    }
    case 7 { // gaussian blur
      r = soft;
      spatial = true;
    }
    case 8 { // sharpen (unsharp mask)
      r = vec4f(o.rgb + (o.rgb - soft.rgb) * u.a.x, o.a);
      spatial = true;
    }
    case 9 { // noise
      let mono = hash(pos.xy) - 0.5;
      let rgb = vec3f(mono, hash(pos.xy + 71.7) - 0.5, hash(pos.xy + 193.1) - 0.5);
      c += mix(vec3f(mono), rgb, u.a.y) * u.a.x;
    }
    case 10 { // pixelate
      let size = max(u.a.x, 1.0);
      r = tap((floor(pos.xy / size) + 0.5) * size / u.doc.xy);
      spatial = true;
    }
    case 11 { // vignette
      let d = length(uv - 0.5) * 1.4142;
      let inner = u.a.y;
      let v = smoothstep(inner, inner + u.a.z + 0.002, d);
      let amount = u.a.x;
      c = mix(c, vec3f(select(1.0, 0.0, amount > 0.0)), v * abs(amount));
    }
    case 12 { // chromatic aberration
      let shift = (uv - 0.5) * 2.0 * u.a.x / u.doc.xy;
      let red = tap(uv + shift);
      let blue = tap(uv - shift);
      r = vec4f(red.r, o.g, blue.b, max(o.a, max(red.a, blue.a)));
      spatial = true;
    }
    case 13 { // glow
      let th = u.a.z;
      let g = max(soft.rgb - th * soft.a, vec3f(0.0)) / (1.0 - th) * u.a.y;
      let cover = clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0);
      r = vec4f(o.rgb + g * (1.0 - o.rgb), o.a + (1.0 - o.a) * cover);
      spatial = true;
    }
    case 14 { // halftone
      let size = max(u.a.x, 2.0);
      let ang = radians(u.a.y);
      let rot = mat2x2f(cos(ang), -sin(ang), sin(ang), cos(ang));
      let rp = rot * pos.xy;
      let centre = (floor(rp / size) + 0.5) * size;
      let cell = tap((transpose(rot) * centre) / u.doc.xy);
      let tone = luma(cell.rgb / max(cell.a, 1e-5));
      let radius = sqrt(clamp(1.0 - tone, 0.0, 1.0)) * size * 0.72;
      let ink = 1.0 - smoothstep(radius - 0.7, radius + 0.7, distance(rp, centre));
      c = vec3f(1.0 - ink);
    }
    default {}
  }

  if (!spatial) {
    r = vec4f(clamp(c, vec3f(0.0), vec3f(1.0)) * o.a, o.a);
  }
  let alpha = clamp(r.a, 0.0, 1.0);
  r = vec4f(clamp(r.rgb, vec3f(0.0), vec3f(alpha)), alpha);
  return mix(o, r, u.doc.w);
}
