import { useRef, useSyncExternalStore } from "react"
import type * as React from "react"

import { panelClass } from "@/components/paint/controls"
import { cn } from "@/lib/utils"

/**
 * Floating panel layout. Every panel is a free rectangle the user can drag by
 * its grip and resize from any edge; while moving, edges snap magnetically to
 * the window margins and to the other panels. Once dropped, a panel is
 * anchored to its nearest window edges so it stays put when the window
 * resizes, and a panel held between something above it and the bottom margin
 * stretches to keep filling that space.
 */

export type PanelId = "tools" | "color" | "options" | "layers" | "aids"
export type ControlId = "context" | "viewControls"
export type ViewItem = PanelId | ControlId

/** Gap kept to the window edge, between snapped panels, and below the top bar. */
const MARGIN = 12
const GAP = 12
const TOP = 72
const SNAP = 10
const KEY = "pigment.layout.v2"
/** Widths of the right-hand column (colour, layers) and the brush library. */
const SIDE_W = 206
const OPTIONS_W = 260
const COLOR_H = 316
const PANEL_IDS: PanelId[] = ["tools", "color", "options", "layers", "aids"]

interface Placement {
  /** Horizontal anchor edge and the distance to it. */
  ax: "l" | "r"
  x: number
  /** Vertical anchor: top, bottom, stretched between both, or centred. */
  ay: "t" | "b" | "s" | "c"
  t: number
  b: number
  w: number
  h: number
  /** Too close to the top bar for a menu to open above the panel. */
  tight?: boolean
  /** Height to use in the panel's other mode (colour: compact vs expanded). */
  alt?: number
}

export interface LayoutState {
  panels: Record<PanelId, Placement>
  /** Stacking order, back to front. */
  order: PanelId[]
  hidden: Partial<Record<ViewItem, boolean>>
  /** The colour panel shows its full tabbed view rather than just the wheel. */
  colorExpanded?: boolean
  /** Snap lines shown while a panel is being moved; never saved. */
  guides: { x?: number; y?: number } | null
}

function defaults(): LayoutState {
  const vh = typeof window === "undefined" ? 900 : window.innerHeight
  // Colour and layers stack down the right edge; the brush library hangs
  // full height beside them; the contextual tool rail sits mid-left.
  const side = { ax: "r", x: MARGIN, w: SIDE_W, b: MARGIN } as const
  return {
    panels: {
      tools: { ax: "l", x: MARGIN, ay: "c", t: TOP, b: MARGIN, w: 50, h: 0 },
      color: { ...side, ay: "t", t: TOP, h: COLOR_H, tight: true },
      options: { ax: "r", x: MARGIN + SIDE_W + GAP, ay: "s", t: TOP, b: MARGIN, w: OPTIONS_W, h: vh - TOP - MARGIN, tight: true },
      layers: { ...side, ay: "s", t: TOP + COLOR_H + GAP, h: 200 },
      aids: { ax: "l", x: 70, ay: "t", t: TOP, b: MARGIN, w: 280, h: Math.min(560, vh - TOP - MARGIN), tight: true },
    },
    order: [...PANEL_IDS],
    // Drawing aids stay out of the way until asked for.
    hidden: { aids: true },
    guides: null,
  }
}

function load(): LayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LayoutState> | null
    const ok =
      raw?.panels &&
      Array.isArray(raw.order) &&
      Object.values(raw.panels).every((p) => p && [p.x, p.t, p.b, p.w, p.h].every(Number.isFinite))
    if (ok) {
      // Panels added since this layout was saved start hidden, in their default spot.
      const base = defaults()
      const added = PANEL_IDS.filter((id) => !raw.panels![id])
      const hidden = { ...raw.hidden }
      for (const id of added) hidden[id] = base.hidden[id] ?? true
      return {
        panels: { ...base.panels, ...raw.panels },
        order: [...raw.order!.filter((id) => PANEL_IDS.includes(id)), ...PANEL_IDS.filter((id) => !raw.order!.includes(id))],
        hidden,
        colorExpanded: !!raw.colorExpanded,
        guides: null,
      }
    }
  } catch {
    // fall through to the default layout
  }
  return defaults()
}

let state = load()
const subscribers = new Set<() => void>()

function commit(next: LayoutState, save = true) {
  state = next
  if (save) {
    try {
      const { panels, order, hidden, colorExpanded } = next
      localStorage.setItem(KEY, JSON.stringify({ panels, order, hidden, colorExpanded }))
    } catch {
      // storage unavailable: the layout just won't persist
    }
  }
  subscribers.forEach((fn) => fn())
}

