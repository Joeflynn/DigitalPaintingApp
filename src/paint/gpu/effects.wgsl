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

fn straight(t: vec4f) -> vec3f {
  return t.rgb / max(t.a, 1e-5);
}

/// 4×4 ordered-dither threshold in 0–1 for an integer cell position.
fn bayer(p: vec2f) -> f32 {
  var m = array<f32, 16>(
    0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let x = u32(p.x) & 3u;
  let y = u32(p.y) & 3u;
  return (m[y * 4u + x] + 0.5) / 16.0;
}

/// One bit of a 5×5 character bitmap; `p` runs 0–1 across the cell.
fn glyph(n: i32, p: vec2f) -> f32 {
  let q = floor((p * 2.0 - 1.0) * vec2f(-4.0, -4.0) + 2.5);
  if (q.x < 0.0 || q.x > 4.0 || q.y < 0.0 || q.y > 4.0) {
    return 0.0;
  }
  let bit = u32(q.x + 5.0 * q.y);
  return f32((n >> bit) & 1);
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
    case 15 { // mask remap: threshold the blurred coverage
      r = vec4f(smoothstep(u.a.x, u.a.y, soft.a));
      spatial = true;
    }
    case 16 { // rgb shift: amount px, angle, anaglyph mix
      let ang = radians(u.a.y);
      let d = vec2f(cos(ang), sin(ang)) * u.a.x / u.doc.xy;
      let ra = tap(uv + d);
      let ba = tap(uv - d);
      let cover = max(o.a, max(ra.a, ba.a));
      let parted = vec4f(ra.r, o.g, ba.b, cover);
      let l2 = luma(ba.rgb);
      r = mix(parted, vec4f(luma(ra.rgb), l2, l2, cover), u.a.z);
      spatial = true;
    }
    case 17 { // crt: line pitch px, line strength, grille, curvature
      let pitch = max(u.a.x, 1.0);
      let k = u.a.w * 0.25;
      let p = uv * 2.0 - 1.0;
      let q = p * (1.0 + k * dot(p, p)) / (1.0 + k);
      let cuv = q * 0.5 + 0.5;
      let s = tap(cuv);
      let wave = 0.5 + 0.5 * cos(cuv.y * u.doc.y / pitch * 6.2831853);
      var rgb = s.rgb * (1.0 - u.a.y * (1.0 - wave)) * (1.0 + 0.45 * u.a.y);
      let stripe = i32(floor(pos.x / max(1.0, round(pitch / 3.0)))) % 3;
      let tri = vec3f(f32(stripe == 0), f32(stripe == 1), f32(stripe == 2));
      rgb *= mix(vec3f(1.0), 0.55 + tri * 1.35, u.a.z);
      rgb *= 1.0 - k * 1.6 * pow(dot(p, p) * 0.5, 1.5);
      let inside = step(abs(q.x), 1.0) * step(abs(q.y), 1.0);
      r = mix(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(rgb, s.a), inside);
      spatial = true;
    }
    case 18 { // vhs: chroma bleed px, wobble px, noise, tracking, seed
      let seed = u.b.x;
      let y = pos.y;
      var xoff = (sin(y * 0.021 + seed * 1.7) * 0.6 + sin(y * 0.13 + seed) * 0.25
        + (hash(vec2f(y, seed)) - 0.5) * 0.3) * u.a.y;
      let bd = (y - hash(vec2f(seed, 3.3)) * u.doc.y) / (u.doc.y * 0.05);
      let band = exp(-bd * bd) * u.a.w;
      xoff += band * u.doc.x * 0.08 * (hash(vec2f(floor(y / 2.0), seed + 9.0)) - 0.2);
      let head = smoothstep(0.965, 1.0, uv.y) * u.a.w;
      xoff += head * u.doc.x * 0.06 * hash(vec2f(floor(y / 3.0), seed + 4.0));
      let suv = uv + vec2f(xoff / u.doc.x, 0.0);
      let lum = tap(suv);
      var chroma = vec4f(0.0);
      for (var i = 0; i < 8; i++) {
        chroma += tap(suv + vec2f((f32(i) - 2.0) * u.a.x / 6.0 / u.doc.x, 0.0));
      }
      chroma /= 8.0;
      var rgb = vec3f(luma(lum.rgb)) + (chroma.rgb - luma(chroma.rgb)) * 1.15;
      rgb += (hash(pos.xy + seed * 13.0) - 0.5) * u.a.z * 0.4 * lum.a;
      let speck = step(0.72, hash(vec2f(floor(pos.x / 9.0) + seed, floor(y / 2.0))));
      rgb += (band + head) * speck * 0.6 * lum.a;
      r = vec4f(rgb, lum.a);
      spatial = true;
    }
    case 19 { // slices: shift px, slice height px, density, colour split px, seed
      let seed = u.b.x;
      let row = floor(pos.y / max(u.a.y, 1.0));
      let hit = step(1.0 - u.a.z, hash(vec2f(row, seed)));
      let off = (hash(vec2f(row, seed + 1.0)) - 0.5) * 2.0 * u.a.x * hit;
      let base = uv + vec2f(off / u.doc.x, 0.0);
      let sp = vec2f(u.a.w * hit / u.doc.x, 0.0);
      let g = tap(fract(base));
      let rr = tap(fract(base + sp));
      let bb = tap(fract(base - sp));
      r = vec4f(rr.r, g.g, bb.b, max(g.a, max(rr.a, bb.a)));
      spatial = true;
    }
    case 20 { // data corrupt: block px, shift px, density, colour damage, seed
      let seed = u.b.x;
      let size = max(u.a.x, 2.0);
      let cell = floor(pos.xy / vec2f(size * 2.0, size));
      let hit = step(1.0 - u.a.z, hash(cell + seed * 17.0));
      let off = (vec2f(hash(cell + seed + 1.3), hash(cell + seed + 7.1)) - 0.5)
        * 2.0 * u.a.y * hit * vec2f(1.0, 0.2);
      let s = tap(fract(uv + off / u.doc.xy));
      var rgb = s.rgb;
      let kind = hash(cell + seed + 23.7);
      if (hit > 0.5 && kind < u.a.w) {
        let pick = fract(kind * 91.7);
        if (pick < 0.34) {
          rgb = s.gbr;
        } else if (pick < 0.67) {
          rgb = s.a - s.rgb;
        } else {
          rgb = floor(s.rgb * 3.0 + 0.5) / 3.0;
        }
      }
      r = vec4f(rgb, s.a);
      spatial = true;
    }
    case 21 { // wave: amplitude px, wavelength px, angle, jagged
      let ang = radians(u.a.z);
      let dir = vec2f(cos(ang), sin(ang));
      let t = dot(pos.xy, vec2f(-dir.y, dir.x)) / max(u.a.y, 1.0);
      let stepped = (hash(vec2f(floor(t * 2.0), 4.2)) - 0.5) * 2.0;
      let w = mix(sin(t * 6.2831853), stepped, u.a.w);
      r = tap(uv + dir * w * u.a.x / u.doc.xy);
      spatial = true;
    }
    case 22 { // pixel drift: length px, threshold, angle, ragged
      let ang = radians(u.a.z);
      let dir = vec2f(cos(ang), sin(ang));
      let lane = floor(dot(pos.xy, vec2f(-dir.y, dir.x)) / 2.0);
      let reach = u.a.x * mix(1.0, hash(vec2f(lane, 9.1)), u.a.w);
      var best = o;
      var score = luma(o.rgb);
      for (var i = 1; i <= 48; i++) {
        let t = f32(i) / 48.0;
        let s = tap(uv - dir * t * reach / u.doc.xy);
        let l = luma(s.rgb);
        if (l > u.a.y && l * (1.0 - t * 0.5) > score) {
          best = s;
          score = l * (1.0 - t * 0.5);
        }
      }
      r = best;
      spatial = true;
    }
    case 23 { // duotone: shadow hue, highlight hue, saturation, contrast
      let l = clamp((luma(c) - 0.5) * (1.0 + u.a.w * 1.5) + 0.5, 0.0, 1.0);
      let dark = hsv2rgb(vec3f(u.a.x / 360.0, u.a.z, 0.22));
      let light = hsv2rgb(vec3f(u.a.y / 360.0, u.a.z * 0.6, 1.0));
      c = mix(dark, light, l);
    }
    case 24 { // spectrum map: cycles, offset, saturation, shade
      let l = clamp(luma(c), 0.0, 1.0);
      let hue = fract(u.a.y / 360.0 + l * u.a.x + 8.0);
      c = hsv2rgb(vec3f(hue, u.a.z, mix(1.0, sqrt(l), u.a.w)));
    }
    case 25 { // dither: pixel px, levels, colour, tint hue, tint
      let size = max(round(u.a.x), 1.0);
      let cell = floor(pos.xy / size);
      let s = tap((cell + 0.5) * size / u.doc.xy);
      let sc = clamp(straight(s), vec3f(0.0), vec3f(1.0));
      let n = max(round(u.a.y), 2.0) - 1.0;
      let th = (bayer(cell) - 0.5) / n;
      let cq = floor(clamp(sc + th, vec3f(0.0), vec3f(1.0)) * n + 0.5) / n;
      let lq = floor(clamp(luma(sc) + th, 0.0, 1.0) * n + 0.5) / n;
      var d = mix(vec3f(lq), cq, u.a.z);
      let ink = hsv2rgb(vec3f(u.a.w / 360.0, 0.8, 1.0));
      d = mix(d, mix(ink * 0.12, mix(ink, vec3f(1.0), 0.55), luma(d)), u.b.x);
      r = vec4f(d * s.a, s.a);
      spatial = true;
    }
    case 26 { // neon edges: width px, intensity, hue, source colour, background
      let e = u.a.x / u.doc.xy;
      let tl = luma(tap(uv + vec2f(-e.x, -e.y)).rgb);
      let tc = luma(tap(uv + vec2f(0.0, -e.y)).rgb);
      let tr = luma(tap(uv + vec2f(e.x, -e.y)).rgb);
      let ml = luma(tap(uv + vec2f(-e.x, 0.0)).rgb);
      let mr = luma(tap(uv + vec2f(e.x, 0.0)).rgb);
      let bl = luma(tap(uv + vec2f(-e.x, e.y)).rgb);
      let bc = luma(tap(uv + vec2f(0.0, e.y)).rgb);
      let br = luma(tap(uv + vec2f(e.x, e.y)).rgb);
      let gx = tr + 2.0 * mr + br - tl - 2.0 * ml - bl;
      let gy = bl + 2.0 * bc + br - tl - 2.0 * tc - tr;
      let edge = clamp(length(vec2f(gx, gy)) * u.a.y, 0.0, 1.0);
      var hs = rgb2hsv(clamp(c, vec3f(0.0), vec3f(1.0)));
      hs = vec3f(hs.x, max(hs.y, 0.65), 1.0);
      let neon = mix(hsv2rgb(vec3f(u.a.z / 360.0, 1.0, 1.0)), hsv2rgb(hs), u.a.w);
      c = mix(c * u.b.x, neon, edge);
    }
    case 27 { // kaleidoscope: segments, rotation, zoom
      let p = pos.xy - 0.5 * u.doc.xy;
      let rot = radians(u.a.y);
      let seg = 6.2831853 / max(round(u.a.x), 1.0);
      var a = atan2(p.y, p.x) - rot;
      a = abs(a - seg * floor(a / seg) - seg * 0.5);
      let q = vec2f(cos(a + rot), sin(a + rot)) * length(p) / max(u.a.z, 0.05);
      let m = fract((q / u.doc.xy + 0.5) * 0.5) * 2.0;
      r = tap(1.0 - abs(m - 1.0));
      spatial = true;
    }
    case 28 { // solarize: threshold, softness
      let w = u.a.y * 0.5 + 0.002;
      c = mix(c, 1.0 - c, smoothstep(vec3f(u.a.x - w), vec3f(u.a.x + w), c));
    }
    case 29 { // ascii: cell px, source colour, tint hue
      let size = max(u.a.x, 4.0);
      let cell = floor(pos.xy / size);
      let s = tap((cell + 0.5) * size / u.doc.xy);
      let sc = clamp(straight(s), vec3f(0.0), vec3f(1.0));
      let grey = luma(sc);
      var n = 4096;
      if (grey > 0.2) { n = 65600; }
      if (grey > 0.3) { n = 332772; }
      if (grey > 0.4) { n = 15255086; }
      if (grey > 0.5) { n = 23385164; }
      if (grey > 0.6) { n = 15252014; }
      if (grey > 0.7) { n = 13199452; }
      if (grey > 0.8) { n = 11512810; }
      let on_ink = glyph(n, pos.xy / size - cell) * step(0.04, grey);
      let tint = hsv2rgb(vec3f(u.a.z / 360.0, 0.85, 1.0)) * (0.45 + 0.55 * grey);
      let lit = sc / max(max(sc.r, max(sc.g, sc.b)), 0.2);
      r = vec4f(mix(tint, lit, u.a.y) * on_ink * s.a, s.a);
      spatial = true;
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
