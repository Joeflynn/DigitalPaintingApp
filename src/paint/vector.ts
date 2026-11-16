import { clamp, ctxOf, makeCanvas, uid } from "./util"

/**
 * Vector layers hold a list of objects — parametric shapes and live text —
 * that stay editable. The layer's canvas is only a rasterised copy of them,
 * redrawn whenever they change.
 */

export type ShapeKind = "rect" | "ellipse" | "polygon" | "star" | "line" | "arrow"
export type DashStyle = "solid" | "dash" | "dot"
export type TextAlign = "left" | "center" | "right"

interface VecBase {
  id: string
  /** The object's box before rotation. Lines run corner to corner, so their
   *  width and height may be negative. */
  x: number
  y: number
  w: number
  h: number
  /** Rotation about the centre of the box, in radians. */
  rot: number
  opacity: number
  fill: string | null
  stroke: string | null
  strokeWidth: number
  dash: DashStyle
}

export interface ShapeObject extends VecBase {
  type: "shape"
  shape: ShapeKind
  /** Corner rounding, in px (rectangles, polygons and stars). */
  radius: number
  /** Polygon sides, or star points. */
  sides: number
  /** Star: inner radius as a fraction of the outer. */
  inner: number
  /** Ellipse: how much of the circle is drawn, in degrees. */
  sweep: number
  /** Ellipse: where the arc starts, in degrees clockwise from the top. */
  start: number
  /** Ellipse: hole radius as a fraction of the outer (0 = solid). */
  ring: number
  /** Arrow: head length as a multiple of the stroke width. */
  head: number
}

export interface TextObject extends VecBase {
  type: "text"
  text: string
  font: string
  size: number
  weight: number
  italic: boolean
  underline: boolean
  align: TextAlign
  /** Line height as a multiple of the font size. */
  lineHeight: number
  /** Letter spacing, in em. */
  spacing: number
  /** The width is fixed and text wraps to it; otherwise it follows the text. */
  wrap: boolean
}

export type VectorObject = ShapeObject | TextObject

type Geometry = "id" | "type" | "x" | "y" | "w" | "h" | "rot"
export type ShapeStyle = Omit<ShapeObject, Geometry>
export type TextStyle = Omit<TextObject, Geometry | "text" | "wrap">
/** Any subset of object properties; keys an object doesn't have are ignored. */
export type VecPatch = Partial<Omit<ShapeObject, "id" | "type">> &
  Partial<Omit<TextObject, "id" | "type">>

export const SHAPE_KINDS: { id: ShapeKind; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "polygon", label: "Polygon" },
  { id: "star", label: "Star" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
]

export const FONTS: { id: string; label: string; css: string }[] = [
  { id: "figtree", label: "Figtree", css: "'Figtree Variable', sans-serif" },
  { id: "system", label: "System", css: "system-ui, sans-serif" },
  { id: "helvetica", label: "Helvetica", css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "avenir", label: "Avenir Next", css: "'Avenir Next', Avenir, 'Segoe UI', sans-serif" },
  { id: "futura", label: "Futura", css: "Futura, 'Century Gothic', sans-serif" },
  { id: "gill", label: "Gill Sans", css: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif" },
  { id: "impact", label: "Impact", css: "Impact, 'Arial Black', sans-serif" },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { id: "palatino", label: "Palatino", css: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif" },
  { id: "didot", label: "Didot", css: "Didot, 'Bodoni MT', 'Times New Roman', serif" },
  { id: "typewriter", label: "American Typewriter", css: "'American Typewriter', Rockwell, 'Courier New', serif" },
  { id: "menlo", label: "Menlo", css: "Menlo, Consolas, monospace" },
  { id: "courier", label: "Courier New", css: "'Courier New', Courier, monospace" },
  { id: "marker", label: "Marker Felt", css: "'Marker Felt', 'Comic Sans MS', cursive" },
  { id: "script", label: "Snell Roundhand", css: "'Snell Roundhand', 'Brush Script MT', cursive" },
  { id: "chalk", label: "Chalkduster", css: "Chalkduster, 'Comic Sans MS', fantasy" },
]

export const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
]

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  shape: "rect",
  opacity: 1,
  fill: "#e5533d",
  stroke: null,
  strokeWidth: 8,
  dash: "solid",
  radius: 0,
  sides: 5,
  inner: 0.45,
  sweep: 360,
  start: 0,
  ring: 0,
  head: 4,
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  opacity: 1,
  fill: "#16130f",
  stroke: null,
  strokeWidth: 4,
  dash: "solid",
  font: "figtree",
  size: 96,
  weight: 600,
  italic: false,
  underline: false,
  align: "left",
  lineHeight: 1.2,
  spacing: 0,
}

