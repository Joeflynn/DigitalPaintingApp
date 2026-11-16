import {
  ArrowsOutCardinalIcon,
  EraserIcon,
  EyedropperIcon,
  HandIcon,
  HandPointingIcon,
  PaintBrushIcon,
  PaintBucketIcon,
} from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"

import { IconButton, Slider, panelClass, useDismiss } from "@/components/paint/controls"
import { SELECT_TOOL_INFO } from "@/components/paint/select-tools"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "@/paint/brushes"
import { hsvToHex } from "@/paint/color"
import { engine, isPaintTool, isSelectTool, type ToolId } from "@/paint/engine"

const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
  { id: "brush", label: "Brush (B)", icon: <PaintBrushIcon /> },
  { id: "smudge", label: "Smudge (S)", icon: <HandPointingIcon /> },
  { id: "eraser", label: "Eraser (E)", icon: <EraserIcon /> },
  { id: "fill", label: "Fill (G)", icon: <PaintBucketIcon /> },
  { id: "eyedropper", label: "Eyedropper (I, or hold Alt)", icon: <EyedropperIcon /> },
]

const VIEW_TOOLS: typeof TOOLS = [
  { id: "move", label: "Move layer or selection (V)", icon: <ArrowsOutCardinalIcon /> },
  { id: "hand", label: "Pan (H, or hold Space)", icon: <HandIcon /> },
]

/** One rail button for all the selection tools, with a flyout to pick one. */
function SelectButton() {
  const s = useEngine()
  const [open, setOpen] = useState(false)
  const active = isSelectTool(s.tool)
  useDismiss(open, () => setOpen(false))
  const current = SELECT_TOOL_INFO.find((t) => t.id === s.selectTool)!

  return (
    <div className="relative">
      <IconButton
        label={`${current.label} — click again for more selection tools`}
        active={active}
        aria-haspopup="menu"
        aria-expanded={open}
        data-popover
        onClick={() => {
          if (!active) engine.setTool(s.selectTool)
          setOpen(!open)
        }}
      >
        {current.icon}
        <span className="pointer-events-none absolute right-1 bottom-1 size-0 border-4 border-transparent border-r-current border-b-current opacity-70" />
      </IconButton>
      {open && (
        <>
          <div
            role="menu"
            data-popover
            className={cn(panelClass, "absolute top-1/2 left-full z-50 ml-3 flex -translate-y-1/2 gap-1 p-1.5")}
          >
            {SELECT_TOOL_INFO.map((t) => (
              <IconButton
                key={t.id}
                label={t.label}
                active={s.tool === t.id}
                onClick={() => {
                  engine.setTool(t.id)
                  setOpen(false)
                }}
              >
                {t.icon}
              </IconButton>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function ToolRail({ className }: { className?: string }) {
  const s = useEngine()
  const tool = isPaintTool(s.tool) ? s.tool : "brush"
  const settings = s.toolSettings[tool]

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className={cn(panelClass, "flex flex-col gap-1 p-1.5")}>
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            label={t.label}
            active={s.tool === t.id}
            onClick={() => engine.setTool(t.id)}
          >
            {t.icon}
          </IconButton>
        ))}
        <SelectButton />
        {VIEW_TOOLS.map((t) => (
          <IconButton
            key={t.id}
            label={t.label}
            active={s.tool === t.id}
            onClick={() => engine.setTool(t.id)}
          >
            {t.icon}
          </IconButton>
        ))}
      </div>

      <div className={cn(panelClass, "flex flex-col items-center gap-1.5 p-1.5")}>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Size
        </span>
        <Slider
          vertical
          label="Brush size"
          className="h-28"
          min={MIN_BRUSH_SIZE}
          max={MAX_BRUSH_SIZE}
          exp={2.4}
          value={settings.size}
          onChange={(v) => engine.setToolSettings(tool, { size: Math.round(v) })}
        />
        <span className="text-[11px] text-foreground tabular-nums">
          {Math.round(settings.size)}
        </span>
        <div className="my-0.5 h-px w-6 bg-white/10" />
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {tool === "smudge" ? "Str" : "Opac"}
        </span>
        <Slider
          vertical
          label={tool === "smudge" ? "Smudge strength" : "Brush opacity"}
          className="h-28"
          min={0.01}
          max={1}
          value={settings.opacity}
          onChange={(v) => engine.setToolSettings(tool, { opacity: v })}
        />
        <span className="text-[11px] text-foreground tabular-nums">
          {Math.round(settings.opacity * 100)}%
        </span>
      </div>

      <button
        type="button"
        title="Swap with previous colour (X)"
        aria-label="Swap with previous colour"
        onClick={() => engine.swapColors()}
        className={cn(panelClass, "relative size-12 outline-none focus-visible:ring-2 focus-visible:ring-ring")}
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
  )
}
