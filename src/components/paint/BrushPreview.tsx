import { useEffect, useRef } from "react"

import type { BrushPreset } from "@/paint/brushes"
import { GPUBrush } from "@/paint/gpu-brush"
import { sampleStroke, Stroke } from "@/paint/stroke"

const W = 440
const H = 100

let renderer: Promise<GPUBrush> | undefined
const cache = new Map<string, string>()

/** Renders a sample stroke through the real brush shaders. */
function renderPreview(gpu: GPUBrush, brush: BrushPreset): string {
  const size = Math.min(60, Math.max(12, brush.size))
  gpu.begin({
    width: W,
    height: H,
    brush,
    color: [0.62, 0.8, 0.93],
    size,
    opacity: brush.opacity,
    seed: 123,
    mode: "paint",
  })
  const stroke = new Stroke((...dab) => gpu.dab(...dab), brush, {
    size,
    streamline: 0,
    seed: 123,
  })
  sampleStroke(stroke, 36, W - 36, brush.drip > 0 ? 34 : H / 2, 14)
  // Give wet paint a moment to bleed and run, as it would on the canvas.
  const frames = Math.min(gpu.settleFrames, 60)
  for (let i = 0; i < frames; i++) gpu.frame()
  gpu.frame(false)
  const out = document.createElement("canvas")
  out.width = W
  out.height = H
  out.getContext("2d")!.drawImage(gpu.canvas, 0, 0)
  return out.toDataURL()
}

export function BrushPreview({ brush }: { brush: BrushPreset }) {
  const ref = useRef<HTMLImageElement>(null)
  const key = JSON.stringify(brush)

  useEffect(() => {
    let cancelled = false
    const cached = cache.get(key)
    if (cached) {
      if (ref.current) ref.current.src = cached
      return
    }
    renderer ??= GPUBrush.create(() => {
      renderer = undefined
      cache.clear()
    })
    void renderer
      .then((gpu) => {
        if (cancelled) return
        const url = renderPreview(gpu, JSON.parse(key) as BrushPreset)
        if (cache.size > 96) cache.clear()
        cache.set(key, url)
        if (ref.current) ref.current.src = url
      })
      .catch(() => {
        renderer = undefined
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return (
    <img
      ref={ref}
      alt=""
      draggable={false}
      className="h-12 w-full object-contain opacity-90"
    />
  )
}
