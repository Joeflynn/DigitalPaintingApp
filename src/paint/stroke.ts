import type { BrushPreset } from "./brushes"
import { clamp, lerp, mulberry32, type Rect } from "./util"

/** Receives each dab the stroke places; the GPU renderer implements this. */
export type DabSink = (
  x: number,
  y: number,
  size: number,
  angle: number,
  flow: number,
  pressure: number,
  /** Distance travelled along the stroke, in document pixels */
  distance: number,
  /** A 0–1 random value unique to this dab */
  random: number
) => void

interface Pt {
  x: number
  y: number
  p: number
}

export interface StrokeOptions {
  size: number
  /** 0–1 stabilisation */
  streamline: number
  /** If set, every dab is mirrored across this vertical axis (document x). */
  mirrorX?: number | null
  seed?: number
}

function growRect(dirty: Rect | null, x: number, y: number, r: number): Rect {
  const x0 = Math.floor(x - r)
  const y0 = Math.floor(y - r)
  const x1 = Math.ceil(x + r)
  const y1 = Math.ceil(y + r)
  if (!dirty) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  const nx = Math.min(dirty.x, x0)
  const ny = Math.min(dirty.y, y0)
  return {
    x: nx,
    y: ny,
    w: Math.max(dirty.x + dirty.w, x1) - nx,
    h: Math.max(dirty.y + dirty.h, y1) - ny,
  }
}

/**
 * Turns pointer samples into dabs. Input is smoothed, joined with quadratic
 * curves and walked at the brush spacing; how each dab looks is entirely up
 * to the sink.
 */
export class Stroke {
  dirty: Rect | null = null

  private sink: DabSink
  private brush: BrushPreset
  private size: number
  private streamline: number
  private mirrorX: number | null
  private rand: () => number

  private pts: Pt[] = []
  private smooth: Pt = { x: 0, y: 0, p: 0 }
  private raw: Pt = { x: 0, y: 0, p: 0 }
  private lastMid: Pt | null = null
  private residual = 0
  private ended = false
  private distance = 0
  private lastDir = 0