export const isLine = (o: VectorObject): boolean =>
  o.type === "shape" && (o.shape === "line" || o.shape === "arrow")

export function makeShape(style: ShapeStyle, x: number, y: number): ShapeObject {
  return normalizeShape({
    ...style,
    id: uid("obj"),
    type: "shape",
    x,
    y,
    w: 0,
    h: 0,
    rot: 0,
  })
}

export function makeText(style: TextStyle, x: number, y: number): TextObject {
  return fitText({
    ...style,
    id: uid("obj"),
    type: "text",
    text: "",
    wrap: false,
    x,
    y,
    w: 0,
    h: 0,
    rot: 0,
  })
}

/**
 * Keeps a shape consistent with its kind: lines are stroke-only and never
 * rotated; everything else has a positive width and height.
 */
export function normalizeShape(o: ShapeObject): ShapeObject {
  if (isLine(o)) {
    return {
      ...o,
      rot: 0,
      fill: null,
      stroke: o.stroke ?? o.fill ?? "#16130f",
      strokeWidth: Math.max(1, o.strokeWidth),
    }
  }
  if (o.w >= 0 && o.h >= 0) return o
  return {
    ...o,
    x: Math.min(o.x, o.x + o.w),
    y: Math.min(o.y, o.y + o.h),
    w: Math.abs(o.w),
    h: Math.abs(o.h),
  }
}

// ---- geometry ----------------------------------------------------------------

export function rotate(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [x * c - y * s, x * s + y * c]
}

/** A point in document space, in the object's own centred, unrotated frame. */
export function toLocal(o: VectorObject, x: number, y: number): [number, number] {
  return rotate(x - (o.x + o.w / 2), y - (o.y + o.h / 2), -o.rot)
}

/**
 * Gives the object a new size while keeping one point of its box where it is
 * on the page. (ax, ay) picks that point: 0 is the left/top edge, 1 the
 * right/bottom.
 */
export function resized<T extends VectorObject>(
  o: T,
  w: number,
  h: number,
  ax: number,
  ay: number
): T {
  const [px, py] = rotate((ax - 0.5) * o.w, (ay - 0.5) * o.h, o.rot)
  const [qx, qy] = rotate((ax - 0.5) * w, (ay - 0.5) * h, o.rot)
  const cx = o.x + o.w / 2 + px - qx
  const cy = o.y + o.h / 2 + py - qy
  return { ...o, x: cx - w / 2, y: cy - h / 2, w, h }
}

// ---- text layout -------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null
function mctx(): CanvasRenderingContext2D {
  measureCtx ??= ctxOf(makeCanvas(1, 1))
  return measureCtx
}

export function fontFamily(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).css
}

export function fontCss(t: TextObject): string {
  return `${t.italic ? "italic " : ""}${t.weight} ${t.size}px ${fontFamily(t.font)}`
}

function setFont(ctx: CanvasRenderingContext2D, t: TextObject) {
  ctx.font = fontCss(t)
  ctx.letterSpacing = `${t.spacing * t.size}px`
}

interface TextLayout {
  lines: string[]
  w: number
  h: number
  lineH: number
  ascent: number
  descent: number
}

function wrapParagraph(
  ctx: CanvasRenderingContext2D,
  para: string,
  width: number,
  out: string[]
) {
  const tokens = para.split(/(\s+)/)
  let line = ""
  const flush = () => {
    out.push(line.replace(/\s+$/, ""))
    line = ""
  }
  for (const tok of tokens) {
    if (!tok) continue
    if (ctx.measureText((line + tok).replace(/\s+$/, "")).width <= width) {
      line += tok
      continue
    }
    if (line.trim()) flush()
    if (/^\s+$/.test(tok)) continue
    // A single word wider than the box breaks wherever it has to.
    let word = tok
    while (word.length > 1 && ctx.measureText(word).width > width) {
      let n = word.length - 1
      while (n > 1 && ctx.measureText(word.slice(0, n)).width > width) n--
      out.push(word.slice(0, n))
      word = word.slice(n)
    }
    line = word
  }
  out.push(line.replace(/\s+$/, ""))
}

