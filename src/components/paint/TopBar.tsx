import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInIcon,
  ArrowsOutIcon,
  CaretDownIcon,
  CheckIcon,
  CompassToolIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  IntersectIcon,
  KeyboardIcon,
  MinusIcon,
  PlusIcon,
  SelectionIcon,
  SquaresFourIcon,
  StackIcon,
  SubtractIcon,
  UniteIcon,
} from "@phosphor-icons/react"
import { useRef, useState } from "react"
import type { ReactNode } from "react"

import brushPanelIcon from "@/assets/icons/brush-panel.svg"
import {
  IconButton,
  MaskIcon,
  Slider,
  captionClass,
  dropdownTriggerClass,
  panelClass,
  useDismiss,
} from "@/components/paint/controls"
import { layout, useLayout, type PanelId, type ViewItem } from "@/components/paint/layout"
import { SELECT_TOOL_INFO } from "@/components/paint/select-tools"
import { MainTools, optionsKind } from "@/components/paint/ToolRail"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { hsvToHex } from "@/paint/color"
import { importImages } from "@/paint/palettes"
import {
  engine,
  fxChoiceLabel,
  isPaintTool,
  isSelectTool,
  selectedObject,
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
  ["K", "Effect brush"],
  ["G / I", "Fill & gradient, eyedropper"],
  ["Shift + drag gradient", "Snap the angle to 45°"],
  ["V / D", "Move, warp"],
  ["U / T", "Shape, text"],
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
  ["Space or middle-drag", "Pan"],
  ["Two fingers", "Pan (touch or touchpad)"],
  ["Scroll wheel / pinch", "Zoom"],
  ["R + drag / Shift + scroll", "Rotate canvas"],
  ["F", "Fit canvas"],
  ["M", "Symmetry on / off"],
  ["Ctrl Z / Ctrl Shift Z", "Undo / redo"],
  ["Tab", "Hide or show the interface"],
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

export function NewCanvasMenu({ onDone }: { onDone: () => void }) {
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
        Starts a new painting. Everything else stays in the gallery.
      </p>
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          void engine.createProject(Math.round(w), Math.round(h))
          onDone()
        }}
        className="h-8 rounded-lg bg-primary text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        Create canvas
      </button>
    </div>
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
  ["tools", "Tool rail"],
  ["color", "Colour"],
  ["options", "Brushes & tool options"],
  ["layers", "Layers"],
  ["aids", "Drawing aids"],
]

const VIEW_CONTROLS: [ViewItem, string][] = [
  ["context", "Quick options bar"],
  ["viewControls", "Zoom controls"],
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
        {panelsOpen ? "Hide interface" : "Show interface"}
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
        "h-7 shrink-0 rounded-[10px] px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        on && "bg-primary/25 text-foreground hover:bg-primary/35"
      )}
    >
      {children}
    </button>
  )
}

