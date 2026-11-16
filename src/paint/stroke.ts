import type { BrushLink, BrushPreset, LinkTarget } from "./brushes"
import { clamp, lerp, mulberry32, type Rect } from "./util"

/** One stamp of the brush. */
export interface Dab {
  x: number
  y: number
  /** Diameter in document pixels */
  size: number
  /** Tip rotation in radians */
  angle: number
  flow: number
  pressure: number
  /** Distance travelled along the stroke, in document pixels */
  distance: number
  /** A 0–1 random value unique to this dab */
  random: number
  /** Hue shift in turns, then saturation and luminance shifts (−1 to 1) */
  hue: number
  sat: number
  lum: number
  /** How much of the secondary colour this stamp carries (0–1) */
  mix2: number
  /** Heading of the stroke in radians */
  dir: number
  roundness: number
  /** Scales the canvas texture's depth */
  texture: number
  /** Scales how much water the dab lays down */
  wet: number
  /** 1 lays fresh paint, 0 only moves what is already on the canvas */
  load: number
}

/** Receives each dab the stroke places; the GPU renderer implements this. */
export type DabSink = (dab: Dab) => void

interface Pt {
  x: number
  y: number
  p: number
  /** Speed, 0–1 */
  v: number
  /** Pen tilt away from upright, 0–1 */
  t: number
}

const mix = (a: Pt, b: Pt, t: number): Pt => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  p: lerp(a.p, b.p, t),
  v: lerp(a.v, b.v, t),
  t: lerp(a.t, b.t, t),
})

const SCALED: LinkTarget[] = ["size", "flow", "load", "wet", "texture", "roundness"]

type Mods = Record<LinkTarget, number>

/** Extra readings that may accompany a pointer sample. */
export interface SampleExtra {
  /** Pen tilt away from upright, 0–1 */
  tilt?: number
  /** Timestamp in milliseconds, used to measure speed */
  time?: number
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
  private smooth: Pt = { x: 0, y: 0, p: 0, v: 0, t: 0 }
  private raw: Pt = { x: 0, y: 0, p: 0, v: 0, t: 0 }
  private lastMid: Pt | null = null
  private residual = 0
  private ended = false
  private distance = 0
  private lastDir = 0
  private lastTime: number | null = null
  private speed = 0.35
  private links: BrushLink[]
  /** Colour shift chosen once for the whole stroke: hue, sat, lum. */
  private tint: [number, number, number]

