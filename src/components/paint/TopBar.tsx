import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInSimpleIcon,
  CaretDownIcon,
  CheckIcon,
  LayoutIcon,
  IntersectIcon,
  SelectionAllIcon,
  SelectionIcon,
  SubtractIcon,
  UniteIcon,
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

import { IconButton, Slider, panelClass, useDismiss } from "@/components/paint/controls"
import { layout, useLayout, type ViewItem } from "@/components/paint/layout"
import { SELECT_TOOL_INFO } from "@/components/paint/select-tools"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { getBrush } from "@/paint/brushes"
import {
  engine,
  isPaintTool,
  isSelectTool,
  type SelectMode,
  type SelectModify,
} from "@/paint/engine"

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
  ["A / L / P", "Rectangle, lasso, polygon select"],
  ["Q / W", "Selection brush, magic wand"],
  ["Shift / Alt + select", "Add to / subtract from selection"],
  ["Ctrl A / Ctrl D", "Select all / deselect"],
  ["Ctrl Shift I", "Invert selection"],
  ["Ctrl J / Ctrl Shift J", "Copy / cut selection to layer"],
  ["Delete", "Erase selection"],
  ["Esc / Enter", "Cancel / close polygon"],
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
  useDismiss(open, onClose)
  if (!open) return null
  return (
    <div data-popover className={cn(panelClass, "absolute top-full z-50 mt-2 p-3", className)}>
      {children}
    </div>
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

const MODES: { id: SelectMode; label: string; icon: ReactNode }[] = [
  { id: "replace", label: "New selection", icon: <SelectionIcon /> },
  { id: "add", label: "Add to selection (Shift)", icon: <UniteIcon /> },
  { id: "subtract", label: "Subtract from selection (Alt)", icon: <SubtractIcon /> },
  { id: "intersect", label: "Intersect with selection (Shift+Alt)", icon: <IntersectIcon /> },
]

function Toggle({
  on,
  onChange,
  children,
  title,
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        "h-7 shrink-0 rounded-lg px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        on && "bg-primary/35 text-foreground hover:bg-primary/35"
      )}
    >
      {children}
    </button>
  )
}

function SelectContext() {
  const s = useEngine()
  const label = "text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
  const value = "w-6 text-[11px] text-foreground tabular-nums"
  const sampleAll = (
    <Toggle
      on={s.sampleAll}
      onChange={(on) => engine.setSelectOptions({ sampleAll: on })}
      title="Judge colours from the whole picture rather than only the active layer"
    >
      All layers
    </Toggle>
  )
  return (
    <>
      <div className="flex items-center">
        {MODES.map((m) => (
          <IconButton
            key={m.id}
            label={m.label}
            className="size-7"
            active={s.selMode === m.id}
            onClick={() => engine.setSelectOptions({ selMode: m.id })}
          >
            {m.icon}
          </IconButton>
        ))}
      </div>
      <Divider />
      {s.tool === "select-wand" && (
        <>
          <span className={label}>Tolerance</span>
          <Slider
            label="Wand tolerance"
            className="w-20"
            min={0}
            max={255}
            exp={2}
            value={s.wandTolerance}
            onChange={(v) => engine.setSelectOptions({ wandTolerance: v })}
          />
          <span className={value}>{s.wandTolerance}</span>
          <Toggle
            on={s.wandContiguous}
            onChange={(on) => engine.setSelectOptions({ wandContiguous: on })}
            title="Select only the connected area, not every matching pixel"
          >
            Contiguous
          </Toggle>
          {sampleAll}
        </>
      )}
      {s.tool === "select-brush" && (
        <>
          <span className={label}>Size</span>
          <Slider
            label="Selection brush size"
            className="w-20"
            min={4}
            max={600}
            exp={2.4}
            value={s.selBrushSize}
            onChange={(v) => engine.setSelectOptions({ selBrushSize: v })}
          />
          <span className={value}>{s.selBrushSize}</span>
          <Toggle
            on={s.selBrushEdge}
            onChange={(on) => engine.setSelectOptions({ selBrushEdge: on })}
            title="Spread the selection up to nearby edges by following contrast"
          >
            Snap to edges
          </Toggle>
          {s.selBrushEdge && (
            <>
              <span className={label}>Contrast</span>
              <Slider
                label="Edge contrast tolerance"
                className="w-16"
                min={1}
                max={100}
                value={s.selBrushContrast}
                onChange={(v) => engine.setSelectOptions({ selBrushContrast: v })}
              />
              <span className={value}>{s.selBrushContrast}</span>
              {sampleAll}
            </>
          )}
        </>
      )}
      {s.tool !== "select-wand" && s.tool !== "select-brush" && (
        <>
          <span className={label}>Feather</span>
          <Slider
            label="Feather new selections"
            className="w-24"
            min={0}
            max={100}
            exp={2}
            value={s.selFeather}
            onChange={(v) => engine.setSelectOptions({ selFeather: Math.round(v) })}
          />
          <span className={value}>{s.selFeather}</span>
          <span className="hidden text-[11px] text-muted-foreground xl:inline">
            {SELECT_TOOL_INFO.find((t) => t.id === s.tool)?.hint}
          </span>
        </>
      )}
    </>
  )
}

