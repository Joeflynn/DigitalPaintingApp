import { useSyncExternalStore } from "react"

import { engine, type FrameInfo } from "./engine"
import { renderReference, type ModelId, type RefStyle } from "./ref3d"
import type { DabTransform } from "./stroke"

/**
 * Drawing aids: symmetry painting, grids and perspective guides, and a 3D
 * reference to trace over. All of it is drawn over the canvas on screen only,
 * so none of it reaches the layers or an export.
 */

export type SymmetryMode = "vertical" | "horizontal" | "quad" | "radial"
export type GridKind = "square" | "iso" | "thirds"

export interface Point {
  x: number
  y: number
}

export interface AidsState {
  symmetry: {
    on: boolean
    mode: SymmetryMode
    /** Number of repeats around the centre, for radial symmetry. */
    segments: number
    /** Radial repeats are also mirrored, kaleidoscope style. */
    mirror: boolean
    /** Centre as a fraction of the canvas. */
    cx: number
    cy: number
    /** Tilt of the axes in degrees. */
    angle: number
  }
  grid: { on: boolean; kind: GridKind; size: number }
  perspective: {
    on: boolean
    points: 1 | 2 | 3
    /** Vanishing points as fractions of the canvas; they may lie outside it. */
    vp: [Point, Point, Point]
    /** Lines drawn from each vanishing point. */
    density: number
    /** The vanishing points can be dragged on the canvas. */
    editing: boolean
  }
  guideOpacity: number
  reference: {
    on: boolean
    model: ModelId
    pose: string
    style: RefStyle
    floor: boolean
    /** Orbit around the model, in degrees. */
    yaw: number
    pitch: number
    /** How much of the canvas height the model fills. */
    size: number
    /** Lens angle in degrees: wide exaggerates perspective, narrow flattens it. */
    fov: number
    /** Where the model sits on the canvas, −1…1 from the centre. */
    x: number
    y: number
    opacity: number
    /** Dragging on the canvas moves the camera instead of painting. */
    adjusting: boolean
  }
}

const KEY = "pigment.aids.v1"

const DEFAULT_VP: [Point, Point, Point] = [
  { x: -0.25, y: 0.45 },
  { x: 1.25, y: 0.45 },
  { x: 0.5, y: 2.2 },
]

function defaults(): AidsState {
  return {
    symmetry: { on: false, mode: "vertical", segments: 6, mirror: true, cx: 0.5, cy: 0.5, angle: 0 },
    grid: { on: false, kind: "square", size: 100 },
    perspective: {
      on: false,
      points: 2,
      vp: DEFAULT_VP.map((p) => ({ ...p })) as [Point, Point, Point],
      density: 16,
      editing: false,
    },
    guideOpacity: 0.7,
    reference: {
      on: false,
      model: "mannequin",
      pose: "standing",
      style: "shaded",
      floor: true,
      yaw: 30,
      pitch: 12,
      size: 0.8,
      fov: 40,
      x: 0,
      y: 0,
      opacity: 0.6,
      adjusting: false,
    },
  }
}

function load(): AidsState {
  const base = defaults()
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<AidsState> | null
    if (raw && typeof raw === "object") {
      return {
        symmetry: { ...base.symmetry, ...raw.symmetry },
        grid: { ...base.grid, ...raw.grid },
        perspective: { ...base.perspective, ...raw.perspective, editing: false },
        guideOpacity: raw.guideOpacity ?? base.guideOpacity,
        reference: { ...base.reference, ...raw.reference, adjusting: false },
      }
    }
  } catch {
    // fall through to the defaults
  }
  return base
}

let state = load()
const subscribers = new Set<() => void>()
const frameListeners = new Set<(frame: FrameInfo) => void>()

function commit(next: AidsState) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // not remembered
  }
  subscribers.forEach((fn) => fn())
  engine.requestRender()
}

export const aids = {
  subscribe(fn: () => void) {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },
  get: () => state,
  setSymmetry(patch: Partial<AidsState["symmetry"]>) {
    commit({ ...state, symmetry: { ...state.symmetry, ...patch } })
  },
  toggleSymmetry() {
    aids.setSymmetry({ on: !state.symmetry.on })
  },
  setGrid(patch: Partial<AidsState["grid"]>) {
    commit({ ...state, grid: { ...state.grid, ...patch } })
  },
  setPerspective(patch: Partial<AidsState["perspective"]>) {
    commit({ ...state, perspective: { ...state.perspective, ...patch } })
  },
  setVanishingPoint(i: number, p: Point) {
    const vp = state.perspective.vp.map((old, k) => (k === i ? p : old)) as [Point, Point, Point]
    aids.setPerspective({ vp })
  },
  resetVanishingPoints() {
    aids.setPerspective({ vp: DEFAULT_VP.map((p) => ({ ...p })) as [Point, Point, Point] })
  },
  setGuideOpacity(guideOpacity: number) {
    commit({ ...state, guideOpacity })
  },
  setReference(patch: Partial<AidsState["reference"]>) {
    commit({ ...state, reference: { ...state.reference, ...patch } })
  },
  resetCamera() {
    const d = defaults().reference
    aids.setReference({ yaw: d.yaw, pitch: d.pitch, size: d.size, fov: d.fov, x: 0, y: 0 })
  },
  /** Called with the view after every canvas frame, to keep handles in place. */
  onFrame(fn: (frame: FrameInfo) => void) {
    frameListeners.add(fn)
    engine.requestRender()
    return () => {
      frameListeners.delete(fn)
    }
  },
}