export function layoutText(t: TextObject): TextLayout {
  const ctx = mctx()
  setFont(ctx, t)
  const lines: string[] = []
  for (const para of t.text.split("\n")) {
    if (t.wrap) wrapParagraph(ctx, para, Math.max(1, t.w), lines)
    else lines.push(para)
  }
  const m = ctx.measureText("Mg")
  const lineH = t.size * t.lineHeight
  let w = t.w
  if (!t.wrap) {
    w = t.size * 0.25
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width)
  }
  return {
    lines,
    w,
    h: Math.max(1, lines.length) * lineH,
    lineH,
    ascent: m.fontBoundingBoxAscent,
    descent: m.fontBoundingBoxDescent,
  }
}

/** Sizes a text object's box to its contents, holding its aligned edge still. */
export function fitText(t: TextObject): TextObject {
  const L = layoutText(t)
  const ax = t.align === "center" ? 0.5 : t.align === "right" ? 1 : 0
  return resized(t, Math.ceil(L.w), L.h, t.wrap ? 0 : ax, 0)
}

// ---- drawing -----------------------------------------------------------------

function dashOf(o: VectorObject, lw: number): number[] {
  return o.dash === "dash" ? [lw * 3, lw * 2.2] : o.dash === "dot" ? [0.01, lw * 2] : []
}

function polyPoints(o: ShapeObject): [number, number][] {
  const star = o.shape === "star"
  const n = clamp(Math.round(o.sides), 3, 60)
  const count = star ? n * 2 : n
  const pts: [number, number][] = []
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count
    const r = star && i % 2 === 1 ? clamp(o.inner, 0.05, 1) : 1
    const p: [number, number] = [Math.cos(a) * r, Math.sin(a) * r]
    pts.push(p)
    x0 = Math.min(x0, p[0])
    x1 = Math.max(x1, p[0])
    y0 = Math.min(y0, p[1])
    y1 = Math.max(y1, p[1])
  }
  // Stretch the figure so it touches all four sides of its box.
  return pts.map(([x, y]) => [
    ((x - x0) / (x1 - x0) - 0.5) * o.w,
    ((y - y0) / (y1 - y0) - 0.5) * o.h,
  ])
}

/** Traces a closed shape's outline in its own centred frame. */
function shapePath(ctx: CanvasRenderingContext2D, o: ShapeObject) {
  const w = Math.abs(o.w)
  const h = Math.abs(o.h)
  ctx.beginPath()
  if (o.shape === "rect") {
    ctx.roundRect(-w / 2, -h / 2, w, h, clamp(o.radius, 0, Math.min(w, h) / 2))
  } else if (o.shape === "ellipse") {
    const rx = w / 2
    const ry = h / 2
    const ring = clamp(o.ring, 0, 0.98)
    if (o.sweep >= 359.9) {
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
      if (ring > 0) {
        ctx.moveTo(rx * ring, 0)
        ctx.ellipse(0, 0, rx * ring, ry * ring, 0, 0, Math.PI * 2, true)
      }
    } else {
      const a0 = ((o.start - 90) * Math.PI) / 180
      const a1 = a0 + (Math.max(1, o.sweep) * Math.PI) / 180
      ctx.ellipse(0, 0, rx, ry, 0, a0, a1)
      if (ring > 0) ctx.ellipse(0, 0, rx * ring, ry * ring, 0, a1, a0, true)
      else ctx.lineTo(0, 0)
      ctx.closePath()
    }
  } else {
    const pts = polyPoints(o)
    const n = pts.length
    let r = Math.max(0, o.radius)
    if (r > 0) {
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[(i + 1) % n]
        r = Math.min(r, Math.hypot(bx - ax, by - ay) / 2)
      }
    }
    if (r > 0.01) {
      const [lx, ly] = pts[n - 1]
      ctx.moveTo((lx + pts[0][0]) / 2, (ly + pts[0][1]) / 2)
      for (let i = 0; i < n; i++) {
        const [bx, by] = pts[(i + 1) % n]
        ctx.arcTo(pts[i][0], pts[i][1], (pts[i][0] + bx) / 2, (pts[i][1] + by) / 2, r)
      }
    } else {
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1])
    }
    ctx.closePath()
  }
}

