import { clamp, ctxOf, makeCanvas, mulberry32 } from "./util"

export type TipShape = "round" | "grain" | "bristle" | "splatter" | "chalk"

export type BrushCategory = "Sketch" | "Ink" | "Paint" | "Airbrush" | "Texture"

export const BRUSH_CATEGORIES: BrushCategory[] = [
  "Sketch",
  "Ink",
  "Paint",
  "Airbrush",
  "Texture",
]

export interface BrushPreset {
  id: string
  name: string
  category: BrushCategory
  tip: TipShape
  /** 0 = fully soft falloff, 1 = hard edge */
  hardness: number
  /** Default diameter in document pixels */
  size: number
  /** Default stroke opacity */
  opacity: number
  /** Dab spacing as a fraction of the dab diameter */
  spacing: number
  /** Alpha of each dab */
  flow: number
  /** How much pen pressure drives size (0–1) */
  sizePressure: number
  /** How much pen pressure drives flow (0–1) */
  flowPressure: number
  sizeJitter: number
  /** Random rotation per dab, 0–1 of a full turn */
  angleJitter: number
  /** Random offset per dab as a fraction of size */
  scatter: number
  /** Rotate the tip to follow the stroke direction */
  followDirection: boolean
  /** Tip squash, 1 = circular */
  roundness: number
  /** Base tip rotation in degrees */
  angle: number
  /** Default stabilisation, 0–1 */
  streamline: number
}

const base: Omit<BrushPreset, "id" | "name" | "category"> = {
  tip: "round",
  hardness: 0.9,
  size: 12,
  opacity: 1,
  spacing: 0.06,
  flow: 1,
  sizePressure: 0,
  flowPressure: 0,
  sizeJitter: 0,
  angleJitter: 0,
  scatter: 0,
  followDirection: false,
  roundness: 1,
  angle: 0,
  streamline: 0.3,
}

function preset(
  id: string,
  name: string,
  category: BrushCategory,
  over: Partial<BrushPreset>
): BrushPreset {
  return { ...base, id, name, category, ...over }
}

export const BRUSHES: BrushPreset[] = [
  preset("hb-pencil", "HB Pencil", "Sketch", {
    tip: "grain",
    hardness: 0.5,
    size: 7,
    spacing: 0.14,
    flow: 0.55,
    flowPressure: 0.8,
    sizePressure: 0.25,
    angleJitter: 1,
    streamline: 0.1,
  }),
  preset("6b-pencil", "6B Pencil", "Sketch", {
    tip: "grain",
    hardness: 0.2,
    size: 18,
    spacing: 0.12,
    flow: 0.4,
    flowPressure: 0.9,
    sizePressure: 0.4,
    angleJitter: 1,
    scatter: 0.04,
    streamline: 0.1,
  }),
  preset("charcoal", "Charcoal", "Sketch", {
    tip: "chalk",
    size: 46,
    spacing: 0.1,
    flow: 0.45,
    flowPressure: 0.85,
    sizePressure: 0.2,
    angleJitter: 1,
    roundness: 0.6,
    streamline: 0.1,
  }),
  preset("studio-pen", "Studio Pen", "Ink", {
    hardness: 0.92,
    size: 12,
    spacing: 0.05,
    sizePressure: 0.85,
    streamline: 0.5,
  }),
  preset("technical-pen", "Technical Pen", "Ink", {
    hardness: 0.95,
    size: 5,
    spacing: 0.05,
    streamline: 0.35,
  }),
  preset("sumi", "Sumi Brush", "Ink", {
    hardness: 0.7,
    size: 30,
    spacing: 0.04,
    sizePressure: 1,
    flowPressure: 0.3,
    streamline: 0.6,
  }),
  preset("dry-ink", "Dry Ink", "Ink", {
    tip: "chalk",
    size: 20,
    spacing: 0.08,
    flow: 0.9,
    sizePressure: 0.7,
    angleJitter: 1,
    streamline: 0.4,
  }),
  preset("gouache", "Gouache", "Paint", {
    hardness: 0.75,
    size: 40,
    spacing: 0.05,
    flow: 0.85,
    flowPressure: 0.5,
    sizePressure: 0.4,
    streamline: 0.2,
  }),
  preset("oil-bristle", "Oil Bristle", "Paint", {
    tip: "bristle",
    size: 52,
    spacing: 0.03,
    flow: 0.45,
    flowPressure: 0.4,
    sizePressure: 0.3,
    followDirection: true,
    streamline: 0.2,
  }),
  preset("chisel-marker", "Chisel Marker", "Paint", {
    hardness: 0.88,
    size: 34,
    opacity: 0.65,
    spacing: 0.04,
    roundness: 0.3,
    angle: -40,
    streamline: 0.25,
  }),
  preset("watercolor", "Watercolor Wash", "Paint", {
    hardness: 0.3,
    size: 80,
    opacity: 0.7,
    spacing: 0.08,
    flow: 0.08,
    flowPressure: 0.6,
    sizePressure: 0.4,
    streamline: 0.2,
  }),
  preset("hard-round", "Hard Round", "Airbrush", {
    hardness: 0.9,
    size: 40,
    spacing: 0.05,
    sizePressure: 0.3,
    streamline: 0.2,
  }),
  preset("hard-airbrush", "Hard Airbrush", "Airbrush", {
    hardness: 0.6,
    size: 60,
    spacing: 0.06,
    flow: 0.15,
    flowPressure: 1,
    streamline: 0.2,
  }),
  preset("soft-airbrush", "Soft Airbrush", "Airbrush", {
    hardness: 0,
    size: 120,
    spacing: 0.08,
    flow: 0.06,
    flowPressure: 1,
    streamline: 0.2,
  }),
  preset("chalk", "Chalk", "Texture", {
    tip: "chalk",
    size: 30,
    spacing: 0.1,
    flow: 0.8,
    flowPressure: 0.5,
    angleJitter: 0.08,
    followDirection: true,
    streamline: 0.15,
  }),
  preset("spray", "Spray Paint", "Texture", {
    tip: "splatter",
    size: 90,
    spacing: 0.2,
    flow: 0.5,
    flowPressure: 0.5,
    angleJitter: 1,
    scatter: 0.35,
    sizeJitter: 0.5,
    streamline: 0.1,
  }),
  preset("stipple", "Stipple", "Texture", {
    tip: "splatter",
    size: 36,
    spacing: 0.5,
    flow: 0.9,
    angleJitter: 1,
    scatter: 0.6,
    sizeJitter: 0.6,
    sizePressure: 0.3,
    streamline: 0.1,
  }),
]

