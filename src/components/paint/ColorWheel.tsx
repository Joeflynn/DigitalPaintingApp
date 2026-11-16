import { useEffect, useRef } from "react"
import type * as React from "react"

import { hsvToHex, hsvToRgb, type HSV } from "@/paint/color"

/**
 * A hue ring around a saturation/brightness picker. The inner picker comes in
 * four shapes; each is a pair of mappings between a point inside the ring
 * (unit circle, x right, y down) and saturation/brightness.
 */

export type WheelShape = "diamond" | "circle" | "square" | "triangle"
export const WHEEL_SHAPES: WheelShape[] = ["diamond", "circle", "square", "triangle"]

interface Point {
  x: number
  y: number
}
interface SV {
  s: number
  v: number
}

interface Shape {
  /** Saturation/brightness at a point; points outside snap to the nearest edge. */
  toSV(p: Point, hue: number): SV
  fromSV(sv: SV): Point
  /** CSS clip-path of the shape within the ring's inner square. */
  clip: string
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const HALF = Math.SQRT1_2
const R3 = Math.sqrt(3)

// The diamond and circle blend four corners: white on top, the pure hue on
// the right, black at the bottom and mid grey on the left, so tints, shades
// and muted tones each get a region. `a` runs grey→white, `b` runs grey→black.
function patchToSV(a: number, b: number, hue: number): SV {
  const pure = hsvToRgb({ h: hue, s: 1, v: 1 })
  let max = 0
  let min = 1
  for (const ch of pure) {
    const c = (1 - b) * (0.5 + 0.5 * a) + (ch / 255) * a * b
    max = Math.max(max, c)
    min = Math.min(min, c)
  }
  return { s: max > 0 ? (max - min) / max : 0, v: max }
}

function svToPatch({ s, v }: SV): { a: number; b: number } {
  const chroma = v * s
  const low = v - chroma
  if (chroma < 1e-6) return low >= 0.5 ? { a: 2 * low - 1, b: 0 } : { a: 0, b: 1 - 2 * low }
  const k = chroma + 2 * low - 1
  const b = clamp01((-k + Math.sqrt(k * k + 4 * chroma)) / 2)
  return { a: clamp01(chroma / b), b }
}

const diamond: Shape = {
  toSV: ({ x, y }, hue) => patchToSV(clamp01((x - y + 1) / 2), clamp01((x + y + 1) / 2), hue),
  fromSV(sv) {
    const { a, b } = svToPatch(sv)
    return { x: a + b - 1, y: b - a }
  },
  clip: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
}

// The circle is the diamond stretched radially out to the ring.
const circle: Shape = {
  toSV({ x, y }, hue) {
    const r = Math.hypot(x, y)
    const m = Math.abs(x) + Math.abs(y)
    if (m < 1e-9) return diamond.toSV({ x: 0, y: 0 }, hue)
    const k = Math.min(r, 1) / m
    return diamond.toSV({ x: x * k, y: y * k }, hue)
  },
  fromSV(sv) {
    const p = diamond.fromSV(sv)
    const r = Math.hypot(p.x, p.y)
    if (r < 1e-9) return p
    const k = (Math.abs(p.x) + Math.abs(p.y)) / r
    return { x: p.x * k, y: p.y * k }
  },
  clip: "circle(50%)",
}

const square: Shape = {
  toSV: ({ x, y }) => ({
    s: clamp01((x + HALF) / (2 * HALF)),
    v: 1 - clamp01((y + HALF) / (2 * HALF)),
  }),
  fromSV: ({ s, v }) => ({ x: (2 * s - 1) * HALF, y: (1 - 2 * v) * HALF }),
  clip: "inset(14.64% round 5%)",
}

// White at the top, the pure hue bottom right, black bottom left.
const triangle: Shape = {
  toSV({ x, y }) {
    const white = clamp01((0.5 - y) / 1.5)
    const rest = 1 - white
    const d = Math.max(-rest, Math.min(rest, (2 * x) / R3))
    const pure = (rest + d) / 2
    const v = white + pure
    return { s: v > 0 ? pure / v : 0, v }
  },
  fromSV({ s, v }) {
    const pure = s * v
    const white = v - pure
    const black = 1 - v
    return { x: (R3 / 2) * (pure - black), y: 0.5 * (pure + black) - white }
  },
  clip: "polygon(50% 0, 93.3% 75%, 6.7% 75%)",
}

const SHAPES: Record<WheelShape, Shape> = { diamond, circle, square, triangle }

/** Pixels per side the picker is painted at; CSS scales it to fit. */
const RES = 200

const handle =
  "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.5)] outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function ColorWheel({
  color,
  onChange,
  shape,
  size,
}: {
  color: HSV
  onChange: (color: HSV) => void
  shape: WheelShape
  /** Outer diameter in pixels. */
  size: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef<"hue" | "sv" | null>(null)
  const map = SHAPES[shape]

  const ring = Math.max(12, Math.round(size * 0.088))
  // Radius of the inner picker, leaving a little air inside the ring.
  const inner = size / 2 - ring - Math.max(4, size * 0.035)
  const knob = Math.max(12, Math.min(22, ring - 2))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!ctx) return
    const img = ctx.createImageData(RES, RES)
    const shapeMap = SHAPES[shape]
    for (let py = 0, i = 0; py < RES; py++) {
      const y = ((py + 0.5) / RES) * 2 - 1
      for (let px = 0; px < RES; px++, i += 4) {
        const x = ((px + 0.5) / RES) * 2 - 1
        const { s, v } = shapeMap.toSV({ x, y }, color.h)
        const [r, g, b] = hsvToRgb({ h: color.h, s, v })
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [color.h, shape])

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left - r.width / 2
    const y = e.clientY - r.top - r.height / 2
    // A press starts on whichever control it lands on and stays with it.
    dragging.current ??= Math.hypot(x, y) > (inner + size / 2 - ring) / 2 ? "hue" : "sv"
    if (dragging.current === "hue") {
      const h = ((Math.atan2(-y, -x) * 180) / Math.PI + 360) % 360
      onChange({ ...color, h })
    } else {
      onChange({ h: color.h, ...map.toSV({ x: x / inner, y: y / inner }, color.h) })
    }
  }

  const step = (e: React.KeyboardEvent, apply: (dx: number, dy: number) => HSV) => {
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    const dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0
    if (!dx && !dy) return
    e.preventDefault()
    e.stopPropagation()
    const k = e.shiftKey ? 5 : 1
    onChange(apply(dx * k, dy * k))
  }

  const hueAngle = (color.h * Math.PI) / 180
  const ringR = size / 2 - ring / 2
  const at = map.fromSV(color)

  return (
    <div
      className="relative shrink-0 touch-none"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = null
        pick(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
      }}
    >
      <div
        className="absolute inset-0 cursor-crosshair rounded-full"
        style={{
          background:
            "conic-gradient(from 270deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          mask: `radial-gradient(closest-side, transparent calc(100% - ${ring + 0.5}px), #000 calc(100% - ${ring - 0.5}px))`,
        }}
      />
      <canvas
        ref={canvasRef}
        width={RES}
        height={RES}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair"
        style={{ width: inner * 2, height: inner * 2, clipPath: map.clip }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(color.h)}
        onKeyDown={(e) => step(e, (dx, dy) => ({ ...color, h: (color.h + (dx + dy) * 2 + 360) % 360 }))}
        className={handle}
        style={{
          width: knob,
          height: knob,
          left: size / 2 - Math.cos(hueAngle) * ringR,
          top: size / 2 - Math.sin(hueAngle) * ringR,
          background: hsvToHex({ h: color.h, s: 1, v: 1 }),
        }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(color.s * 100)}%, brightness ${Math.round(color.v * 100)}%`}
        aria-valuenow={Math.round(color.s * 100)}
        onKeyDown={(e) =>
          step(e, (dx, dy) => ({
            h: color.h,
            s: clamp01(color.s + dx * 0.02),
            v: clamp01(color.v + dy * 0.02),
          }))
        }
        className={handle}
        style={{
          width: knob,
          height: knob,
          left: size / 2 + at.x * inner,
          top: size / 2 + at.y * inner,
          background: hsvToHex(color),
        }}
      />
    </div>
  )
}
