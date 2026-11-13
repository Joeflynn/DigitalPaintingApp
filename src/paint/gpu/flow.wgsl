// Wet-paint simulation, one step per frame while paint is still wet. It reads
// one pair of stroke buffers and writes the other.
//
//  - Bleed: wet paint creeps into its neighbours along an uneven, paper-shaped
//    front.
//  - Pooling: pigment is pushed away from its wider local average, which piles
//    it up at the rim of a wash and leaves the dark edge watercolour dries to.
//  - Drips: very wet paint runs downhill in irregular columns, thinning as it
//    goes.
//
// Water (t1.b) dries a little every step, so all three fade out on their own.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var s0: texture_2d<f32>;
@group(0) @binding(2) var s1: texture_2d<f32>;
@group(0) @binding(3) var lin: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var tri = FULLSCREEN;
  return vec4f(tri[vi], 0.0, 1.0);
}

struct FOut {
  @location(0) t0: vec4f,
  @location(1) t1: vec4f,
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> FOut {
  let p = pos.xy;
  let inv = 1.0 / P.doc.xy;
  let uv = p * inv;

  let c0 = textureSampleLevel(s0, lin, uv, 0.0);
  let c1 = textureSampleLevel(s1, lin, uv, 0.0);

  let tooth = paper(p, P.tip.w);
  // Near ring: radius varies with the paper so the wet front is irregular.
  let rn = 1.0 + 2.2 * tooth;
  let nx = vec2f(rn * inv.x, 0.0);
  let ny = vec2f(0.0, rn * inv.y);
  let near0 = (textureSampleLevel(s0, lin, uv - nx, 0.0) + textureSampleLevel(s0, lin, uv + nx, 0.0)
    + textureSampleLevel(s0, lin, uv - ny, 0.0) + textureSampleLevel(s0, lin, uv + ny, 0.0)) * 0.25;
  let near1 = (textureSampleLevel(s1, lin, uv - nx, 0.0) + textureSampleLevel(s1, lin, uv + nx, 0.0)
    + textureSampleLevel(s1, lin, uv - ny, 0.0) + textureSampleLevel(s1, lin, uv + ny, 0.0)) * 0.25;

  // Far ring on the diagonals, for the wider average pooling works against.
  let rf = 5.0;
  let fa = vec2f(rf * inv.x, rf * inv.y);
  let fb = vec2f(rf * inv.x, -rf * inv.y);
  let far0 = (textureSampleLevel(s0, lin, uv - fa, 0.0) + textureSampleLevel(s0, lin, uv + fa, 0.0)
    + textureSampleLevel(s0, lin, uv - fb, 0.0) + textureSampleLevel(s0, lin, uv + fb, 0.0)) * 0.25;
  let far1 = (textureSampleLevel(s1, lin, uv - fa, 0.0) + textureSampleLevel(s1, lin, uv + fa, 0.0)
    + textureSampleLevel(s1, lin, uv - fb, 0.0) + textureSampleLevel(s1, lin, uv + fb, 0.0)) * 0.25;

  // How wet the paint here is, regardless of how much of it there is.
  let water = clamp(c1.b / max(c1.a, 1e-3), 0.0, 1.0) * smoothstep(0.0, 0.04, c1.a);
  let nearWater = clamp(near1.b / max(near1.a, 1e-3), 0.0, 1.0) * smoothstep(0.0, 0.04, near1.a);
  // A dry pixel next to wet paint still receives it.
  let bleed = clamp(P.sim.x * max(water, nearWater), 0.0, 0.9);
  var o0 = mix(c0, near0, bleed);
  var o1 = mix(c1, near1, bleed);

  let pool = P.sim.y * water;
  let d0 = (c0 - far0) * pool;
  let d1 = (c1 - far1) * pool;
  o0 = max(o0 + d0, vec4f(0.0));
  o1 = max(vec4f(o1.r + d1.r, o1.g, o1.b, o1.a + d1.a), vec4f(0.0));

  if (P.sim.z > 0.0) {
    // Columns where the paint happens to be heavy enough to run.
    let column = vnoise(vec2f(p.x / max(P.doc.z * 0.2, 3.0), P.doc.w * 3.7));
    let run = smoothstep(0.58, 0.92, column);
    let up = uv - vec2f(0.0, P.sim.z * (0.4 + 2.2 * run) * inv.y);
    let a0 = textureSampleLevel(s0, lin, up, 0.0);
    let a1 = textureSampleLevel(s1, lin, up, 0.0);
    // Only properly wet paint moves, so a drip tapers off as it dries.
    let carry = smoothstep(0.22, 0.6, a1.b) * run;
    o0 = max(o0, a0 * carry);
    o1 = vec4f(
      max(o1.r, a1.r * carry),
      max(o1.g, a1.g * carry * 1.02),
      max(o1.b, a1.b * carry * 0.992),
      max(o1.a, a1.a * carry),
    );
  }

  o1.b *= P.sim.w;

  var o: FOut;
  o.t0 = o0;
  o.t1 = o1;
  return o;
}
