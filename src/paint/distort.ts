import { makeCanvas } from "./util"

/**
 * Layer distortion. Every mode works the same way underneath: the layer is a
 * texture stretched over a fine mesh, and distorting it means moving the
 * mesh's vertices. Warp and Perspective place the vertices from a handful of
 * control points; Liquify pushes them around directly with a brush.
 */

export type DistortMode = "warp" | "perspective" | "liquify"
export type LiquifyTool = "push" | "twirl-cw" | "twirl-ccw" | "pinch" | "bloat" | "restore"

export interface Mesh {
  /** Cells across and down; there is one more vertex than cells each way. */
  cols: number
  rows: number
  /** Where each vertex is now, as x,y pairs in document pixels. */
  pos: Float32Array
  /** Where each vertex started — which is also what it samples. */
  orig: Float32Array
}

export interface DistortSession {
  mode: DistortMode
  mesh: Mesh
  /** Control points (x,y pairs): a lattice for warp, four corners for perspective. */
  ctrl: Float32Array | null
  /** Warp: control cells per side. */
  n: number
  /** Mesh lines per grid line drawn in the overlay. */
  step: number
  w: number
  h: number
}

function makeMesh(cols: number, rows: number, w: number, h: number): Mesh {
  const pos = new Float32Array((cols + 1) * (rows + 1) * 2)
  let k = 0
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      pos[k++] = (i / cols) * w
      pos[k++] = (j / rows) * h
    }
  }
  return { cols, rows, pos, orig: pos.slice() }
}

export function makeSession(
  mode: DistortMode,
  w: number,
  h: number,
  warpGrid: number
): DistortSession {
  if (mode === "liquify") {
    const cell = Math.max(w, h) / 220
    const cols = Math.max(8, Math.round(w / cell))
    const rows = Math.max(8, Math.round(h / cell))
    return {
      mode,
      mesh: makeMesh(cols, rows, w, h),
      ctrl: null,
      n: 0,
      step: Math.max(1, Math.round(Math.max(cols, rows) / 30)),
      w,
      h,
    }
  }
  if (mode === "perspective") {
    return {
      mode,
      mesh: makeMesh(48, 48, w, h),
      ctrl: new Float32Array([0, 0, w, 0, w, h, 0, h]),
      n: 1,
      step: 8,
      w,
      h,
    }
  }
  const n = Math.max(1, Math.min(6, Math.round(warpGrid)))
  const sub = Math.ceil(72 / n)
  const ctrl = new Float32Array((n + 1) * (n + 1) * 2)
  let k = 0
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      ctrl[k++] = (i / n) * w
      ctrl[k++] = (j / n) * h
    }
  }
  return { mode, mesh: makeMesh(n * sub, n * sub, w, h), ctrl, n, step: sub, w, h }
}

/** Catmull-Rom weights for the four points around parameter t. */
function crWeights(t: number, out: Float64Array) {
  const t2 = t * t
  const t3 = t2 * t
  out[0] = -0.5 * t3 + t2 - 0.5 * t
  out[1] = 1.5 * t3 - 2.5 * t2 + 1
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t
  out[3] = 0.5 * t3 - 0.5 * t2
}

/**
 * Warp: a smooth surface through the control lattice. Points beyond the edge
 * are extrapolated, so with a single cell this is a plain four-corner stretch.
 */
