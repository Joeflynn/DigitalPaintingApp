import { getTip, makeStamp, type BrushPreset } from "./brushes"
import { ctxOf, lerp, makeCanvas, mulberry32, type Rect } from "./util"

interface Pt {
  x: number
  y: number
  p: number
}

export interface StrokeOptions {
  color: string
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
 * Stamp-based brush stroke. Input points are smoothed, joined with quadratic
 * curves and walked at a fixed spacing, placing one tinted tip per step.
 */
export class Stroke {
  dirty: Rect | null = null

  private ctx: CanvasRenderingContext2D
  private brush: BrushPreset
  private size: number
  private streamline: number
  private mirrorX: number | null
  private stamp: HTMLCanvasElement
  private rand: () => number

  private pts: Pt[] = []
  private smooth: Pt = { x: 0, y: 0, p: 0 }
  private raw: Pt = { x: 0, y: 0, p: 0 }
  private lastMid: Pt | null = null
  private residual = 0
  private ended = false

  constructor(ctx: CanvasRenderingContext2D, brush: BrushPreset, opts: StrokeOptions) {
    this.ctx = ctx
    this.brush = brush
    this.size = opts.size
    this.streamline = opts.streamline
    this.mirrorX = opts.mirrorX ?? null
    this.rand = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0)
    this.stamp = makeStamp(getTip(brush, opts.size), opts.color)
  }

  add(x: number, y: number, p: number) {
    if (this.ended) return
    this.raw = { x, y, p }
    if (this.pts.length === 0) {
      this.smooth = { x, y, p }
      this.pts.push({ x, y, p })
      this.dab(x, y, p, 0)
      this.residual = this.spacingFor(p)
      return
    }
    this.advance(x, y, p)
  }

  end() {
    if (this.ended) return
    // Let the stabilised point catch up with the pen before lifting.
    if (this.pts.length > 0 && this.streamline > 0) {
      for (let i = 0; i < 24; i++) {
        const d = Math.hypot(this.raw.x - this.smooth.x, this.raw.y - this.smooth.y)
        if (d < 0.5) break
        this.advance(this.raw.x, this.raw.y, this.raw.p)
      }
    }
    const n = this.pts.length
    if (n >= 2 && this.lastMid) this.line(this.lastMid, this.pts[n - 1])
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
    const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 }
    if (!this.lastMid) this.line(a, mid)
    else this.quad(this.lastMid, a, mid)
    this.lastMid = mid
  }

  private quad(a: Pt, c: Pt, b: Pt) {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y)
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
    const dir = Math.atan2(b.y - a.y, b.x - a.x)
    let pos = this.residual
    while (pos <= d) {
      const t = pos / d
      const p = lerp(a.p, b.p, t)
      this.dab(lerp(a.x, b.x, t), lerp(a.y, b.y, t), p, dir)
      pos += this.spacingFor(p)
    }
    this.residual = pos - d
  }

  private sizeFor(p: number): number {
    const b = this.brush
    return Math.max(0.6, this.size * (1 - b.sizePressure + b.sizePressure * p))
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
    const alpha = b.flow * (1 - b.flowPressure + b.flowPressure * p)
    if (alpha <= 0.002) return
    if (b.scatter > 0) {
      const ang = rand() * Math.PI * 2
      const dist = rand() * b.scatter * this.size
      x += Math.cos(ang) * dist
      y += Math.sin(ang) * dist
    }
    let angle = (b.angle * Math.PI) / 180
    if (b.followDirection) angle += dir
    if (b.angleJitter > 0) angle += (rand() - 0.5) * b.angleJitter * Math.PI * 2

    this.place(x, y, size, angle, alpha)
    this.dirty = growRect(this.dirty, x, y, size / 2 + 2)
    if (this.mirrorX !== null) {
      const mx = 2 * this.mirrorX - x
      this.place(mx, y, size, Math.PI - angle, alpha)
      this.dirty = growRect(this.dirty, mx, y, size / 2 + 2)
    }
  }

  private place(x: number, y: number, size: number, angle: number, alpha: number) {
    const ctx = this.ctx
    const b = this.brush
    ctx.globalAlpha = alpha
    if (angle === 0 && b.roundness === 1) {
      ctx.drawImage(this.stamp, x - size / 2, y - size / 2, size, size)
    } else {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const ry = b.roundness
      ctx.setTransform(cos, sin, -sin * ry, cos * ry, x, y)
      ctx.drawImage(this.stamp, -size / 2, -size / 2, size, size)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    ctx.globalAlpha = 1
  }
}