/** A dropdown trigger showing a value, opening a slider to change it. */
function ValueDropdown({
  label,
  value,
  text,
  min,
  max,
  exp,
  onChange,
  children,
}: {
  label: string
  value: number
  text: string
  min: number
  max: number
  exp?: number
  onChange: (v: number) => void
  /** Further options shown under the slider. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  useDismiss(open, () => setOpen(false))
  return (
    <div className="relative">
      <button
        type="button"
        data-popover
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(!open)}
        className={dropdownTriggerClass}
      >
        <span className="tabular-nums">{text}</span>
        <CaretDownIcon className="size-3 opacity-70" />
      </button>
      {open && (
        <div data-popover className={cn(panelClass, "absolute top-full right-0 z-50 mt-3 flex w-56 flex-col gap-2 p-3")}>
          <div className="flex items-center gap-2">
            <Slider label={label} className="flex-1" min={min} max={max} exp={exp} value={value} onChange={onChange} />
            <span className="w-10 text-right text-[11px] text-foreground tabular-nums">{text}</span>
          </div>
          {children && <div className="flex flex-wrap gap-1">{children}</div>}
        </div>
      )}
    </div>
  )
}

const MODES: { id: SelectMode; label: string; short: string; icon: ReactNode }[] = [
  { id: "replace", label: "New selection", short: "New", icon: <SelectionIcon /> },
  { id: "add", label: "Add to selection (Shift)", short: "Add", icon: <UniteIcon /> },
  { id: "subtract", label: "Subtract from selection (Alt)", short: "Subtract", icon: <SubtractIcon /> },
  { id: "intersect", label: "Intersect with selection (Shift+Alt)", short: "Intersect", icon: <IntersectIcon /> },
]

function ModeDropdown() {
  const s = useEngine()
  const [open, setOpen] = useState(false)
  useDismiss(open, () => setOpen(false))
  const current = MODES.find((m) => m.id === s.selMode) ?? MODES[0]
  return (
    <div className="relative">
      <button
        type="button"
        data-popover
        aria-haspopup="menu"
        aria-expanded={open}
        title="How a new selection combines with the current one"
        onClick={() => setOpen(!open)}
        className={dropdownTriggerClass}
      >
        {current.short}
        <CaretDownIcon className="size-3 opacity-70" />
      </button>
      {open && (
        <div role="menu" data-popover className={cn(panelClass, "absolute top-full right-0 z-50 mt-3 w-60 p-1.5")}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.selMode === m.id}
              onClick={() => {
                engine.setSelectOptions({ selMode: m.id })
                setOpen(false)
              }}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
            >
              <span className="text-muted-foreground">{m.icon}</span>
              <span className="flex-1">{m.label}</span>
              {s.selMode === m.id && <CheckIcon weight="bold" className="!size-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Captions give way first when the top bar runs short of room. */
const tightCaption = cn(captionClass, "hidden min-[1440px]:inline")

function SelectContext() {
  const s = useEngine()
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
      <span className={tightCaption}>Mode</span>
      <ModeDropdown />
      <Divider />
      {s.tool === "select-wand" && (
        <>
          <span className={tightCaption}>Tolerance</span>
          <ValueDropdown
            label="Wand tolerance"
            min={0}
            max={255}
            exp={2}
            value={s.wandTolerance}
            text={String(s.wandTolerance)}
            onChange={(v) => engine.setSelectOptions({ wandTolerance: v })}
          >
            <Toggle
              on={s.wandContiguous}
              onChange={(on) => engine.setSelectOptions({ wandContiguous: on })}
              title="Select only the connected area, not every matching pixel"
            >
              Contiguous
            </Toggle>
            {sampleAll}
          </ValueDropdown>
        </>
      )}
      {s.tool === "select-brush" && (
        <>
          <span className={tightCaption}>Size</span>
          <ValueDropdown
            label="Selection brush size"
            min={4}
            max={600}
            exp={2.4}
            value={s.selBrushSize}
            text={`${s.selBrushSize} px`}
            onChange={(v) => engine.setSelectOptions({ selBrushSize: v })}
          >
            <Toggle
              on={s.selBrushEdge}
              onChange={(on) => engine.setSelectOptions({ selBrushEdge: on })}
              title="Spread the selection up to nearby edges by following contrast"
            >
              Snap to edges
            </Toggle>
            {s.selBrushEdge && sampleAll}
            {s.selBrushEdge && (
              <div className="flex w-full items-center gap-2 pt-1">
                <span className={captionClass}>Contrast</span>
                <Slider
                  label="Edge contrast tolerance"
                  className="flex-1"
                  min={1}
                  max={100}
                  value={s.selBrushContrast}
                  onChange={(v) => engine.setSelectOptions({ selBrushContrast: v })}
                />
                <span className="w-8 text-right text-[11px] text-foreground tabular-nums">{s.selBrushContrast}%</span>
              </div>
            )}
          </ValueDropdown>
        </>
      )}
      {s.tool !== "select-wand" && s.tool !== "select-brush" && (
        <>
          <span className={tightCaption} title={SELECT_TOOL_INFO.find((t) => t.id === s.tool)?.hint}>
            Feather
          </span>
          <ValueDropdown
            label="Feather new selections"
            min={0}
            max={100}
            exp={2}
            value={s.selFeather}
            text={`${s.selFeather} px`}
            onChange={(v) => engine.setSelectOptions({ selFeather: Math.round(v) })}
          />
        </>
      )}
    </>
  )
}

/** Effect brush: reveal or hide the effect chosen in the brush library. */
function EffectBrushContext() {
  const s = useEngine()
  const group = s.layers.length ? engine.effectGroup() : null
  const mode = (hide: boolean, text: string, title: string) => (
    <button
      type="button"
      title={title}
      aria-pressed={s.fxHide === hide}
      onClick={() => engine.setFxHide(hide)}
      className={cn(
        "h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        s.fxHide === hide && "bg-white/15 text-foreground"
      )}
    >
      {text}
    </button>
  )
  return (
    <>
      <Divider />
      <div
        role="group"
        aria-label="Effect brush mode"
        title={`${group ? group.name : fxChoiceLabel(s.fxChoice)}: ${group ? "painting this group's mask" : "the first stroke adds an effect group"}`}
        className="flex shrink-0 items-center rounded-[10px] bg-black/30 p-0.5"
      >
        {mode(false, "Reveal", "Paint the effect in")}
        {mode(true, "Hide", "Paint the effect back out")}
      </div>
    </>
  )
}

const OPTIONS_LABEL = { brush: "brush library", object: "object options", distort: "transform options" } as const

/**
 * Quick options for the active tool. Each tool shows only what it needs;
 * tools with a fuller options panel end with the button that toggles it.
 */
function ContextBar({ togglePanel, panelOpen }: { togglePanel: (id: PanelId) => void; panelOpen: (id: PanelId) => boolean }) {
  const s = useEngine()
  const kind = optionsKind(s)
  const hint = "text-[11px] text-muted-foreground whitespace-nowrap"
  const optionsButton = kind && (
    <IconButton
      soft
      label={`${panelOpen("options") ? "Hide" : "Show"} the ${OPTIONS_LABEL[kind]}`}
      className="size-7 rounded-md"
      active={panelOpen("options")}
      onClick={() => togglePanel("options")}
    >
      <MaskIcon src={brushPanelIcon} />
    </IconButton>
  )

  let body: ReactNode = null
  if (isSelectTool(s.tool)) {
    body = <SelectContext />
  } else if (isPaintTool(s.tool)) {
    const tool = s.tool
    const settings = s.toolSettings[tool]
    body = (
      <>
        <div className="flex w-32 shrink-0 items-center gap-2 px-2 min-[1440px]:w-[206px]">
          <span className={tightCaption}>Stabilise</span>
          <Slider
            label="Stroke stabilisation"
            className="min-w-0 flex-1"
            min={0}
            max={1}
            value={settings.streamline}
            onChange={(v) => engine.setToolSettings(tool, { streamline: v })}
          />
          <span className="w-5 text-center text-[10px] leading-[14px] text-muted-foreground tabular-nums">
            {Math.round(settings.streamline * 100)}
          </span>
        </div>
        {tool === "fx" && <EffectBrushContext />}
      </>
    )
  } else if (s.tool === "fill" && s.fillMode !== "bucket") {
    const end = (value: "previous" | "transparent", content: ReactNode, title: string) => (
      <button
        type="button"
        title={title}
        aria-pressed={s.gradientEnd === value}
        onClick={() => engine.setFillOptions({ gradientEnd: value })}
        className={cn(
          "flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          s.gradientEnd === value && "bg-white/15 text-foreground"
        )}
      >
        {content}
      </button>
    )
    body = (
      <>
        <span className={tightCaption}>{s.fillMode === "radial" ? "Radial" : "Linear"}</span>
        <span
          title="Starts with the current colour"
          className="size-5 shrink-0 rounded-full border border-white/25"
          style={{ background: hsvToHex(s.color) }}
        />
        <span className="text-[11px] text-muted-foreground">to</span>
        <div className="flex shrink-0 items-center rounded-[10px] bg-black/30 p-0.5" role="group" aria-label="Gradient end">
          {end(
            "previous",
            <>
              <span className="size-3 rounded-full border border-white/25" style={{ background: hsvToHex(s.prevColor) }} />
              Previous
            </>,
            "Fade to the previous colour (X swaps them)"
          )}
          {end("transparent", "Transparent", "Fade out to nothing")}
        </div>
      </>
    )
  } else if (s.tool === "fill") {
    body = (
      <>
        <span className={tightCaption}>Tolerance</span>
        <Slider
          label="Fill tolerance"
          className="w-28"
          min={0}
          max={255}
          value={s.fillTolerance}
          onChange={(v) => engine.setFillTolerance(v)}
        />
        <span className="w-6 text-[10px] text-muted-foreground tabular-nums">{s.fillTolerance}</span>
      </>
    )
  } else if (selectedObject(s)) {
    body = (
      <>
        <span className={captionClass}>Object</span>
        <IconButton label="Bring forward" className="size-7" onClick={() => engine.orderObject(1)}>
          <ArrowUpIcon />
        </IconButton>
        <IconButton label="Send backward" className="size-7" onClick={() => engine.orderObject(-1)}>
          <ArrowDownIcon />
        </IconButton>
        <IconButton label="Duplicate object" className="size-7" onClick={() => engine.duplicateObject()}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Delete object (Backspace)" className="size-7" onClick={() => engine.deleteObject()}>
          <TrashIcon />
        </IconButton>
      </>
    )
  } else if (s.tool === "shape" || s.tool === "text" || kind === "object") {
    body = (
      <span className={hint}>
        {s.tool === "shape"
          ? "Drag to draw · Shift constrains"
          : s.tool === "text"
            ? "Click to type · drag for a text box"
            : "Drag to move · double-click text to edit"}
      </span>
    )
  } else if (s.tool === "distort") {
    body = (
      <>
        <span className={hint}>{s.distortDirty ? "Enter applies · Esc resets" : "Drag on the layer to transform it"}</span>
        {s.distortDirty && (
          <>
            <button
              type="button"
              onClick={() => engine.resetDistort()}
              className="h-7 rounded-[10px] px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => engine.applyDistort()}
              className="h-7 rounded-[10px] bg-primary px-2.5 text-[11px] font-medium text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Apply
            </button>
          </>
        )}
      </>
    )
  } else if (s.tool === "move") {
    body = (
      <>
        <span className={captionClass}>Layer</span>
        <IconButton label="Flip layer horizontally" className="size-7" onClick={() => engine.flipLayer(s.activeLayerId, "h")}>
          <FlipHorizontalIcon />
        </IconButton>
        <IconButton label="Flip layer vertically" className="size-7" onClick={() => engine.flipLayer(s.activeLayerId, "v")}>
          <FlipVerticalIcon />
        </IconButton>
        <button
          type="button"
          onClick={() => engine.clearSelection()}
          className="h-7 rounded-[10px] px-2 text-[11px] whitespace-nowrap text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {s.hasSelection ? "Erase selection" : "Clear layer"}
        </button>
      </>
    )
  } else if (s.tool === "eyedropper") {
    body = <span className={hint}>Click the canvas to pick a colour</span>
  }

  if (!body && !optionsButton) return null
  return (
    <div className={cn(panelClass, "pointer-events-auto flex h-12 shrink items-center gap-2 px-3.5", optionsButton && "pr-2.5")}>
      {body}
      {optionsButton}
    </div>
  )
}

function MenuTrigger({
  open,
  highlight,
  onClick,
  children,
}: {
  open: boolean
  highlight?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-popover
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1 rounded-xl px-2 text-xs text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        (open || highlight) && "text-foreground",
        open && "bg-white/8"
      )}
    >
      {children}
      <CaretDownIcon className="size-3 opacity-70" />
    </button>
  )
}

