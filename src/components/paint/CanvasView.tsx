import { useEffect, useRef } from "react"

import { useEngine } from "@/hooks/use-engine"
import { engine, selectedObject } from "@/paint/engine"
import { fontFamily } from "@/paint/vector"

/**
 * The live text being edited, as a real textarea laid exactly over where it
 * sits on the canvas. The engine keeps it positioned as the view moves.
 */
function TextEditor() {
  const s = useEngine()
  const obj = s.textEditing ? selectedObject(s) : null
  const ref = useRef<HTMLTextAreaElement>(null)
  const id = obj?.type === "text" ? obj.id : null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    engine.attachTextEditor(el)
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
    return () => engine.attachTextEditor(null)
  }, [id])

  if (!obj || obj.type !== "text") return null
  return (
    <textarea
      ref={ref}
      aria-label="Text"
      value={obj.text}
      spellCheck={false}
      autoCapitalize="off"
      wrap={obj.wrap ? "soft" : "off"}
      onChange={(e) => engine.setEditingText(e.target.value)}
      onBlur={() => engine.commitText()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          engine.commitText()
        }
        e.stopPropagation()
      }}
      className="absolute top-0 left-0 m-0 block origin-top-left resize-none overflow-hidden border-0 bg-transparent p-0 outline-none select-text"
      style={{
        fontFamily: fontFamily(obj.font),
        fontSize: obj.size,
        fontWeight: obj.weight,
        fontStyle: obj.italic ? "italic" : "normal",
        fontKerning: "normal",
        lineHeight: obj.lineHeight,
        letterSpacing: `${obj.spacing}em`,
        textAlign: obj.align,
        textDecoration: obj.underline ? "underline" : "none",
        whiteSpace: obj.wrap ? "pre-wrap" : "pre",
        overflowWrap: "break-word",
        color: obj.fill ?? "transparent",
        caretColor: obj.fill ?? obj.stroke ?? "#888",
        WebkitTextStroke:
          obj.stroke && obj.strokeWidth > 0 ? `${obj.strokeWidth}px ${obj.stroke}` : undefined,
        paintOrder: "stroke fill",
        opacity: obj.opacity,
      }}
    />
  )
}

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
      <TextEditor />
    </div>
  )
}