function MenuItem({
  onClick,
  disabled,
  keys,
  checked,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  keys?: string
  /** Makes this a checkable item, ticked when true. */
  checked?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-full items-center gap-3 rounded-lg px-2 text-left text-xs text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
    >
      {checked !== undefined && (
        <CheckIcon weight="bold" className={cn("size-3.5 shrink-0", !checked && "invisible")} />
      )}
      <span className="flex-1 truncate">{children}</span>
      {keys && <span className="font-mono text-[10px] text-muted-foreground">{keys}</span>}
    </button>
  )
}

function SelectMenu({ onDone }: { onDone: () => void }) {
  const s = useEngine()
  const [amount, setAmount] = useState(8)
  const layer = s.layers.find((l) => l.id === s.activeLayerId)
  const has = s.hasSelection
  const heading = "px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
  const run = (fn: () => void) => () => {
    fn()
    onDone()
  }
  const modify = (kind: SelectModify, text: string) => (
    <button
      type="button"
      disabled={!has}
      onClick={() => engine.modifySelection(kind, amount)}
      className="h-7 flex-1 rounded-lg bg-black/25 text-[11px] text-foreground outline-none hover:bg-black/45 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
    >
      {text}
    </button>
  )
  return (
    <div role="menu" className="flex w-60 flex-col">
      <MenuItem keys="Ctrl A" onClick={run(() => engine.selectAll())}>Select all</MenuItem>
      <MenuItem keys="Ctrl D" disabled={!has} onClick={run(() => engine.deselect())}>Deselect</MenuItem>
      <MenuItem keys="Ctrl Shift D" disabled={has || !s.canReselect} onClick={run(() => engine.reselect())}>Reselect</MenuItem>
      <MenuItem keys="Ctrl Shift I" onClick={run(() => engine.invertSelection())}>Invert selection</MenuItem>
      <MenuItem disabled={!layer || !!layer.fx} onClick={run(() => engine.selectLayerPixels())}>
        Select layer contents
      </MenuItem>
      <MenuItem disabled={!layer?.mask} onClick={run(() => engine.selectFromMask(s.activeLayerId))}>
        Select from layer mask
      </MenuItem>

      <div className={heading}>Modify edge</div>
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <Slider label="Modify amount in pixels" className="flex-1" min={1} max={100} exp={2} value={amount} onChange={(v) => setAmount(Math.round(v))} />
        <span className="w-9 text-right text-[11px] text-foreground tabular-nums">{amount} px</span>
      </div>
      <div className="flex gap-1 px-2">
        {modify("feather", "Feather")}
        {modify("grow", "Grow")}
        {modify("shrink", "Shrink")}
        {modify("smooth", "Smooth")}
      </div>

      <div className={heading}>Selected pixels</div>
      <MenuItem keys="Del" disabled={!has} onClick={run(() => engine.clearSelection())}>Erase</MenuItem>
      <MenuItem disabled={!has} onClick={run(() => engine.fillSelection())}>Fill with colour</MenuItem>
      <MenuItem keys="Ctrl J" disabled={!has} onClick={run(() => engine.selectionToLayer(false))}>Copy to new layer</MenuItem>
      <MenuItem keys="Ctrl Shift J" disabled={!has} onClick={run(() => engine.selectionToLayer(true))}>Cut to new layer</MenuItem>

      <div className={heading}>Layer mask</div>
      <MenuItem disabled={!has || !layer || !!layer.mask} onClick={run(() => engine.addMask(s.activeLayerId, "selection"))}>
        Mask layer to selection
      </MenuItem>
      <MenuItem disabled={!has || !layer || !!layer.mask} onClick={run(() => engine.addMask(s.activeLayerId, "inverse"))}>
        Mask out selection
      </MenuItem>
    </div>
  )
}

const VIEW_PANELS: [ViewItem, string][] = [
  ["tools", "Tools"],
  ["color", "Colour"],
  ["options", "Brushes & tool options"],
  ["layers", "Layers"],
]

const VIEW_CONTROLS: [ViewItem, string][] = [
  ["context", "Tool settings bar"],
  ["viewControls", "Zoom & rotation controls"],
]