function warpMesh(s: DistortSession) {
  const { mesh, n } = s
  const ctrl = s.ctrl!
  const m = n + 3
  // The lattice padded by one extrapolated ring.
  const pad = new Float64Array(m * m * 2)
  const at = (i: number, j: number) => ((j + 1) * m + (i + 1)) * 2
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const src = (j * (n + 1) + i) * 2
      pad[at(i, j)] = ctrl[src]
      pad[at(i, j) + 1] = ctrl[src + 1]
    }
  }
  for (let c = 0; c < 2; c++) {
    for (let j = 0; j <= n; j++) {
      pad[at(-1, j) + c] = 2 * pad[at(0, j) + c] - pad[at(1, j) + c]
      pad[at(n + 1, j) + c] = 2 * pad[at(n, j) + c] - pad[at(n - 1, j) + c]
    }
    for (let i = -1; i <= n + 1; i++) {
      pad[at(i, -1) + c] = 2 * pad[at(i, 0) + c] - pad[at(i, 1) + c]
      pad[at(i, n + 1) + c] = 2 * pad[at(i, n) + c] - pad[at(i, n - 1) + c]
    }
  }
  const wu = new Float64Array(4)
  const wv = new Float64Array(4)
  let k = 0
  for (let j = 0; j <= mesh.rows; j++) {
    const sv = (j / mesh.rows) * n
    const cj = Math.min(n - 1, Math.floor(sv))
    crWeights(sv - cj, wv)
    for (let i = 0; i <= mesh.cols; i++) {
      const su = (i / mesh.cols) * n
      const ci = Math.min(n - 1, Math.floor(su))
      crWeights(su - ci, wu)
      let x = 0
      let y = 0
      for (let b = 0; b < 4; b++) {
        for (let a = 0; a < 4; a++) {
          const p = at(ci - 1 + a, cj - 1 + b)
          const wgt = wu[a] * wv[b]
          x += pad[p] * wgt
          y += pad[p + 1] * wgt
        }
      }
      mesh.pos[k++] = x
      mesh.pos[k++] = y
    }
  }
}

/** Perspective: the projective map taking the layer's rectangle to the quad. */
function perspectiveMesh(s: DistortSession) {
  const { mesh } = s
  const [x0, y0, x1, y1, x2, y2, x3, y3] = s.ctrl!
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  let g = 0
  let h = 0
  if (Math.abs(den) > 1e-9 && (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9)) {
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
  }
  const a = x1 - x0 + g * x1
  const b = x3 - x0 + h * x3
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + h * y3
  let k = 0
  for (let j = 0; j <= mesh.rows; j++) {
    const v = j / mesh.rows
    for (let i = 0; i <= mesh.cols; i++) {
      const u = i / mesh.cols
      const wgt = g * u + h * v + 1
      const inv = Math.abs(wgt) > 1e-6 ? 1 / wgt : 1e6
      mesh.pos[k++] = (a * u + b * v + x0) * inv
      mesh.pos[k++] = (d * u + e * v + y0) * inv
    }
  }
}

/** Recomputes the mesh after a control point has moved. */
export function updateMesh(s: DistortSession) {
  if (s.mode === "warp") warpMesh(s)
  else if (s.mode === "perspective") perspectiveMesh(s)
}

/** Index of the control point nearest (x, y). */
export function nearestControl(s: DistortSession, x: number, y: number): number {
  const c = s.ctrl
  if (!c) return -1
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < c.length; i += 2) {
    const d = (c[i] - x) ** 2 + (c[i + 1] - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i / 2
    }
  }
  return best
}

/**
 * One touch of the liquify brush at (cx, cy); (dx, dy) is how far it moved
 * since the last one. The layer's edges stay pinned.
 */
export function liquifyDab(
  mesh: Mesh,
  tool: LiquifyTool,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  radius: number,
  strength: number
): boolean {
  const { cols, rows, pos, orig } = mesh
  const r2 = radius * radius
  const spin = tool === "twirl-cw" ? 1 : tool === "twirl-ccw" ? -1 : 0
  let changed = false
  for (let j = 1; j < rows; j++) {
    for (let i = 1; i < cols; i++) {
      const k = (j * (cols + 1) + i) * 2
      const px = pos[k] - cx
      const py = pos[k + 1] - cy
      const d2 = px * px + py * py
      if (d2 >= r2) continue
      const f = (1 - d2 / r2) ** 2 * strength
      changed = true
      if (tool === "push") {
        pos[k] += dx * f
        pos[k + 1] += dy * f
      } else if (spin) {
        const a = spin * 0.1 * f
        const c = Math.cos(a)
        const s = Math.sin(a)
        pos[k] = cx + px * c - py * s
        pos[k + 1] = cy + px * s + py * c
      } else if (tool === "pinch") {
        pos[k] -= px * 0.06 * f
        pos[k + 1] -= py * 0.06 * f
      } else if (tool === "bloat") {
        pos[k] += px * 0.06 * f
        pos[k + 1] += py * 0.06 * f
      } else {
        pos[k] += (orig[k] - pos[k]) * 0.2 * f
        pos[k + 1] += (orig[k + 1] - pos[k + 1]) * 0.2 * f
      }
    }
  }
  return changed
}

