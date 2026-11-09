import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInSimpleIcon,
  CompassIcon,
  DownloadSimpleIcon,
  FilePlusIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  ImageIcon,
  KeyboardIcon,
  MinusIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SplitHorizontalIcon,
} from "@phosphor-icons/react"
import { useRef, useState } from "react"
import type { ReactNode } from "react"

import { IconButton, Slider, panelClass } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { getBrush } from "@/paint/brushes"
import { engine, isPaintTool } from "@/paint/engine"

const PRESETS = [
  { label: "Landscape", w: 2000, h: 1400 },
  { label: "Portrait", w: 1400, h: 2000 },
  { label: "Square", w: 2048, h: 2048 },
  { label: "HD 1080p", w: 1920, h: 1080 },
  { label: "4K", w: 3840, h: 2160 },
]

const SHORTCUTS: [string, string][] = [
  ["B / E / S", "Brush, eraser, smudge"],
  ["G / I / V / H", "Fill, eyedropper, move, pan"],
  ["[  ]", "Brush size"],
  ["1 – 0", "Brush opacity"],
  ["Alt + click", "Pick colour"],
  ["X", "Swap colours"],
  ["Space + drag", "Pan"],
  ["Scroll", "Zoom"],
  ["R + drag / Shift + scroll", "Rotate canvas"],
  ["F", "Fit canvas"],
  ["M", "Symmetry"],
  ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
  ["Tab", "Hide panels"],
  ["Two-finger tap", "Undo (touch)"],
]

function Popover({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div className={cn(panelClass, "absolute top-full z-50 mt-2 p-3", className)}>
        {children}
      </div>
    </>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />
}

function NewCanvasMenu({ onDone }: { onDone: () => void }) {
  const [w, setW] = useState(2000)
  const [h, setH] = useState(1400)
  const valid = w >= 16 && h >= 16 && w <= 4096 && h <= 4096
  const field =
    "h-8 w-20 rounded-lg border border-white/10 bg-black/25 px-2 text-xs text-foreground outline-none focus:border-ring"
  return (
    <div className="flex w-60 flex-col gap-2.5">
      <div className="text-xs font-semibold tracking-wide uppercase">New canvas</div>
      <div className="grid grid-cols-2 gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setW(p.w)
              setH(p.h)
            }}
            className={cn(
              "rounded-lg bg-black/20 px-2 py-1.5 text-left text-[11px] outline-none hover:bg-black/40 focus-visible:ring-2 focus-visible:ring-ring",
              p.w === w && p.h === h && "bg-primary/30 hover:bg-primary/30"
            )}
          >
            <div className="font-medium text-foreground">{p.label}</div>
            <div className="text-muted-foreground tabular-nums">
              {p.w} × {p.h}
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="number"
          aria-label="Width in pixels"
          className={field}
          value={w}
          onChange={(e) => setW(Number(e.target.value))}
        />
        ×
        <input
          type="number"
          aria-label="Height in pixels"
          className={field}
          value={h}
          onChange={(e) => setH(Number(e.target.value))}
        />
        px
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        This replaces the current painting. Export it first if you want to keep it.
      </p>
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          engine.newDocument(Math.round(w), Math.round(h))
          onDone()
        }}
        className="h-8 rounded-lg bg-primary text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        Create canvas
      </button>
    </div>
  )
}

function ContextBar() {
  const s = useEngine()
  const label = "text-[10px] font-medium tracking-wide text-muted-foreground uppercase"

  if (isPaintTool(s.tool)) {
    const tool = s.tool
    const settings = s.toolSettings[tool]
    return (
      <>
        <span className="max-w-32 truncate text-xs font-medium text-foreground">
          {getBrush(settings.brushId).name}
        </span>
        <Divider />
        {tool !== "smudge" && (
          <>
            <span className={label}>Stabilise</span>
            <Slider
              label="Stroke stabilisation"
              className="w-24"
              min={0}
              max={1}
              value={settings.streamline}
              onChange={(v) => engine.setToolSettings(tool, { streamline: v })}
            />
            <span className="w-7 text-[11px] text-foreground tabular-nums">
              {Math.round(settings.streamline * 100)}
            </span>
          </>
        )}
        {tool === "smudge" && (
          <span className="text-[11px] text-muted-foreground">Drag to blend paint</span>
        )}
      </>
    )
  }
  if (s.tool === "fill") {
    return (
      <>
        <span className={label}>Tolerance</span>
        <Slider
          label="Fill tolerance"
          className="w-28"
          min={0}
          max={255}
          value={s.fillTolerance}
          onChange={(v) => engine.setFillTolerance(v)}
        />
        <span className="w-7 text-[11px] text-foreground tabular-nums">{s.fillTolerance}</span>
      </>
    )
  }
  if (s.tool === "move") {
    return (
      <>
        <span className={label}>Layer</span>
        <IconButton label="Flip layer horizontally" className="size-7" onClick={() => engine.flipLayer(s.activeLayerId, "h")}>
          <FlipHorizontalIcon />
        </IconButton>
        <IconButton label="Flip layer vertically" className="size-7" onClick={() => engine.flipLayer(s.activeLayerId, "v")}>
          <FlipVerticalIcon />
        </IconButton>
        <button
          type="button"
          onClick={() => engine.clearLayer(s.activeLayerId)}
          className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear layer
        </button>
      </>
    )
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      {s.tool === "eyedropper" ? "Click the canvas to pick a colour" : "Drag to pan · scroll to zoom"}
    </span>
  )
}