type Menu = "file" | "new" | "keys" | "select" | "view" | null

export function TopBar({
  panelsOpen,
  onTogglePanels,
  onShowPanels,
  onOpenGallery,
}: {
  panelsOpen: boolean
  onTogglePanels: () => void
  onShowPanels: () => void
  onOpenGallery: () => void
}) {
  const s = useEngine()
  const { hidden } = useLayout()
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<Menu>(null)
  const flip = (m: Menu) => setMenu(menu === m ? null : m)

  const panelOpen = (id: PanelId) => panelsOpen && !hidden[id]
  /** Shows or hides one panel, bringing the rest back if they were tucked away. */
  const togglePanel = (id: PanelId) => {
    if (panelOpen(id)) return layout.toggle(id)
    if (hidden[id]) layout.toggle(id)
    onShowPanels()
  }

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

  const importImage = (file: File | undefined) => {
    if (file) void importImages([file], (f, name) => engine.importImage(f, name))
  }

  const side = "flex items-center gap-3"

  // The tools stay centred while both sides fit; a crowded side pushes them over.
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 grid grid-cols-[minmax(max-content,1fr)_auto_minmax(min-content,1fr)] items-start gap-3">
      <div className={side}>
        <div className={cn(panelClass, "pointer-events-auto relative flex h-12 shrink-0 items-center gap-1 px-2")}>
          <IconButton label="Gallery" className="w-auto px-2" onClick={onOpenGallery}>
            <SquaresFourIcon />
          </IconButton>
          <Divider />
          <MenuTrigger open={menu === "file" || menu === "new"} onClick={() => flip("file")}>
            File
          </MenuTrigger>
          <MenuTrigger open={menu === "select"} highlight={s.hasSelection} onClick={() => flip("select")}>
            Select
          </MenuTrigger>
          <MenuTrigger open={menu === "view"} onClick={() => flip("view")}>
            View
          </MenuTrigger>
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
          <Popover open={menu === "file"} onClose={() => setMenu(null)} className="left-0 !p-1.5">
            <div role="menu" className="flex w-52 flex-col">
              <MenuItem onClick={() => setMenu("new")}>New canvas…</MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  fileRef.current?.click()
                }}
              >
                Import image as layer…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  void exportPng()
                }}
              >
                Export PNG
              </MenuItem>
            </div>
          </Popover>
          <Popover open={menu === "new"} onClose={() => setMenu(null)} className="left-0">
            <NewCanvasMenu onDone={() => setMenu(null)} />
          </Popover>
          <Popover open={menu === "select"} onClose={() => setMenu(null)} className="left-0 !p-1.5">
            <SelectMenu onDone={() => setMenu(null)} />
          </Popover>
          <Popover open={menu === "view"} onClose={() => setMenu(null)} className="left-0 !p-1.5">
            <ViewMenu
              panelsOpen={panelsOpen}
              onTogglePanels={onTogglePanels}
              onShowPanels={onShowPanels}
              onDone={() => setMenu(null)}
            />
          </Popover>
        </div>

        <div className={cn(panelClass, "pointer-events-auto flex h-12 shrink-0 items-center gap-2 px-2")}>
          <IconButton label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => engine.undo()}>
            <ArrowCounterClockwiseIcon />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => engine.redo()}>
            <ArrowClockwiseIcon />
          </IconButton>
        </div>
      </div>

      <div className={cn(panelClass, "pointer-events-auto flex shrink-0 items-center px-1.5 py-1")}>
        <MainTools />
      </div>

      <div className={cn(side, "justify-end")}>
        {!hidden.context && (
          <div className="hidden lg:contents">
            <ContextBar togglePanel={togglePanel} panelOpen={panelOpen} />
          </div>
        )}

        <div className={cn(panelClass, "pointer-events-auto relative flex h-12 shrink-0 items-center gap-2.5 px-2")}>
          <IconButton
            soft
            label="Drawing aids — symmetry, guides, 3D reference"
            active={panelOpen("aids")}
            onClick={() => togglePanel("aids")}
          >
            <CompassToolIcon />
          </IconButton>
          <IconButton soft label="Keyboard shortcuts" data-popover active={menu === "keys"} onClick={() => flip("keys")}>
            <KeyboardIcon />
          </IconButton>
          <IconButton
            soft
            label={`${panelOpen("layers") ? "Hide" : "Show"} layers`}
            className="rounded-md"
            active={panelOpen("layers")}
            onClick={() => togglePanel("layers")}
          >
            <StackIcon />
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

        <button
          type="button"
          title="Colour panel (X swaps with the previous colour)"
          aria-label={`${panelOpen("color") ? "Hide" : "Show"} the colour panel`}
          aria-pressed={panelOpen("color")}
          onClick={() => togglePanel("color")}
          className={cn(panelClass, "pointer-events-auto relative size-12 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          <span
            className="absolute right-2 bottom-2 size-5 rounded-full border border-white/25"
            style={{ background: hsvToHex(s.prevColor) }}
          />
          <span
            className="absolute top-2 left-2 size-6 rounded-full border-2 border-white/80 shadow-md"
            style={{ background: hsvToHex(s.color) }}
          />
        </button>
      </div>
    </div>
  )
}

