// Reservoir pass: a small texture laid over the brush tip that remembers what
// each part of the tip is carrying. Every frame it soaks up some of the canvas
// under the tip and is topped up with fresh paint, then the deposit pass
// samples it. This is what makes oils drag neighbouring colours along in
// streaks and lets the smudge tool work with any tip.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var prev: texture_2d<f32>;
@group(0) @binding(2) var baseTex: texture_2d<f32>;
@group(0) @binding(3) var t0: texture_2d<f32>;
@group(0) @binding(4) var t1: texture_2d<f32>;
@group(0) @binding(5) var lin: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var tri = FULLSCREEN;
  return vec4f(tri[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(prev));
  // Framebuffer rows run top-down, matching the tip's v axis in the deposit pass.
  let uv = pos.xy / dims * 2.0 - 1.0;
  let q = uv * vec2f(1.0, P.res1.w) * P.res0.z * 0.5;
  let c = cos(P.res0.w);
  let s = sin(P.res0.w);
  let p = P.res0.xy + vec2f(c * q.x - s * q.y, s * q.x + c * q.y);
  let st = p / P.doc.xy;

  var canvas = vec4f(0.0);
  if (all(st >= vec2f(0.0)) && all(st <= vec2f(1.0))) {
    canvas = composite(
      textureSampleLevel(baseTex, lin, st, 0.0),
      textureSampleLevel(t0, lin, st, 0.0),
      textureSampleLevel(t1, lin, st, 0.0),
      P.flow.y,
      P.flow.w,
    );
  }

  let old = textureLoad(prev, vec2i(pos.xy), 0);
  // A loaded brush ignores bare paper; the smudge tool (res1.z = 1) lets it
  // thin out whatever the tip is carrying.
  let rate = P.res1.x * mix(canvas.a, 1.0, P.res1.z);
  let carried = mixPaint(old, canvas, rate);
  return mixPaint(carried, P.color, P.res1.y);
}
