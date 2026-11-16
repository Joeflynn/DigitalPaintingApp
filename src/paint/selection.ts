import type { Rect } from "./util"

export type SelectMode = "replace" | "add" | "subtract" | "intersect"

export type SelectTool =
  | "select-rect"
  | "select-lasso"
  | "select-poly"
  | "select-brush"
  | "select-wand"

export const SELECT_TOOLS: SelectTool[] = [
  "select-rect",
  "select-lasso",
  "select-poly",
  "select-brush",
  "select-wand",
]

/** Largest per-channel difference between two RGBA pixels. */
function diff(px: Uint8ClampedArray, i: number, j: number): number {
  const a0 = px[i + 3]
  const a1 = px[j + 3]
  // colour only matters where there is something to see
  if (a0 === 0 && a1 === 0) return 0
  return Math.max(
    Math.abs(px[i] - px[j]),
    Math.abs(px[i + 1] - px[j + 1]),
    Math.abs(px[i + 2] - px[j + 2]),
    Math.abs(a0 - a1)
  )
}

/**
 * Magic wand: marks every pixel within `tol` of the one at (x0, y0), either
 * the connected region around it or everywhere in the image.
 */
export function floodSelect(
  px: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  tol: number,
  contiguous: boolean
): Uint8Array {
  const mask = new Uint8Array(w * h)
  const seed = (y0 * w + x0) * 4
  const match = (p: number) => diff(px, p * 4, seed) <= tol
  if (!contiguous) {
    for (let p = 0; p < mask.length; p++) if (match(p)) mask[p] = 1
    return mask
  }
  // scanline flood fill
  const stack: number[] = [y0 * w + x0]
  while (stack.length > 0) {
    const p = stack.pop()!
    if (mask[p] || !match(p)) continue
    const y = (p / w) | 0
    const row = y * w
    let xl = p - row
    let xr = xl
    while (xl > 0 && !mask[row + xl - 1] && match(row + xl - 1)) xl--
    while (xr < w - 1 && !mask[row + xr + 1] && match(row + xr + 1)) xr++
    for (let x = xl; x <= xr; x++) {
      mask[row + x] = 1
      if (y > 0 && !mask[row - w + x]) stack.push(row - w + x)
      if (y < h - 1 && !mask[row + w + x]) stack.push(row + w + x)
    }
  }
  return mask
}

/**
 * One dab of the selection brush. The disc under the brush is always
 * selected. With `px` given the selection then spreads outward over pixels
 * that resemble what the brush is on, stopping where the image changes
 * sharply — so it snaps to the edges of the thing being brushed.
 * Returns the rectangle of `mask` that may have changed.
 */
export function growDab(
  px: Uint8ClampedArray | null,
  w: number,
  h: number,
  mask: Uint8Array,
  cx: number,
  cy: number,
  r: number,
  contrast: number
): Rect | null {
  const reach = Math.ceil(px ? Math.min(r * 4, r + 500) : r)
  const x0 = Math.max(0, Math.floor(cx - reach))
  const y0 = Math.max(0, Math.floor(cy - reach))
  const x1 = Math.min(w - 1, Math.ceil(cx + reach))
  const y1 = Math.min(h - 1, Math.ceil(cy + reach))
  if (x1 < x0 || y1 < y0) return null
  const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }

  const stack: number[] = []
  const sum = [0, 0, 0, 0]
  let count = 0
  const r2 = r * r
  for (let y = Math.max(y0, Math.floor(cy - r)); y <= Math.min(y1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(x0, Math.floor(cx - r)); x <= Math.min(x1, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r2) continue
      const p = y * w + x
      mask[p] = 1
      if (px) {
        stack.push(p)
        const i = p * 4
        const a = px[i + 3]
        sum[0] += px[i] * a
        sum[1] += px[i + 1] * a
        sum[2] += px[i + 2] * a
        sum[3] += a
        count++
      }
    }
  }
  if (!px || count === 0) return rect

  // Average colour under the brush, weighted by coverage.
  const a = sum[3] / count
  const mr = sum[3] > 0 ? sum[0] / sum[3] : 0
  const mg = sum[3] > 0 ? sum[1] / sum[3] : 0
  const mb = sum[3] > 0 ? sum[2] / sum[3] : 0
  const globalTol = contrast * 2
  const stepTol = contrast * 0.6 + 4
  const reach2 = reach * reach
  const near = (i: number) => {
    const pa = px[i + 3]
    if (pa === 0 && a < 1) return true
    return (
      Math.abs(px[i] - mr) <= globalTol &&
      Math.abs(px[i + 1] - mg) <= globalTol &&
      Math.abs(px[i + 2] - mb) <= globalTol &&
      Math.abs(pa - a) <= globalTol
    )
  }
  const visit = (q: number, from: number, x: number, y: number) => {
    if (mask[q]) return
    const dx = x + 0.5 - cx
    const dy = y + 0.5 - cy
    if (dx * dx + dy * dy > reach2) return
    if (!near(q * 4) || diff(px, q * 4, from * 4) > stepTol) return
    mask[q] = 1
    stack.push(q)
  }
  while (stack.length > 0) {
    const p = stack.pop()!
    const y = (p / w) | 0
    const x = p - y * w
    if (x > x0) visit(p - 1, p, x - 1, y)
    if (x < x1) visit(p + 1, p, x + 1, y)
    if (y > y0) visit(p - w, p, x, y - 1)
    if (y < y1) visit(p + w, p, x, y + 1)
  }
  return rect
}

/** Writes a region of a 0/1 mask into a canvas as white pixels. */
export function maskToCanvas(
  mask: Uint8Array,
  w: number,
  r: Rect,
  ctx: CanvasRenderingContext2D
) {
  const img = ctx.createImageData(r.w, r.h)
  const d = img.data
  for (let y = 0; y < r.h; y++) {
    let p = (r.y + y) * w + r.x
    let i = y * r.w * 4
    for (let x = 0; x < r.w; x++, p++, i += 4) {
      if (mask[p]) {
        d[i] = 255
        d[i + 1] = 255
        d[i + 2] = 255
        d[i + 3] = 255
      }
    }
  }
  ctx.putImageData(img, r.x, r.y)
}

/** True when a selection canvas selects nothing at all. */
export function isEmpty(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d")!
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false
  return true
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}