export function useAids() {
  return useSyncExternalStore(aids.subscribe, aids.get)
}

/** Where a document point lands on screen, in CSS pixels of the canvas area. */
export function docToScreen(f: FrameInfo, x: number, y: number): [number, number] {
  const c = Math.cos(f.rot) * f.scale
  const s = Math.sin(f.rot) * f.scale
  return [f.tx + c * x - s * y, f.ty + s * x + c * y]
}

// ---- symmetry ---------------------------------------------------------------

function rotation(cx: number, cy: number, ang: number): DabTransform {
  const a = Math.cos(ang)
  const b = Math.sin(ang)
  return { a, b, c: -b, d: a, e: cx - a * cx + b * cy, f: cy - b * cx - a * cy, flip: false, ang }
}

/** Mirror across the line through (cx, cy) heading at `phi`. */
function reflection(cx: number, cy: number, phi: number): DabTransform {
  const a = Math.cos(2 * phi)
  const b = Math.sin(2 * phi)
  return { a, b, c: b, d: -a, e: cx - a * cx - b * cy, f: cy - b * cx + a * cy, flip: true, ang: 2 * phi }
}

/** Headings of the mirror lines for the current settings. */
function mirrorAxes(): number[] {
  const { mode, segments, mirror, angle } = state.symmetry
  const up = Math.PI / 2 + (angle * Math.PI) / 180
  if (mode === "vertical") return [up]
  if (mode === "horizontal") return [up + Math.PI / 2]
  if (mode === "quad") return [up, up + Math.PI / 2]
  return mirror ? Array.from({ length: segments }, (_, k) => up + (k * Math.PI) / segments) : []
}

function symmetryTransforms(docW: number, docH: number): DabTransform[] {
  const sym = state.symmetry
  if (!sym.on) return []
  const cx = sym.cx * docW
  const cy = sym.cy * docH
  const out = mirrorAxes().map((phi) => reflection(cx, cy, phi))
  if (sym.mode === "quad") out.push(rotation(cx, cy, Math.PI))
  if (sym.mode === "radial") {
    for (let k = 1; k < sym.segments; k++) out.push(rotation(cx, cy, (k * 2 * Math.PI) / sym.segments))
  }
  return out
}

// ---- drawing ----------------------------------------------------------------

const VP_COLORS = ["#4aa3df", "#f0803c", "#5fc27a"]
export { VP_COLORS }

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
}

function drawGrid(ctx: CanvasRenderingContext2D, f: FrameInfo) {
  const { kind, size } = state.grid
  const { docW, docH } = f
  ctx.beginPath()
  if (kind === "thirds") {
    for (const t of [1 / 3, 2 / 3]) {
      line(ctx, docW * t, 0, docW * t, docH)
      line(ctx, 0, docH * t, docW, docH * t)
    }
  } else if (kind === "square") {
    // Counted out from the centre so the grid is symmetrical on the page.
    for (let x = (docW / 2) % size; x < docW; x += size) line(ctx, x, 0, x, docH)
    for (let y = (docH / 2) % size; y < docH; y += size) line(ctx, 0, y, docW, y)
  } else {
    // Isometric: verticals plus two families of lines at ±30°.
    const dx = size * Math.cos(Math.PI / 6)
    for (let x = (docW / 2) % dx; x < docW; x += dx) line(ctx, x, 0, x, docH)
    const rise = docW * Math.tan(Math.PI / 6)
    const y0 = ((docH / 2 - rise / 2) % size) - Math.ceil(rise / size) * size
    for (let y = y0; y < docH + rise; y += size) {
      line(ctx, 0, y, docW, y + rise)
      line(ctx, 0, y, docW, y - rise)
    }
  }
  ctx.strokeStyle = "rgba(120, 190, 255, 0.85)"
  ctx.stroke()
}