  constructor(sink: DabSink, brush: BrushPreset, opts: StrokeOptions) {
    this.sink = sink
    this.brush = brush
    this.size = opts.size
    this.streamline = opts.streamline
    this.mirrorX = opts.mirrorX ?? null
    this.rand = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0)
  }

  add(x: number, y: number, p: number) {
    if (this.ended) return
    if (![x, y, p].every(Number.isFinite)) return
    p = Math.pow(clamp(p, 0, 1), this.brush.pressureCurve)
    this.raw = { x, y, p }
    if (this.pts.length === 0) {
      this.smooth = { x, y, p }
      this.pts.push({ x, y, p })
      // Direction-following tips wait for the first movement to know which
      // way to face; everything else marks the paper immediately.
      if (!this.brush.followDirection) this.dab(x, y, p, 0)
      this.residual = this.brush.followDirection ? 0 : this.spacingFor(p)
      return
    }
    this.advance(x, y, p)
  }

  end() {
    if (this.ended) return
    // Let the stabilised point catch up with the pen before lifting.
    if (this.pts.length > 0 && this.streamline > 0) {
      for (let i = 0; i < 24; i++) {
        const d = Math.hypot(
          this.raw.x - this.smooth.x,
          this.raw.y - this.smooth.y
        )
        if (d < 0.5) break
        this.advance(this.raw.x, this.raw.y, this.raw.p)
      }
    }
    const n = this.pts.length
    if (n >= 2 && this.lastMid) this.line(this.lastMid, this.pts[n - 1])
    // A tap with a direction-following tip never moved, so stamp it once.
    if (!this.dirty && this.pts.length > 0) {
      this.dab(this.raw.x, this.raw.y, this.raw.p, this.lastDir)
    }
    this.ended = true
  }

  private advance(x: number, y: number, p: number) {
    const k = 1 - this.streamline * 0.92
    const s = this.smooth
    s.x += (x - s.x) * k
    s.y += (y - s.y) * k
    s.p += (p - s.p) * 0.6
    const last = this.pts[this.pts.length - 1]
    if (Math.hypot(s.x - last.x, s.y - last.y) < 0.35) return
    this.pts.push({ x: s.x, y: s.y, p: s.p })
    const n = this.pts.length
    const a = this.pts[n - 2]
    const b = this.pts[n - 1]
    const mid: Pt = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      p: (a.p + b.p) / 2,
    }
    if (!this.lastMid) this.line(a, mid)
    else this.quad(this.lastMid, a, mid)
    this.lastMid = mid
    // Only the last two input points are needed for the next curve segment.
    if (this.pts.length > 2) this.pts.splice(0, this.pts.length - 2)
  }

  private quad(a: Pt, c: Pt, b: Pt) {
    const len =
      Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y)
    const steps = Math.max(1, Math.ceil(len / 2))
    let prev = a
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const pt: Pt = {
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        p: u * u * a.p + 2 * u * t * c.p + t * t * b.p,
      }
      this.line(prev, pt)
      prev = pt
    }
  }

  private line(a: Pt, b: Pt) {
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d === 0) return
    // Ease the heading so a bristle tip swings round corners instead of
    // snapping between curve segments.
    const target = Math.atan2(b.y - a.y, b.x - a.x)
    if (!this.dirty) this.lastDir = target
    let pos = this.residual
    while (pos <= d) {
      const t = pos / d
      const p = lerp(a.p, b.p, t)
      const step = this.spacingFor(p)
      let turn = target - this.lastDir
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      this.lastDir += turn * Math.min(1, (step / this.size) * 6)
      this.dab(lerp(a.x, b.x, t), lerp(a.y, b.y, t), p, this.lastDir)
      this.distance += step
      pos += step
    }
    this.residual = pos - d
  }

  private sizeFor(p: number): number {
    const b = this.brush
    return Math.max(
      0.6,
      this.size * Math.max(b.minSize, 1 - b.sizePressure + b.sizePressure * p)
    )
  }

  private spacingFor(p: number): number {
    return Math.max(0.5, this.brush.spacing * this.sizeFor(p))
  }

  private dab(x: number, y: number, p: number, dir: number) {
    const b = this.brush
    const rand = this.rand
    let size = this.sizeFor(p)
    if (b.sizeJitter > 0) size *= 1 - b.sizeJitter * rand()
    size = Math.max(0.6, size)
    const flow =
      b.flow *
      (1 - b.flowPressure + b.flowPressure * p) *
      (1 - b.flowJitter * rand())
    if (flow <= 0.002) return
    if (b.scatter > 0) {
      const ang = rand() * Math.PI * 2
      const dist = Math.sqrt(rand()) * b.scatter * size
      x += Math.cos(ang) * dist
      y += Math.sin(ang) * dist
    }
    let angle = (b.angle * Math.PI) / 180
    if (b.followDirection) angle += dir
    if (b.angleJitter > 0) angle += (rand() - 0.5) * b.angleJitter * Math.PI * 2
    const random = rand()

    this.sink(x, y, size, angle, flow, p, this.distance, random)
    this.dirty = growRect(this.dirty, x, y, size / 2 + 2)
    if (this.mirrorX !== null) {
      const mx = 2 * this.mirrorX - x
      this.sink(mx, y, size, Math.PI - angle, flow, p, this.distance, random)
      this.dirty = growRect(this.dirty, mx, y, size / 2 + 2)
    }
  }
}

/** A pressure-swept S-curve used for brush previews and tests. */
export function sampleStroke(
  stroke: Stroke,
  x0: number,
  x1: number,
  y: number,
  amplitude: number,
  steps = 100
) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    stroke.add(
      lerp(x0, x1, t),
      y + Math.sin(t * Math.PI * 2) * amplitude,
      0.12 + Math.sin(t * Math.PI) * 0.88
    )
  }
  stroke.end()
}