function drawLine(ctx: CanvasRenderingContext2D, o: ShapeObject) {
  const paint = o.stroke ?? o.fill
  if (!paint) return
  const lw = Math.max(1, o.strokeWidth)
  const x0 = -o.w / 2
  const y0 = -o.h / 2
  let x1 = o.w / 2
  let y1 = o.h / 2
  const len = Math.hypot(o.w, o.h)
  ctx.strokeStyle = paint
  ctx.fillStyle = paint
  ctx.lineWidth = lw
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  if (o.shape === "arrow" && len > 0.5) {
    const ux = o.w / len
    const uy = o.h / len
    const hl = Math.min(len, lw * Math.max(1, o.head))
    const hw = hl * 0.42
    const bx = x1 - ux * hl
    const by = y1 - uy * hl
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(bx - uy * hw, by + ux * hw)
    ctx.lineTo(bx + uy * hw, by - ux * hw)
    ctx.closePath()
    ctx.fill()
    x1 = bx
    y1 = by
    if (len <= hl) return
  }
  ctx.setLineDash(dashOf(o, lw))
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObject) {
  if (isLine(o)) {
    drawLine(ctx, o)
    return
  }
  shapePath(ctx, o)
  if (o.fill) {
    ctx.fillStyle = o.fill
    ctx.fill()
  }
  if (o.stroke && o.strokeWidth > 0) {
    ctx.strokeStyle = o.stroke
    ctx.lineWidth = o.strokeWidth
    ctx.lineJoin = "round"
    ctx.lineCap = o.dash === "dot" ? "round" : "butt"
    ctx.setLineDash(dashOf(o, o.strokeWidth))
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawText(ctx: CanvasRenderingContext2D, t: TextObject) {
  const L = layoutText(t)
  setFont(ctx, t)
  ctx.textBaseline = "alphabetic"
  ctx.textAlign = t.align
  const x = t.align === "center" ? 0 : t.align === "right" ? t.w / 2 : -t.w / 2
  const top = -t.h / 2 + (L.lineH - (L.ascent + L.descent)) / 2 + L.ascent
  const outline = t.stroke && t.strokeWidth > 0
  if (outline) {
    ctx.strokeStyle = t.stroke!
    ctx.lineWidth = t.strokeWidth
    ctx.lineJoin = "round"
    L.lines.forEach((line, i) => ctx.strokeText(line, x, top + i * L.lineH))
  }
  if (t.fill) {
    ctx.fillStyle = t.fill
    L.lines.forEach((line, i) => ctx.fillText(line, x, top + i * L.lineH))
  }
  const ink = t.fill ?? (outline ? t.stroke : null)
  if (t.underline && ink) {
    ctx.fillStyle = ink
    const thick = Math.max(1, t.size * 0.06)
    L.lines.forEach((line, i) => {
      const lw = ctx.measureText(line).width
      if (lw <= 0) return
      const lx = t.align === "center" ? x - lw / 2 : t.align === "right" ? x - lw : x
      ctx.fillRect(lx, top + i * L.lineH + t.size * 0.1, lw, thick)
    })
  }
  ctx.letterSpacing = "0px"
}

export function drawObject(ctx: CanvasRenderingContext2D, o: VectorObject) {
  ctx.save()
  ctx.globalAlpha = o.opacity
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2)
  ctx.rotate(o.rot)
  if (o.type === "text") drawText(ctx, o)
  else drawShape(ctx, o)
  ctx.restore()
}

/** Redraws a vector layer's canvas from its objects. */
export function rasterize(
  canvas: HTMLCanvasElement,
  objects: VectorObject[],
  hideId: string | null = null
) {
  const ctx = ctxOf(canvas)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const o of objects) if (o.id !== hideId) drawObject(ctx, o)
}

/** CSS font strings used by a set of objects, for preloading web fonts. */
export function fontsUsed(objects: VectorObject[]): string[] {
  return objects.flatMap((o) => (o.type === "text" ? [fontCss(o)] : []))
}

// ---- hit testing & handles ---------------------------------------------------

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** True if the document point (x, y) lands on the object. */
export function hitObject(o: VectorObject, x: number, y: number, tol: number): boolean {
  const [lx, ly] = toLocal(o, x, y)
  if (o.type === "text") {
    return Math.abs(lx) <= o.w / 2 + tol && Math.abs(ly) <= o.h / 2 + tol
  }
  if (isLine(o)) {
    return (
      segDist(lx, ly, -o.w / 2, -o.h / 2, o.w / 2, o.h / 2) <=
      Math.max(1, o.strokeWidth) / 2 + tol
    )
  }
  const ctx = mctx()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  shapePath(ctx, o)
  if (o.fill && ctx.isPointInPath(lx, ly)) return true
  ctx.lineWidth = (o.stroke ? o.strokeWidth : 0) + tol * 2
  return ctx.isPointInStroke(lx, ly)
}

