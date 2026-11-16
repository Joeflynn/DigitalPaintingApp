// Marching ants: outlines the selection at its 50% contour. Each screen
// pixel is mapped back into the document, and it is on the outline when the
// selection flips between it and one of its neighbours.

struct U {
  view: vec4f,  // translate x, translate y, scale, rotation — device pixels
  doc: vec4f,   // width, height, phase, device pixel ratio
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(tri[vi], 0.0, 1.0);
}

fn selected(p: vec2f) -> bool {
  let d = (p - u.view.xy) / u.view.z;
  let c = cos(u.view.w);
  let s = sin(u.view.w);
  let uv = vec2f(d.x * c + d.y * s, -d.x * s + d.y * c) / u.doc.xy;
  let inside = uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
  return inside && textureSampleLevel(mask, smp, uv, 0.0).a > 0.5;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let w = u.doc.w * 0.75;
  let here = selected(pos.xy);
  let edge = selected(pos.xy + vec2f(w, 0.0)) != here
    || selected(pos.xy - vec2f(w, 0.0)) != here
    || selected(pos.xy + vec2f(0.0, w)) != here
    || selected(pos.xy - vec2f(0.0, w)) != here;
  if (!edge) {
    return vec4f(0.0);
  }
  let stripe = fract((pos.x + pos.y) / (10.0 * u.doc.w) - u.doc.z);
  let v = select(0.0, 1.0, stripe < 0.5);
  return vec4f(v, v, v, 1.0);
}