export function TopBar({
  panelsOpen,
  onTogglePanels,
}: {
  panelsOpen: boolean
  onTogglePanels: () => void
}) {
  const s = useEngine()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<"new" | "keys" | null>(null)
  const degrees = Math.round((((s.rotation * 180) / Math.PI) % 360 + 540) % 360 - 180)

  const exportPng = async () => {
    const blob = await engine.exportPNG()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `painting-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    engine.notify("Exported PNG")
  }

  const importImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const bmp = await createImageBitmap(file)
      engine.addImageLayer(bmp, bmp.width, bmp.height, file.name.replace(/\.[^.]+$/, ""))
      bmp.close()
    } catch {
      engine.notify("That file couldn't be opened as an image")
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex items-start justify-between gap-2">
      <div className={cn(panelClass, "pointer-events-auto relative flex h-12 items-center gap-0.5 px-2")}>
        <div className="mr-1 flex items-center gap-2 pr-1 pl-1.5">
          <span className="size-4 rounded-full bg-[conic-gradient(from_210deg,#e5533d,#f6c445,#3f9d5a,#4aa3df,#7a4fc4,#e5533d)]" />
          <span className="text-sm font-semibold tracking-tight">Pigment</span>
        </div>
        <Divider />
        <IconButton label="New canvas" active={menu === "new"} onClick={() => setMenu(menu === "new" ? null : "new")}>
          <FilePlusIcon />
        </IconButton>
        <IconButton label="Import image as layer" onClick={() => fileRef.current?.click()}>
          <ImageIcon />
        </IconButton>
        <IconButton label="Export PNG" onClick={() => void exportPng()}>
          <DownloadSimpleIcon />
        </IconButton>
        <Divider />
        <IconButton label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => engine.undo()}>
          <ArrowCounterClockwiseIcon />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => engine.redo()}>
          <ArrowClockwiseIcon />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void importImage(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        <Popover open={menu === "new"} onClose={() => setMenu(null)} className="left-0">
          <NewCanvasMenu onDone={() => setMenu(null)} />
        </Popover>
      </div>

      <div className={cn(panelClass, "pointer-events-auto hidden h-12 items-center gap-2 px-3.5 md:flex")}>
        <ContextBar />
      </div>

      <div className={cn(panelClass, "pointer-events-auto relative flex h-12 items-center gap-0.5 px-2")}>
        <IconButton label="Symmetry (M)" active={s.symmetry} onClick={() => engine.setSymmetry(!s.symmetry)}>
          <SplitHorizontalIcon />
        </IconButton>
        <button
          type="button"
          title="Reset canvas rotation"
          onClick={() => engine.resetRotation()}
          className={cn(
            "flex h-9 items-center gap-1 rounded-xl px-2 text-[11px] text-muted-foreground tabular-nums outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            degrees !== 0 && "text-foreground"
          )}
        >
          <CompassIcon className="size-[18px]" />
          {degrees}°
        </button>
        <Divider />
        <IconButton label="Zoom out (−)" onClick={() => engine.zoomBy(0.8)}>
          <MinusIcon />
        </IconButton>
        <button
          type="button"
          title="Zoom to 100%"
          onClick={() => engine.zoomBy(1 / s.zoom)}
          className="h-9 w-12 rounded-xl text-center text-[11px] text-foreground tabular-nums outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Math.round(s.zoom * 100)}%
        </button>
        <IconButton label="Zoom in (+)" onClick={() => engine.zoomBy(1.25)}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Fit canvas (F)" onClick={() => engine.fit()}>
          <ArrowsInSimpleIcon />
        </IconButton>
        <Divider />
        <IconButton label="Keyboard shortcuts" active={menu === "keys"} onClick={() => setMenu(menu === "keys" ? null : "keys")}>
          <KeyboardIcon />
        </IconButton>
        <IconButton label="Toggle panels (Tab)" active={panelsOpen} onClick={onTogglePanels}>
          <SidebarSimpleIcon />
        </IconButton>
        <Popover open={menu === "keys"} onClose={() => setMenu(null)} className="right-0 w-72">
          <div className="mb-2 text-xs font-semibold tracking-wide uppercase">Shortcuts</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-foreground">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Popover>
      </div>
    </div>
  )
}