  constructor(sink: DabSink, brush: BrushPreset, opts: StrokeOptions) {
    this.sink = sink
    this.brush = brush
    this.size = opts.size
    this.streamline = opts.streamline
    this.mirrorX = opts.mirrorX ?? null
    this.rand = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0)
    this.links = (brush.links ?? []).filter((l) => l.amount !== 0)
    const r = this.rand
    this.tint = [
      brush.strokeHueJitter > 0 ? (r() - 0.5) * brush.strokeHueJitter : 0,
      brush.strokeSatJitter > 0 ? (r() * 2 - 1) * brush.strokeSatJitter : 0,
      brush.strokeLumJitter > 0 ? (r() * 2 - 1) * brush.strokeLumJitter * 0.6 : 0,
    ]
  }

  add(x: number, y: number, p: number, extra: SampleExtra = {}) {
    if (this.ended) return
    if (![x, y, p].every(Number.isFinite)) return
    p = Math.pow(clamp(p, 0, 1), this.brush.pressureCurve)
    const t = clamp(extra.tilt ?? 0, 0, 1)
    // Speed in document pixels per millisecond, eased so it does not flicker.
    if (extra.time !== undefined && Number.isFinite(extra.time)) {
      if (this.lastTime !== null && extra.time > this.lastTime) {
        const d = Math.hypot(x - this.raw.x, y - this.raw.y)
        const v = 1 - Math.exp(-d / (extra.time - this.lastTime) / 1.2)
        this.speed += (v - this.speed) * 0.35
      }
      this.lastTime = extra.time
    }
    const v = this.speed
    this.raw = { x, y, p, v, t }
    if (this.pts.length === 0) {
      this.smooth = { ...this.raw }
      this.pts.push({ ...this.raw })
      // Direction-following tips wait for the first movement to know which
      // way to face; everything else marks the paper immediately.
      if (!this.brush.followDirection) this.dab(this.raw, 0)
      this.residual = this.brush.followDirection
        ? 0
        : this.spacingFor(this.sizeFor(p, this.mods(this.raw, 0.5)))
      return
    }
    this.advance(this.raw)
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
        this.advance(this.raw)
      }
    }
    const n = this.pts.length
    if (n >= 2 && this.lastMid) this.line(this.lastMid, this.pts[n - 1])
    // A tap with a direction-following tip never moved, so stamp it once.
    if (!this.dirty && this.pts.length > 0) {
      this.dab(this.raw, this.lastDir)
    }
    this.ended = true
  }

  private advance(to: Pt) {
    const k = 1 - this.streamline * 0.92
    const s = this.smooth
    s.x += (to.x - s.x) * k
    s.y += (to.y - s.y) * k
    s.p += (to.p - s.p) * 0.6
    s.v += (to.v - s.v) * 0.6
    s.t += (to.t - s.t) * 0.6
    const last = this.pts[this.pts.length - 1]
    if (Math.hypot(s.x - last.x, s.y - last.y) < 0.35) return
    this.pts.push({ ...s })
    const n = this.pts.length
    const a = this.pts[n - 2]
    const b = this.pts[n - 1]
    const mid = mix(a, b, 0.5)
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
      const q = (k: keyof Pt) => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k]
      const pt: Pt = { x: q("x"), y: q("y"), p: q("p"), v: q("v"), t: q("t") }
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
      const pt = mix(a, b, pos / d)
      const rnd = this.rand()
      const mods = this.mods(pt, rnd)
      const step = this.spacingFor(this.sizeFor(pt.p, mods))
      let turn = target - this.lastDir
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      this.lastDir += turn * Math.min(1, (step / this.size) * 6)
      this.dab(pt, this.lastDir, mods)
      this.distance += step
      pos += step
    }
    this.residual = pos - d
  }

  /** Evaluates the brush's links: scale factors, and offsets for the rest. */
  private mods(pt: Pt, random: number): Mods {
    const m: Mods = {
      size: 1,
      flow: 1,
      load: 1,
      wet: 1,
      texture: 1,
      roundness: 1,
      scatter: 0,
      angle: 0,
      hue: 0,
      sat: 0,
      lum: 0,
      mix2: 0,
    }
    if (this.links.length === 0) return m
    const fade = clamp(
      this.distance / Math.max(1, this.brush.fadeLength * this.size),
      0,
      1
    )
    const inputs = { pressure: pt.p, speed: pt.v, tilt: pt.t, fade, random }
    for (const l of this.links) {
      const v = Math.pow(clamp(inputs[l.input] ?? 0, 0, 1), l.curve || 1)
      if (SCALED.includes(l.target)) {
        m[l.target] *= l.amount >= 0 ? 1 - l.amount * (1 - v) : 1 + l.amount * v
      } else {
        m[l.target] += l.amount * v
      }
    }
    return m
  }

  private sizeFor(p: number, mods: Mods): number {
    const b = this.brush
    return Math.max(
      0.6,
      this.size *
        Math.max(b.minSize, 1 - b.sizePressure + b.sizePressure * p) *
        Math.max(0.02, mods.size)
    )
  }

  private spacingFor(size: number): number {
    return Math.max(0.5, this.brush.spacing * size)
  }

  private dab(pt: Pt, dir: number, mods = this.mods(pt, this.rand())) {
    const b = this.brush
    const rand = this.rand
    const p = pt.p
    let { x, y } = pt
    let size = this.sizeFor(p, mods)
    if (b.sizeJitter > 0) size *= 1 - b.sizeJitter * rand()
    size = Math.max(0.6, size)
    const flow =
      b.flow *
      (1 - b.flowPressure + b.flowPressure * p) *
      (1 - b.flowJitter * rand()) *
      Math.max(0, mods.flow)
    if (flow <= 0.002) return
    const scatter = Math.max(0, b.scatter + mods.scatter)
    if (scatter > 0) {
      const ang = rand() * Math.PI * 2
      const dist = Math.sqrt(rand()) * scatter * size
      x += Math.cos(ang) * dist
      y += Math.sin(ang) * dist
    }
    let angle = (b.angle * Math.PI) / 180 + mods.angle * Math.PI
    if (b.followDirection) angle += dir
    if (b.angleJitter > 0) angle += (rand() - 0.5) * b.angleJitter * Math.PI * 2
    const random = rand()

    let hue = this.tint[0] + mods.hue
    let sat = this.tint[1] + mods.sat
    let lum = this.tint[2] + mods.lum
    if (b.hueCycle !== 0) hue += (b.hueCycle * this.distance) / (this.size * 8)
    if (b.hueJitter > 0) hue += (rand() - 0.5) * b.hueJitter
    if (b.satJitter > 0) sat += (rand() * 2 - 1) * b.satJitter
    if (b.lumJitter > 0) lum += (rand() * 2 - 1) * b.lumJitter * 0.6
    let mix2 = mods.mix2
    if (b.secondaryMix > 0) mix2 += rand() * b.secondaryMix

    const dab: Dab = {
      x,
      y,
      size,
      angle,
      flow,
      pressure: p,
      distance: this.distance,
      random,
      hue: hue - Math.floor(hue),
      sat: clamp(sat, -1, 1),
      lum: clamp(lum, -1, 1),
      mix2: clamp(mix2, 0, 1),
      dir,
      roundness: clamp(b.roundness * mods.roundness, 0.05, 1),
      texture: clamp(mods.texture, 0, 2),
      wet: clamp(mods.wet, 0, 2),
      load: clamp(mods.load, 0, 1),
    }
    this.sink(dab)
    this.dirty = growRect(this.dirty, x, y, size / 2 + 2)
    if (this.mirrorX !== null) {
      const mx = 2 * this.mirrorX - x
      this.sink({ ...dab, x: mx, angle: Math.PI - angle, dir: Math.PI - dir })
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
