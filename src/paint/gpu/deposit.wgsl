// Deposit pass: one instanced quad per dab, written into two float targets.
//
//   t0 = (paint.rgb, cover)          t1 = (paint.a, height, water, cover)
//
// Both use "one, one-minus-src-alpha" with the dab weight in alpha, so every
// channel is a true lerp towards the newest dab. That one rule gives opacity
// capping for inks, thinning for smudge (paint.a = 0) and erasing (paint = 0).
//
// Texture is evaluated in two fixed frames rather than baked into a stamp:
// paper in document space, bristles in stroke space (distance along the path,
// position across the tip). Neighbouring dabs therefore agree on what is under
// a pixel and streaks run continuously instead of repeating per stamp.

struct Dab {
  a: vec4f, // centre.xy, diameter, angle
  b: vec4f, // flow, pressure, distance travelled, per-dab random
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> dabs: array<Dab>;
@group(0) @binding(2) var reservoir: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

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
  let q = uv * vec2f(1.0, P.shape.x) * d.a.z * 0.5;
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

@fragment
fn fs(v: VOut) -> FOut {
  let d = dabs[v.idx];
  let size = d.a.z;
  let flow = d.b.x;
  let pressure = d.b.y;
  let dist = d.b.z;
  let dseed = d.b.w;
  let nominal = max(P.doc.z, 1.0);
  let seed = P.doc.w;
  let tip = u32(P.tip.x);
  let grain = P.media.x;
  let wetness = P.media.y;
  let flags = u32(P.flow.w);

  let r = length(v.uv);
  let aa = max(fwidth(r), 1e-4);
  let px = v.pos.xy;
  let tooth = paper(px, P.tip.w);

  // Paint left on the brush: it runs out with distance, faster when depleting.
  let load = exp(-P.flow.x * dist / nominal * 0.1);
  let wetLoad = clamp(load * (0.3 + 0.7 * pressure), 0.0, 1.0);

  // Hard tips keep about a pixel and a half of soft edge at any size.
  let hard = clamp(min(P.tip.y, 1.0 - aa * 1.5), 0.0, 0.999);
  let disc = 1.0 - smoothstep(hard, 1.0, r);

  var mask = disc;
  var height = 0.55;
  var tone = 1.0;

  switch tip {
    case 1u: {
      // Graphite: grit is locked to the page, so layering dabs builds tone
      // in the same specks instead of averaging to a flat grey.
      let grit = hash21(floor(px));
      mask = disc * smoothstep(0.3, 0.85, grit * 0.55 + tooth * 0.75);
      height = 0.1;
    }
    case 2u: {
      // Bristles in stroke space.
      let count = max(P.tip.z, 2.0);
      let across = v.uv.y;
      let along = (dist + v.uv.x * size * 0.5) / nominal;
      // Strand positions are fixed in pixels, not in tip units: when pressure
      // narrows the tip the outer strands lift off rather than all of them
      // sliding inwards, so successive dabs agree on where each strand runs.
      let sx = (across * size / nominal * 0.5 + 0.5) * count;
      let sid = floor(sx);
      let sf = abs(fract(sx) - 0.5) * 2.0;
      let h1 = hash21(vec2f(sid, seed));
      let h2 = hash21(vec2f(sid + 91.0, seed));
      // Bristles meet the surface along a line across the stroke, not a disc.
      // Each pixel is then marked once, as that line sweeps over it, so the
      // strands stay continuous round curves. Strands differ in length,
      // which staggers the line and leaves ragged ends.
      let lead = (v.uv.x - (h2 - 0.5) * 0.5) / 0.16;
      let contact = exp(-lead * lead);
      let silhouette = contact * (1.0 - smoothstep(0.86, 1.0, abs(across)));
      // Long streaks per strand, plus broader clumps spanning several strands.
      let streak = fbm(vec2f(along * 3.2 + h1 * 40.0, sid * 0.73 + seed));
      let clump = fbm(vec2f(along * 1.1 + seed, across * 2.3));
      let body = streak * 0.55 + clump * 0.45 + (h1 - 0.5) * 0.3;
      // A loaded brush covers fully; as it dries only the fullest strands mark.
      let threshold = mix(0.8, 0.1, wetLoad);
      let cover = smoothstep(threshold - 0.1, threshold + 0.1, body);
      let strand = 1.0 - sf * sf * mix(0.9, 0.2, wetLoad);
      mask = silhouette * cover * strand;
      height = (0.3 + 0.7 * h1) * (1.0 - sf * 0.75) * (0.55 + 0.9 * streak);
      tone = 1.0 + (h1 - 0.5) * 0.14 + (streak - 0.5) * 0.1;
    }
    case 3u: {
      // Splatter: a jittered grid of droplets, reshuffled for every dab.
      let g = v.uv * 4.0 + vec2f(dseed * 13.0, dseed * 7.0);
      let cell = floor(g);
      let offset = vec2f(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
      let radius = 0.07 + 0.3 * hash21(cell + 11.3);
      let dd = length(fract(g) - 0.5 - offset * 0.5);
      let lit = step(0.45, hash21(cell + 19.0 + floor(dseed * 64.0)));
      mask = (1.0 - smoothstep(radius - 0.07, radius, dd)) * lit
        * (1.0 - smoothstep(0.75, 1.0, r));
      height = 0.8;
    }
    case 4u: {
      // Chalk: a crumbly stick with a rough outline.
      let block = hash21(floor(px / max(1.0, size / 14.0)));
      let rough = vnoise(v.uv * 5.0 + seed);
      let outline = 1.0 - smoothstep(0.68, 0.95, r + (rough - 0.5) * 0.4);
      mask = outline * (0.5 + 0.5 * block);
      height = 0.25;
    }
    default: {}
  }

  if (wetness > 0.0) {
    // Granulation: suspended pigment settles into the valleys of the paper.
    mask *= mix(1.0, 0.6 + 0.8 * (1.0 - tooth), grain);
  } else {
    // Dry media only touch the ridges; pressure reaches further down.
    let reach = mix(0.12, 0.98, pressure * mix(1.0, load, 0.6));
    let contact = smoothstep(0.82 - reach, 1.18 - reach, tooth);
    mask *= mix(1.0, contact, grain);
  }

  var paint = P.color;
  if (P.media.z > 0.0) {
    // Each part of the tip carries whatever it has picked up from the canvas.
    paint = textureSampleLevel(reservoir, lin, v.uv * 0.5 + 0.5, 0.0);
  }
  paint = vec4f(min(paint.rgb * tone, vec3f(paint.a)), paint.a);
  if ((flags & 1u) != 0u) {
    paint = vec4f(0.0);
  }

  let w = clamp(flow * mask * mix(1.0, load, 0.5), 0.0, 1.0);
  let water = max(wetness, step(0.001, P.flow.y));

  var o: FOut;
  o.t0 = vec4f(paint.rgb * w, w);
  o.t1 = vec4f(paint.a * w, height * w, water * w, w);
  return o;
}
