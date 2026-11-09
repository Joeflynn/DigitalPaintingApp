import {
  ArrowsOutCardinalIcon,
  EraserIcon,
  EyedropperIcon,
  HandIcon,
  HandPointingIcon,
  PaintBrushIcon,
  PaintBucketIcon,
} from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { IconButton, Slider, panelClass } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "@/paint/brushes"
import { hsvToHex } from "@/paint/color"
import { engine, isPaintTool, type ToolId } from "@/paint/engine"

const TOOLS: { id: ToolId; label: string; icon: ReactNode }[] = [
  { id: "brush", label: "Brush (B)", icon: <PaintBrushIcon /> },
  { id: "smudge", label: "Smudge (S)", icon: <HandPointingIcon /> },
  { id: "eraser", label: "Eraser (E)", icon: <EraserIcon /> },
  { id: "fill", label: "Fill (G)", icon: <PaintBucketIcon /> },
  { id: "eyedropper", label: "Eyedropper (I, or hold Alt)", icon: <EyedropperIcon /> },
  { id: "move", label: "Move layer (V)", icon: <ArrowsOutCardinalIcon /> },
  { id: "hand", label: "Pan (H, or hold Space)", icon: <HandIcon /> },
]

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
