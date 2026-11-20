export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d")!
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height)
  ctxOf(c).drawImage(src, 0, 0)
  return c
}

export function cropCanvas(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const c = makeCanvas(r.w, r.h)
  ctxOf(c).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c
}

/**
 * Writes before·(1−mask) + after·mask into `out`, using `tmp` as working
 * space. All four canvases are the same size; `mask` is a larger coverage
 * canvas whose (mx, my) lines up with their origin.
 */
export function maskedBlend(
  out: HTMLCanvasElement,
  tmp: HTMLCanvasElement,
  before: CanvasImageSource,
  after: CanvasImageSource,
  mask: CanvasImageSource,
  mx = 0,
  my = 0
): HTMLCanvasElement {
  const o = ctxOf(out)
  const t = ctxOf(tmp)
  o.globalAlpha = 1
  o.globalCompositeOperation = "copy"
  o.drawImage(after, 0, 0)
  o.globalCompositeOperation = "destination-in"
  o.drawImage(mask, -mx, -my)
  t.globalAlpha = 1
  t.globalCompositeOperation = "copy"
  t.drawImage(before, 0, 0)
  t.globalCompositeOperation = "destination-out"
  t.drawImage(mask, -mx, -my)
  o.globalCompositeOperation = "lighter"
  o.drawImage(tmp, 0, 0)
  o.globalCompositeOperation = "source-over"
  t.globalCompositeOperation = "source-over"
  return out
}

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Small deterministic PRNG so brush tips and previews are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let idCounter = 0
export function uid(prefix = "id"): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

/** The smallest rectangle holding every non-transparent pixel, or null if there are none. */
export function alphaBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c
  if (!w || !h) return null
  const data = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3
    for (let x = 0; x < w; x++, row += 4) {
      if (data[row] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
