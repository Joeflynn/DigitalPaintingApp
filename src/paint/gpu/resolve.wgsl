// Resolve pass: turns the stroke buffers into the layer as it should look.
// Paint thickness is treated as a height field; its slope gives a normal, and
// the normal is lit with a raking light for diffuse shading and a specular
// glint. The lit stroke is then laid over the base with the stroke opacity.

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

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(pos.xy);
  let base = textureLoad(baseTex, p, 0);
  let a0 = textureLoad(t0, p, 0);
  let cover = a0.a;
  if (cover < 1e-4) {
    return base;
  }
  let a1 = textureLoad(t1, p, 0);
  var paint = a0.rgb;
  let alpha = a1.r;

  let relief = P.media.z;
  if (relief > 0.0) {
    let limit = vec2i(P.doc.xy) - vec2i(1);
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

  let k = clamp(cover * P.flow.y, 0.0, 1.0);
  var o = layPaint(base, vec4f(paint, alpha) / cover, k, P.flow.w);

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