/**
 * Smudge works directly on the layer: it carries a small sample of paint and
 * linearly blends it into the pixels under the tip as the pen moves.
 */
export class SmudgeStroke {
  dirty: Rect | null = null

  private layer: HTMLCanvasElement
  private lctx: CanvasRenderingContext2D
  private d: number
  private strength: number
  private mask: HTMLCanvasElement
  private sample: HTMLCanvasElement
  private sctx: CanvasRenderingContext2D
  private tmp: HTMLCanvasElement
  private tctx: CanvasRenderingContext2D
  private lx = 0
  private ly = 0
  private residual = 0

  constructor(layer: HTMLCanvasElement, brush: BrushPreset, size: number, strength: number) {
    this.layer = layer
    this.lctx = ctxOf(layer)
    this.d = Math.max(4, Math.ceil(size))
    this.strength = strength
    this.mask = getTip(brush, this.d)
    this.sample = makeCanvas(this.d, this.d)
    this.sctx = ctxOf(this.sample)
    this.tmp = makeCanvas(this.d, this.d)
    this.tctx = ctxOf(this.tmp)
  }

  start(x: number, y: number) {
    const d = this.d
    this.lx = x
    this.ly = y
    this.sctx.drawImage(
      this.layer,
      Math.round(x - d / 2),
      Math.round(y - d / 2),
      d,
      d,
      0,
      0,
      d,
      d
    )
  }

  move(x: number, y: number) {
    const dist = Math.hypot(x - this.lx, y - this.ly)
    if (dist === 0) return
    const step = Math.max(1, this.d * 0.07)
    let pos = this.residual
    while (pos <= dist) {
      const t = pos / dist
      this.dab(lerp(this.lx, x, t), lerp(this.ly, y, t))
      pos += step
    }
    this.residual = pos - dist
    this.lx = x
    this.ly = y
  }

  private dab(x: number, y: number) {
    const d = this.d
    const ox = Math.round(x - d / 2)
    const oy = Math.round(y - d / 2)
    const a = this.strength
    const t = this.tctx
    const l = this.lctx
    const s = this.sctx

    // tmp = carried paint, shaped by the tip
    t.globalCompositeOperation = "copy"
    t.drawImage(this.sample, 0, 0)
    t.globalCompositeOperation = "destination-in"
    t.drawImage(this.mask, 0, 0, d, d)

    // layer = layer * (1 - a·mask) + carried * a·mask
    l.globalAlpha = a
    l.globalCompositeOperation = "destination-out"
    l.drawImage(this.mask, ox, oy, d, d)
    l.globalCompositeOperation = "lighter"
    l.drawImage(this.tmp, ox, oy)
    l.globalCompositeOperation = "source-over"
    l.globalAlpha = 1

    // carried = carried * k + what is now under the tip * (1 - k)
    const k = 0.45 + a * 0.5
    s.globalCompositeOperation = "destination-out"
    s.globalAlpha = 1 - k
    s.fillRect(0, 0, d, d)
    s.globalCompositeOperation = "lighter"
    s.drawImage(this.layer, ox, oy, d, d, 0, 0, d, d)
    s.globalCompositeOperation = "source-over"
    s.globalAlpha = 1

    this.dirty = growRect(this.dirty, x, y, d / 2 + 2)
  }
}

const previewCache = new Map<string, string>()

/** Renders a pressure-swept sample stroke for the brush library. */
export function brushPreview(brush: BrushPreset, w = 220, h = 44): string {
  const hit = previewCache.get(brush.id)
  if (hit) return hit
  const scale = 2
  const c = makeCanvas(w * scale, h * scale)
  const ctx = ctxOf(c)
  const size = Math.min(Math.max(brush.size * 0.5, 5), 20) * scale
  const stroke = new Stroke(ctx, brush, {
    color: "#ecebe4",
    size,
    streamline: 0,
    seed: 1234,
  })
  const pad = 16 * scale
  const n = 60
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = pad + t * (c.width - pad * 2)
    const y = c.height / 2 + Math.sin(t * Math.PI * 2) * c.height * 0.2
    const p = Math.pow(Math.sin(t * Math.PI), 0.7)
    stroke.add(x, y, Math.max(0.03, p))
  }
  stroke.end()
  const url = c.toDataURL()
  previewCache.set(brush.id, url)
  return url
}