function ViewMenu({
  panelsOpen,
  onTogglePanels,
  onShowPanels,
  onDone,
}: {
  panelsOpen: boolean
  onTogglePanels: () => void
  onShowPanels: () => void
  onDone: () => void
}) {
  const s = useEngine()
  const { hidden } = useLayout()
  const heading = "px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
  const run = (fn: () => void) => () => {
    fn()
    onDone()
  }
  return (
    <div role="menu" className="flex w-60 flex-col">
      <div className={cn(heading, "pt-1")}>Panels</div>
      {VIEW_PANELS.map(([id, text]) => (
        <MenuItem
          key={id}
          checked={panelsOpen && !hidden[id]}
          onClick={() => {
            // Ticking a panel while everything is tucked away brings them back.
            if (!panelsOpen) {
              onShowPanels()
              if (!hidden[id]) return
            }
            layout.toggle(id)
          }}
        >
          {text}
        </MenuItem>
      ))}
      <MenuItem keys="Tab" onClick={run(onTogglePanels)}>
        {panelsOpen ? "Hide all panels" : "Show panels"}
      </MenuItem>

      <div className={heading}>Controls</div>
      {VIEW_CONTROLS.map(([id, text]) => (
        <MenuItem key={id} checked={!hidden[id]} onClick={() => layout.toggle(id)}>
          {text}
        </MenuItem>
      ))}

      <div className={heading}>Layout</div>
      <MenuItem
        onClick={run(() => {
          layout.reset()
          onShowPanels()
        })}
      >
        Reset panel layout
      </MenuItem>

      <div className={heading}>Canvas</div>
      <MenuItem keys="+" onClick={() => engine.zoomBy(1.25)}>Zoom in</MenuItem>
      <MenuItem keys="−" onClick={() => engine.zoomBy(0.8)}>Zoom out</MenuItem>
      <MenuItem onClick={run(() => engine.zoomBy(1 / s.zoom))}>Actual size (100%)</MenuItem>
      <MenuItem keys="F" onClick={run(() => engine.fit())}>Fit canvas</MenuItem>
      <MenuItem disabled={s.rotation === 0} onClick={run(() => engine.resetRotation())}>
        Reset rotation
      </MenuItem>
    </div>
  )
}

function ContextBar() {
  const s = useEngine()
  const label = "text-[10px] font-medium tracking-wide text-muted-foreground uppercase"

  const isVectorLayer = !!s.layers.find((l) => l.id === s.activeLayerId)?.vector

  if (isSelectTool(s.tool)) return <SelectContext />

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
  if (s.tool === "shape" || s.tool === "text" || (s.tool === "move" && isVectorLayer)) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {s.tool === "shape"
          ? "Drag to draw a shape · Shift constrains · drag handles to resize or rotate"
          : s.tool === "text"
            ? "Click to type · drag for a text box · click text to edit it · Esc to finish"
            : "Click an object to select · drag to move · double-click text to edit"}
      </span>
    )
  }
  if (s.tool === "distort") {
    return (
      <span className="text-[11px] text-muted-foreground">
        {s.distortDirty
          ? "Enter applies the distortion · Esc resets it"
          : "Drag on the layer to distort it · choose a mode in the panel"}
      </span>
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
          onClick={() => engine.clearSelection()}
          className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {s.hasSelection ? "Erase selection" : "Clear layer"}
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
  onShowPanels,
}: {
  panelsOpen: boolean
  onTogglePanels: () => void
  onShowPanels: () => void
}) {
  const s = useEngine()
  const { hidden } = useLayout()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<"new" | "keys" | "select" | "view" | null>(null)
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
        <IconButton label="New canvas" data-popover active={menu === "new"} onClick={() => setMenu(menu === "new" ? null : "new")}>
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
        <Divider />
        <button
          type="button"
          title="Selection menu"
          data-popover
          aria-haspopup="menu"
          aria-expanded={menu === "select"}
          onClick={() => setMenu(menu === "select" ? null : "select")}
          className={cn(
            "flex h-9 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]",
            (menu === "select" || s.hasSelection) && "text-foreground",
            menu === "select" && "bg-white/8"
          )}
        >
          <SelectionAllIcon />
          <span className="hidden sm:inline">Select</span>
          <CaretDownIcon className="!size-3 opacity-60" />
        </button>
        <button
          type="button"
          title="View menu"
          data-popover
          aria-haspopup="menu"
          aria-expanded={menu === "view"}
          onClick={() => setMenu(menu === "view" ? null : "view")}
          className={cn(
            "flex h-9 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]",
            menu === "view" && "bg-white/8 text-foreground"
          )}
        >
          <LayoutIcon />
          <span className="hidden sm:inline">View</span>
          <CaretDownIcon className="!size-3 opacity-60" />
        </button>
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
        <Popover open={menu === "select"} onClose={() => setMenu(null)} className="right-0 !p-1.5">
          <SelectMenu onDone={() => setMenu(null)} />
        </Popover>
        <Popover open={menu === "view"} onClose={() => setMenu(null)} className="right-0 !p-1.5">
          <ViewMenu
            panelsOpen={panelsOpen}
            onTogglePanels={onTogglePanels}
            onShowPanels={onShowPanels}
            onDone={() => setMenu(null)}
          />
        </Popover>
      </div>

      {!hidden.context && (
        <div className={cn(panelClass, "pointer-events-auto hidden h-12 items-center gap-2 px-3.5 md:flex")}>
          <ContextBar />
        </div>
      )}

      <div className={cn(panelClass, "pointer-events-auto relative flex h-12 items-center gap-0.5 px-2")}>
        {!hidden.viewControls && (
          <>
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
          </>
        )}
        <IconButton label="Keyboard shortcuts" data-popover active={menu === "keys"} onClick={() => setMenu(menu === "keys" ? null : "keys")}>
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