/** Rays from a vanishing point across the page, plus a marker on the point. */
function drawFan(ctx: CanvasRenderingContext2D, f: FrameInfo, vp: Point, color: string) {
  const { docW, docH } = f
  const x = vp.x * docW
  const y = vp.y * docH
  const n = state.perspective.density
  const far = Math.hypot(docW, docH) + Math.hypot(x - docW / 2, y - docH / 2)
  const inside = x >= 0 && x <= docW && y >= 0 && y <= docH
  ctx.beginPath()
  if (inside) {
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI) / n
      line(ctx, x - Math.cos(a) * far, y - Math.sin(a) * far, x + Math.cos(a) * far, y + Math.sin(a) * far)
    }
  } else {
    // Spread the lines over just the angle the page takes up from out here.
    const mid = Math.atan2(docH / 2 - y, docW / 2 - x)
    let lo = 0
    let hi = 0
    for (const [px, py] of [[0, 0], [docW, 0], [0, docH], [docW, docH]]) {
      let d = Math.atan2(py - y, px - x) - mid
      d = Math.atan2(Math.sin(d), Math.cos(d))
      lo = Math.min(lo, d)
      hi = Math.max(hi, d)
    }
    for (let i = 0; i <= n; i++) {
      const a = mid + lo + ((hi - lo) * i) / n
      line(ctx, x, y, x + Math.cos(a) * far, y + Math.sin(a) * far)
    }
  }
  ctx.strokeStyle = color
  ctx.stroke()
}

function drawPerspective(ctx: CanvasRenderingContext2D, f: FrameInfo) {
  const { points, vp } = state.perspective
  const { docW, docH } = f
  for (let i = 0; i < points; i++) drawFan(ctx, f, vp[i], VP_COLORS[i])
  // The horizon: level through a single point, otherwise through the first two.
  const ax = vp[0].x * docW
  const ay = vp[0].y * docH
  let dx = 1
  let dy = 0
  if (points > 1) {
    dx = vp[1].x * docW - ax
    dy = vp[1].y * docH - ay
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
  }
  const far = Math.hypot(docW, docH) + Math.hypot(ax, ay)
  ctx.beginPath()
  line(ctx, ax - dx * far, ay - dy * far, ax + dx * far, ay + dy * far)
  ctx.lineWidth *= 2
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"
  ctx.stroke()
}

function drawSymmetry(ctx: CanvasRenderingContext2D, f: FrameInfo, px: number) {
  const sym = state.symmetry
  const cx = sym.cx * f.docW
  const cy = sym.cy * f.docH
  const far = Math.hypot(f.docW, f.docH)
  ctx.lineWidth = 1.5 * px
  ctx.strokeStyle = "rgba(56, 189, 148, 0.95)"
  ctx.setLineDash([8 * px, 6 * px])
  ctx.beginPath()
  for (const phi of mirrorAxes()) {
    line(ctx, cx - Math.cos(phi) * far, cy - Math.sin(phi) * far, cx + Math.cos(phi) * far, cy + Math.sin(phi) * far)
  }
  if (sym.mode === "radial" && !sym.mirror) {
    // Rotation only: spokes show the slices without implying a mirror.
    const up = -Math.PI / 2 + (sym.angle * Math.PI) / 180
    for (let k = 0; k < sym.segments; k++) {
      const a = up + (k * 2 * Math.PI) / sym.segments
      line(ctx, cx, cy, cx + Math.cos(a) * far, cy + Math.sin(a) * far)
    }
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(cx, cy, 4 * px, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(56, 189, 148, 0.95)"
  ctx.fill()
}

function drawReference(ctx: CanvasRenderingContext2D, f: FrameInfo) {
  const ref = state.reference
  // Render at about screen resolution, in coarse steps so zooming doesn't
  // re-render the model on every frame.
  const want = Math.max(f.docW, f.docH) * f.scale * f.dpr
  const step = 2 ** (Math.round(Math.log2(Math.max(64, Math.min(want, 2048))) * 2) / 2)
  const k = step / Math.max(f.docW, f.docH)
  const image = renderReference(ref, Math.round(f.docW * k), Math.round(f.docH * k))
  if (!image) return
  ctx.globalAlpha = ref.opacity
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, f.docW, f.docH)
  ctx.globalAlpha = 1
}

function draw(ctx: CanvasRenderingContext2D, f: FrameInfo) {
  const px = 1 / (f.scale * f.dpr)
  ctx.beginPath()
  ctx.rect(0, 0, f.docW, f.docH)
  ctx.clip()
  if (state.reference.on) drawReference(ctx, f)
  if (state.grid.on || state.perspective.on) {
    ctx.globalAlpha = state.guideOpacity
    ctx.lineWidth = px
    if (state.grid.on) drawGrid(ctx, f)
    if (state.perspective.on) drawPerspective(ctx, f)
    ctx.globalAlpha = 1
  }
  if (state.symmetry.on) drawSymmetry(ctx, f, px)
  frameListeners.forEach((fn) => fn(f))
}

engine.addOverlay(draw)
engine.setSymmetrySource(symmetryTransforms)