/**
 * The bottom-left corner: the show/hide interface toggle, then zoom. With the
 * interface hidden only the toggle remains.
 */
export function ZoomBar({
  uiVisible,
  showZoom,
  onToggleUi,
}: {
  uiVisible: boolean
  showZoom: boolean
  onToggleUi: () => void
}) {
  const s = useEngine()
  const toggle = (
    <IconButton
      label={uiVisible ? "Hide interface (Tab)" : "Show interface (Tab)"}
      aria-pressed={!uiVisible}
      onClick={onToggleUi}
    >
      {uiVisible ? <ArrowsInIcon /> : <ArrowsOutIcon />}
    </IconButton>
  )
  if (!uiVisible || !showZoom) {
    return <div className={cn(panelClass, "absolute bottom-3 left-3 z-30 flex h-12 items-center px-1")}>{toggle}</div>
  }
  return (
    <div className={cn(panelClass, "absolute bottom-3 left-3 z-30 flex h-12 items-center gap-0.5 px-1")}>
      {toggle}
      <Divider />
      <IconButton label="Zoom out (−)" onClick={() => engine.zoomBy(0.8)}>
        <MinusIcon />
      </IconButton>
      <button
        type="button"
        title="Zoom to 100%"
        onClick={() => engine.zoomBy(1 / s.zoom)}
        className="h-9 w-11 rounded-xl text-center text-[11px] text-foreground tabular-nums outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {Math.round(s.zoom * 100)}%
      </button>
      <IconButton label="Zoom in (+)" onClick={() => engine.zoomBy(1.25)}>
        <PlusIcon />
      </IconButton>
    </div>
  )
}