export interface Handle {
  id: string
  /** Which edges it drags: -1 left/top, 1 right/bottom, 0 neither. */
  hx: number
  hy: number
  /** Position in the object's centred frame. */
  x: number
  y: number
  kind: "resize" | "rotate"
}

/** The handles shown on a selected object; `scale` is the view zoom. */
export function handlesOf(o: VectorObject, scale: number): Handle[] {
  const at = (hx: number, hy: number, id: string): Handle => ({
    id,
    hx,
    hy,
    x: (hx * o.w) / 2,
    y: (hy * o.h) / 2,
    kind: "resize",
  })
  if (isLine(o)) return [at(-1, -1, "start"), at(1, 1, "end")]
  const list =
    o.type === "text"
      ? [at(-1, -1, "nw"), at(1, -1, "ne"), at(1, 1, "se"), at(-1, 1, "sw"), at(-1, 0, "w"), at(1, 0, "e")]
      : [
          at(-1, -1, "nw"),
          at(0, -1, "n"),
          at(1, -1, "ne"),
          at(1, 0, "e"),
          at(1, 1, "se"),
          at(0, 1, "s"),
          at(-1, 1, "sw"),
          at(-1, 0, "w"),
        ]
  list.push({ id: "rot", hx: 0, hy: 0, x: 0, y: -o.h / 2 - 26 / scale, kind: "rotate" })
  return list
}

export function hitHandle(o: VectorObject, x: number, y: number, scale: number): Handle | null {
  const [lx, ly] = toLocal(o, x, y)
  const tol = 9 / scale
  let best: Handle | null = null
  let bestD = tol
  for (const h of handlesOf(o, scale)) {
    const d = Math.hypot(lx - h.x, ly - h.y)
    if (d <= bestD) {
      best = h
      bestD = d
    }
  }
  return best
}

/** The object as it is while a resize handle is dragged to (x, y). */
export function dragHandle(
  o: VectorObject,
  h: Handle,
  x: number,
  y: number,
  constrain: boolean
): VectorObject {
  if (o.type === "shape" && isLine(o)) {
    // Move one end; the other stays where it is.
    let ax = o.x
    let ay = o.y
    let bx = o.x + o.w
    let by = o.y + o.h
    const snap = (fx: number, fy: number): [number, number] => {
      if (!constrain) return [x, y]
      const len = Math.hypot(x - fx, y - fy)
      const a = Math.round(Math.atan2(y - fy, x - fx) / (Math.PI / 4)) * (Math.PI / 4)
      return [fx + Math.cos(a) * len, fy + Math.sin(a) * len]
    }
    if (h.id === "start") [ax, ay] = snap(bx, by)
    else [bx, by] = snap(ax, ay)
    return { ...o, x: ax, y: ay, w: bx - ax, h: by - ay }
  }
  const [lx, ly] = toLocal(o, x, y)
  const ax = h.hx > 0 ? 0 : h.hx < 0 ? 1 : 0.5
  const ay = h.hy > 0 ? 0 : h.hy < 0 ? 1 : 0.5
  let w = h.hx ? Math.max(1, h.hx * lx + o.w / 2) : o.w
  let ht = h.hy ? Math.max(1, h.hy * ly + o.h / 2) : o.h
  if (o.type === "text") {
    if (h.hx && h.hy) {
      // Corners scale the type itself.
      const s = clamp(Math.max(w / Math.max(1, o.w), ht / Math.max(1, o.h)), 0.02, 50)
      const size = clamp(o.size * s, 4, 2000)
      const k = size / o.size
      const L = layoutText({ ...o, size, w: o.w * k })
      return resized({ ...o, size }, o.wrap ? o.w * k : Math.ceil(L.w), L.h, ax, ay)
    }
    // Sides set the width the text wraps to.
    const next = { ...o, wrap: true, w: Math.max(o.size * 0.5, w) }
    const L = layoutText(next)
    return resized({ ...o, wrap: true }, next.w, L.h, ax, 0)
  }
  if (constrain && h.hx && h.hy) {
    const s = Math.max(w / Math.max(1, o.w), ht / Math.max(1, o.h))
    w = Math.max(1, o.w * s)
    ht = Math.max(1, o.h * s)
  }
  return resized(o, w, ht, ax, ay)
}