// ---- rendering -----------------------------------------------------------------

const VERT = `#version 300 es
in vec2 aPos;
in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vec2 p = aPos / uSize * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vUv = aUv;
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() {
  o = texture(uTex, vUv);
}`

/** Draws a canvas stretched over a mesh, using WebGL. */
export class DistortRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private posBuf: WebGLBuffer
  private uvBuf: WebGLBuffer
  private idxBuf: WebGLBuffer
  private uSize: WebGLUniformLocation | null
  private textures: (WebGLTexture | null)[] = [null, null]
  /** The mesh shape the static buffers were built for. */
  private shape = ""
  private count = 0

  static create(): DistortRenderer | null {
    try {
      return new DistortRenderer()
    } catch {
      return null
    }
  }

  private constructor() {
    this.canvas = makeCanvas(1, 1)
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    })
    if (!gl) throw new Error("WebGL2 unavailable")
    this.gl = gl
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? "shader")
      }
      return sh
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.bindAttribLocation(prog, 0, "aPos")
    gl.bindAttribLocation(prog, 1, "aUv")
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? "link")
    }
    gl.useProgram(prog)
    this.uSize = gl.getUniformLocation(prog, "uSize")
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0)
    this.posBuf = gl.createBuffer()
    this.uvBuf = gl.createBuffer()
    this.idxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  }

  /** Whether a canvas this size can be used as a texture. */
  fits(w: number, h: number): boolean {
    return Math.max(w, h) <= this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)
  }

  /** Loads the picture to be distorted into one of two slots. */
  setSource(slot: 0 | 1, src: HTMLCanvasElement) {
    const gl = this.gl
    const tex = this.textures[slot] ?? gl.createTexture()
    this.textures[slot] = tex
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** Draws a slot's picture over the mesh; the result is this.canvas. */
  render(slot: 0 | 1, mesh: Mesh, w: number, h: number): HTMLCanvasElement {
    const gl = this.gl
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const shape = `${mesh.cols}x${mesh.rows}:${w}x${h}`
    if (shape !== this.shape) {
      this.shape = shape
      const uv = new Float32Array(mesh.orig.length)
      for (let i = 0; i < uv.length; i += 2) {
        uv[i] = mesh.orig[i] / w
        uv[i + 1] = mesh.orig[i + 1] / h
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW)
      const idx = new Uint32Array(mesh.cols * mesh.rows * 6)
      const stride = mesh.cols + 1
      let k = 0
      for (let j = 0; j < mesh.rows; j++) {
        for (let i = 0; i < mesh.cols; i++) {
          const a = j * stride + i
          idx[k++] = a
          idx[k++] = a + 1
          idx[k++] = a + stride
          idx[k++] = a + 1
          idx[k++] = a + stride + 1
          idx[k++] = a + stride
        }
      }
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
      this.count = idx.length
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW)
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.uSize, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[slot])
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0)
    return this.canvas
  }
}

/**
 * Moves a session so it covers the rectangle at (x, y) instead of the
 * document's corner. The renderer samples by each vertex's original
 * position, so the mesh still reads the right pixels.
 */
export function offsetSession(s: DistortSession, x: number, y: number) {
  const shift = (a: Float32Array) => {
    for (let i = 0; i < a.length; i += 2) {
      a[i] += x
      a[i + 1] += y
    }
  }
  shift(s.mesh.pos)
  shift(s.mesh.orig)
  if (s.ctrl) shift(s.ctrl)
}