export const layout = {
  subscribe(fn: () => void) {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },
  get: () => state,
  reset: () => commit(defaults()),
  toggle(id: ViewItem) {
    commit({ ...state, hidden: { ...state.hidden, [id]: !state.hidden[id] } })
  },
  /** Switches the colour panel between its compact and expanded views. */
  toggleColor() {
    const p = state.panels.color
    const colorExpanded = !state.colorExpanded
    // Each view remembers its own height; the expanded one opens over
    // whatever sits below, so it comes to the front.
    const h = p.alt ?? (colorExpanded ? 600 : COLOR_H)
    commit({
      ...state,
      colorExpanded,
      panels: { ...state.panels, color: { ...p, h, alt: p.h } },
      order: [...state.order.filter((o) => o !== "color"), "color"],
    })
  },
  raise(id: PanelId) {
    if (state.order[state.order.length - 1] === id) return
    commit({ ...state, order: [...state.order.filter((o) => o !== id), id] })
  },
}

export function useLayout() {
  return useSyncExternalStore(layout.subscribe, layout.get)
}

/** Space taken by panels sitting against the left and right window edges. */
export function measureInsets(): [number, number] {
  const vw = window.innerWidth
  let left = 0
  let right = 0
  for (const el of document.querySelectorAll("[data-panel]")) {
    const r = el.getBoundingClientRect()
    if (r.left <= MARGIN + 1) left = Math.max(left, r.right + MARGIN)
    else if (r.right >= vw - MARGIN - 1) right = Math.max(right, vw - r.left + MARGIN)
  }
  return [left, right]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

type Snap = { d: number; at: number } | null

function snapTo(edge: number, targets: number[]): Snap {
  let out: Snap = null
  for (const at of targets) {
    const d = at - edge
    if (Math.abs(d) <= SNAP && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at }
  }
  return out
}

const nearer = (a: Snap, b: Snap): Snap => (!a ? b : !b ? a : Math.abs(b.d) < Math.abs(a.d) ? b : a)

function placementStyle(p: Placement, resizable: boolean): React.CSSProperties {
  // The clamps keep a panel on screen when the window gets smaller than the
  // layout was arranged for, without touching the saved position.
  const s: React.CSSProperties = {}
  const x = `clamp(${MARGIN}px, ${p.x}px, calc(100% - ${p.w + MARGIN}px))`
  if (p.ax === "l") s.left = x
  else s.right = x
  if (p.ay === "s") {
    s.top = p.t
    s.bottom = p.b
  } else if (p.ay === "c") {
    s.top = "50%"
    s.transform = "translateY(-50%)"
  } else if (p.ay === "t") {
    s.top = `clamp(${TOP}px, ${p.t}px, calc(100% - ${p.h + MARGIN}px))`
  } else {
    s.bottom = `min(max(${MARGIN}px, ${p.b}px), calc(100% - ${p.h + TOP}px))`
  }
  if (resizable) {
    s.width = p.w
    if (p.ay !== "s") s.height = p.h
  }
  return s
}

const HANDLES: [edges: string, className: string][] = [
  ["l", "top-3 bottom-3 -left-1 w-2 cursor-ew-resize"],
  ["r", "top-3 bottom-3 -right-1 w-2 cursor-ew-resize"],
  ["t", "inset-x-3 -top-1 h-1.5 cursor-ns-resize"],
  ["b", "inset-x-3 -bottom-1 h-2 cursor-ns-resize"],
  ["lt", "-top-1 -left-1 size-4 cursor-nwse-resize"],
  ["rb", "-right-1 -bottom-1 size-4 cursor-nwse-resize"],
  ["rt", "-top-1 -right-1 size-4 cursor-nesw-resize"],
  ["lb", "-bottom-1 -left-1 size-4 cursor-nesw-resize"],
]

export function PanelFrame({
  id,
  label,
  bare = false,
  resizable = true,
  minW = 240,
  minH = 150,
  maxW = 640,
  children,
}: {
  id: PanelId
  label: string
  /** No card of its own: the content draws its own surfaces. */
  bare?: boolean
  resizable?: boolean
  minW?: number
  minH?: number
  maxW?: number
  children: React.ReactNode
}) {
  const { panels, order } = useLayout()
  const frame = useRef<HTMLElement>(null)
  const p = panels[id]

  /** Drags the whole panel (`edges` null) or the named edges of it. */
  const begin = (e: React.PointerEvent<HTMLElement>, edges: string | null) => {
    const el = frame.current
    if (e.button !== 0 || !el) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)

    const vw = window.innerWidth
    const vh = window.innerHeight
    const r0 = el.getBoundingClientRect()
    const others = [...document.querySelectorAll("[data-panel]")]
      .filter((o) => o !== el)
      .map((o) => o.getBoundingClientRect())
    const xStart = [MARGIN, ...others.flatMap((o) => [o.right + GAP, o.left])]
    const xEnd = [vw - MARGIN, ...others.flatMap((o) => [o.left - GAP, o.right])]
    const yStart = [TOP, ...others.flatMap((o) => [o.bottom + GAP, o.top])]
    const yEnd = [vh - MARGIN, ...others.flatMap((o) => [o.top - GAP, o.bottom])]
    let rect = { x: r0.left, y: r0.top, w: r0.width, h: r0.height }
    let moved = false

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      let l = r0.left
      let t = r0.top
      let r = r0.right
      let b = r0.bottom
      let sx: Snap = null
      let sy: Snap = null
      if (!edges) {
        sx = nearer(snapTo(l + dx, xStart), snapTo(r + dx, xEnd))
        sy = nearer(snapTo(t + dy, yStart), snapTo(b + dy, yEnd))
        l = clamp(l + dx + (sx?.d ?? 0), MARGIN, vw - MARGIN - r0.width)
        t = clamp(t + dy + (sy?.d ?? 0), TOP, vh - MARGIN - r0.height)
        r = l + r0.width
        b = t + r0.height
      } else {
        if (edges.includes("r")) {
          sx = snapTo(r + dx, xEnd)
          r = clamp(sx?.at ?? r + dx, l + minW, Math.min(l + maxW, vw - MARGIN))
        }
        if (edges.includes("l")) {
          sx = snapTo(l + dx, xStart)
          l = clamp(sx?.at ?? l + dx, Math.max(MARGIN, r - maxW), r - minW)
        }
        if (edges.includes("b")) {
          sy = snapTo(b + dy, yEnd)
          b = clamp(sy?.at ?? b + dy, t + minH, vh - MARGIN)
        }
        if (edges.includes("t")) {
          sy = snapTo(t + dy, yStart)
          t = clamp(sy?.at ?? t + dy, TOP, b - minH)
        }
      }
      rect = { x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) }
      commit(
        {
          ...state,
          panels: {
            ...state.panels,
            [id]: { ax: "l", x: rect.x, ay: "t", t: rect.y, b: 0, w: rect.w, h: rect.h, tight: p.tight, alt: p.alt },
          },
          guides: { x: sx?.at, y: sy?.at },
        },
        false
      )
    }

    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      if (!moved) return
      // Anchor to the nearest window edges so the panel holds its place when
      // the window resizes.
      const { x, y, w, h } = rect
      const ax = x + w / 2 > vw / 2 ? "r" : "l"
      const onFloor = Math.abs(y + h - (vh - MARGIN)) < 1.5
      const held =
        Math.abs(y - TOP) < 1.5 ||
        others.some((o) => Math.abs(o.bottom + GAP - y) < 1.5 && o.left < x + w && o.right > x)
      const low = y + h / 2 > vh / 2 && h <= vh - TOP - MARGIN
      // Anything resting under the top bar or another panel hangs from the
      // top, so a stack keeps its spacing whatever the window height.
      const ay = held ? (resizable && onFloor ? "s" : "t") : low ? "b" : "t"
      commit({
        ...state,
        panels: {
          ...state.panels,
          [id]: {
            ax,
            x: ax === "l" ? x : vw - x - w,
            ay,
            t: y,
            b: vh - y - h,
            w,
            h,
            tight: y - TOP < 320,
            alt: p.alt,
          },
        },
        guides: null,
      })
    }

    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }

  return (
    <section
      ref={frame}
      data-panel={id}
      data-side={p.ax}
      data-tight={p.tight ? "" : undefined}
      aria-label={label}
      onPointerDownCapture={() => layout.raise(id)}
      className={cn(
        "group/panel absolute flex flex-col",
        bare ? "items-center gap-1.5" : panelClass
      )}
      style={{
        ...placementStyle(p, resizable),
        minWidth: resizable ? minW : undefined,
        minHeight: resizable ? minH : undefined,
        maxHeight: resizable ? `calc(100% - ${TOP + MARGIN}px)` : undefined,
        zIndex: 20 + order.indexOf(id),
      }}
    >
      <div
        title={`Drag to move the ${label.toLowerCase()} panel`}
        onPointerDown={(e) => begin(e, null)}
        className={cn(
          "flex shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing",
          bare ? cn(panelClass, "h-4 w-12 rounded-full") : "-mb-1 h-3.5"
        )}
      >
        <span className="h-1 w-8 rounded-full bg-white/15 transition-colors group-hover/panel:bg-white/35" />
      </div>
      {children}
      {resizable &&
        HANDLES.map(([edges, cls]) => (
          <div
            key={edges}
            onPointerDown={(e) => begin(e, edges)}
            className={cn("absolute touch-none rounded-full transition-colors hover:bg-white/20", cls)}
          />
        ))}
    </section>
  )
}

/** Lines marking what a moving panel has snapped to. */
export function SnapGuides() {
  const { guides } = useLayout()
  if (!guides) return null
  const line = "pointer-events-none absolute z-40 bg-emerald-400/70"
  return (
    <>
      {guides.x !== undefined && <div className={cn(line, "inset-y-0 w-px")} style={{ left: guides.x }} />}
      {guides.y !== undefined && <div className={cn(line, "inset-x-0 h-px")} style={{ top: guides.y }} />}
    </>
  )
}
