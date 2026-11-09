import { useEffect, useRef } from "react"

import { engine } from "@/paint/engine"

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const detach = engine.attach(canvas, cursorRef.current)
    const measure = () => {
      const r = wrap.getBoundingClientRect()
      engine.resize(r.width, r.height, window.devicePixelRatio || 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => {
      ro.disconnect()
      detach()
    }
  }, [])

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none outline-none"
      />
      <div
        ref={cursorRef}
        className="pointer-events-none absolute top-0 left-0 rounded-full border border-white/90 opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(0,0,0,0.35)]"
      />
    </div>
  )
}
