import { useEffect, useRef } from "react"

import { panelClass } from "@/components/paint/controls"
import { cn } from "@/lib/utils"
import { aids, docToScreen, useAids, VP_COLORS } from "@/paint/aids"
import { engine } from "@/paint/engine"

/**
 * The parts of the drawing aids that are handled on the canvas itself: the
 * draggable vanishing points, and the layer that turns drags into camera
 * moves while the 3D reference is being positioned.
 */
export function AidsOverlay() {
  const a = useAids()
  const root = useRef<HTMLDivElement>(null)
  const handles = useRef<(HTMLButtonElement | null)[]>([])
  const editing = a.perspective.on && a.perspective.editing
  const adjusting = a.reference.on && a.reference.adjusting

  // Keep the handles on their vanishing points as the view moves.
  useEffect(() => {
    if (!editing) return
    return aids.onFrame((f) => {
      const { vp } = aids.get().perspective
      handles.current.forEach((el, i) => {
        if (!el) return
        const [x, y] = docToScreen(f, vp[i].x * f.docW, vp[i].y * f.docH)
        el.style.transform = `translate(${x}px, ${y}px)`
      })
    })
  }, [editing, a.perspective.points])

  useEffect(() => {
    if (!adjusting && !editing) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      aids.setReference({ adjusting: false })
      aids.setPerspective({ editing: false })
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [adjusting, editing])

  const dragPoint = (i: number, e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !root.current) return
    const r = root.current.getBoundingClientRect()
    const [x, y] = engine.screenToDoc(e.clientX - r.left, e.clientY - r.top)
    const { docW, docH } = engine.getState()
    aids.setVanishingPoint(i, { x: x / docW, y: y / docH })
  }

  const dragCamera = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const ref = aids.get().reference
    const { docW, docH, zoom } = engine.getState()
    if (e.shiftKey || e.altKey || e.buttons & 6) {
      // Slide the model across the canvas: 2 units span the whole page.
      aids.setReference({
        x: ref.x + (2 * e.movementX) / (docW * zoom),
        y: ref.y - (2 * e.movementY) / (docH * zoom),
      })
    } else {
      aids.setReference({
        yaw: ((ref.yaw - e.movementX * 0.4 + 540) % 360) - 180,
        pitch: Math.max(-89, Math.min(89, ref.pitch + e.movementY * 0.4)),
      })
    }
  }

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {adjusting && (
        <>
          <div
            aria-label="Drag to turn the 3D reference"
            className="pointer-events-auto absolute inset-0 cursor-move touch-none"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={dragCamera}
            onContextMenu={(e) => e.preventDefault()}
            onWheel={(e) => {
              const ref = aids.get().reference
              aids.setReference({ size: Math.max(0.1, Math.min(4, ref.size * Math.exp(-e.deltaY * 0.0015))) })
            }}
          />
          <div
            className={cn(
              panelClass,
              "pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 py-1.5 pr-1.5 pl-4 text-[11px] text-muted-foreground"
            )}
          >
            <span>
              <b className="font-medium text-foreground">Drag</b> to turn ·{" "}
              <b className="font-medium text-foreground">Shift-drag</b> to move ·{" "}
              <b className="font-medium text-foreground">Scroll</b> to resize
            </span>
            <button
              type="button"
              onClick={() => aids.setReference({ adjusting: false })}
              className="h-7 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Done
            </button>
          </div>
        </>
      )}
      {editing &&
        Array.from({ length: a.perspective.points }, (_, i) => (
          <button
            key={i}
            ref={(el) => {
              handles.current[i] = el
            }}
            type="button"
            title={`Vanishing point ${i + 1} — drag to move`}
            aria-label={`Vanishing point ${i + 1}`}
            className="pointer-events-auto absolute top-0 left-0 -m-2.5 size-5 cursor-grab touch-none rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_2px_6px_rgba(0,0,0,0.5)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            style={{ background: VP_COLORS[i] }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => dragPoint(i, e)}
          />
        ))}
    </div>
  )
}