const byId = new Map(BRUSHES.map((b) => [b.id, b]))

export function getBrush(id: string): BrushPreset {
  return byId.get(id) ?? BRUSHES[0]
}

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 400

// ---------------------------------------------------------------------------
// Tip rendering. Tips are white alpha masks, cached per resolution bucket so a
// 4px pencil and a 300px airbrush both get an appropriately sized bitmap.
// ---------------------------------------------------------------------------

const tipCache = new Map<string, HTMLCanvasElement>()

function falloff(t: number, hardness: number): number {
  if (t >= 1) return 0
  if (t <= hardness) return 1
  const u = (t - hardness) / (1 - hardness)
  // smootherstep, inverted
  return 1 - u * u * (3 - 2 * u)
}

function drawRound(ctx: CanvasRenderingContext2D, res: number, hardness: number) {
  const r = res / 2
  // Always leave ~1.5px of soft edge so hard brushes stay anti-aliased.
  const h = clamp(Math.min(hardness, 1 - 1.5 / r), 0, 0.99)
  const g = ctx.createRadialGradient(r, r, 0, r, r, r)
  const stops = 14
  g.addColorStop(0, "rgba(255,255,255,1)")
  for (let i = 0; i <= stops; i++) {
    const t = h + ((1 - h) * i) / stops
    g.addColorStop(t, `rgba(255,255,255,${falloff(t, h).toFixed(4)})`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, res, res)
}

function drawGrain(ctx: CanvasRenderingContext2D, res: number, hardness: number) {
  const img = ctx.createImageData(res, res)
  const rand = mulberry32(7 + res)
  const r = res / 2
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r
      const n = rand()
      const a = falloff(d, hardness) * (n < 0.6 ? 0.35 + rand() * 0.65 : 0)
      const i = (y * res + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = a * 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function drawChalk(ctx: CanvasRenderingContext2D, res: number) {
  const img = ctx.createImageData(res, res)
  const cell = Math.max(1, Math.round(res / 20))
  const cells = Math.ceil(res / cell)
  const rand = mulberry32(31)
  // Noise is generated per cell from a fixed seed so every resolution bucket
  // has the same overall shape.
  const edge = new Float32Array(cells * cells)
  const body = new Float32Array(cells * cells)
  for (let i = 0; i < edge.length; i++) {
    edge[i] = rand()
    body[i] = rand()
  }
  const r = res / 2
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const ci = Math.floor(y / cell) * cells + Math.floor(x / cell)
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r
      let a = 0
      if (d + edge[ci] * 0.3 < 1) a = body[ci] > 0.3 ? 0.45 + body[ci] * 0.55 : 0
      const i = (y * res + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = a * 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  res: number,
  count: number,
  minR: number,
  maxR: number,
  seed: number
) {
  const rand = mulberry32(seed)
  const r = res / 2
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2
    const dist = Math.sqrt(rand()) * (1 - maxR) * r
    const dr = Math.max(0.6, (minR + rand() * (maxR - minR)) * r)
    ctx.globalAlpha = 0.45 + rand() * 0.55
    ctx.fillStyle = "#fff"
    ctx.beginPath()
    ctx.arc(r + Math.cos(ang) * dist, r + Math.sin(ang) * dist, dr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

export function getTip(brush: BrushPreset, px: number): HTMLCanvasElement {
  let res = 16
  while (res < px && res < 256) res *= 2
  const key = `${brush.tip}:${brush.hardness}:${res}`
  const cached = tipCache.get(key)
  if (cached) return cached
  const c = makeCanvas(res, res)
  const ctx = ctxOf(c)
  switch (brush.tip) {
    case "round":
      drawRound(ctx, res, brush.hardness)
      break
    case "grain":
      drawGrain(ctx, res, brush.hardness)
      break
    case "chalk":
      drawChalk(ctx, res)
      break
    case "bristle":
      drawDots(ctx, res, 46, 0.03, 0.11, 11)
      break
    case "splatter":
      drawDots(ctx, res, 16, 0.02, 0.13, 23)
      break
  }
  tipCache.set(key, c)
  return c
}

/** A tip mask filled with a solid colour, ready to be stamped. */
export function makeStamp(tip: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = makeCanvas(tip.width, tip.height)
  const ctx = ctxOf(c)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(tip, 0, 0)
  return c
}
