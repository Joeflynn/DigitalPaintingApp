import {
  ArrowsOutCardinalIcon,
  DropIcon,
  EraserIcon,
  GradientIcon,
  GridNineIcon,
  HandPointingIcon,
  PaintBrushIcon,
  PaintBucketIcon,
  PerspectiveIcon,
  SelectionIcon,
  ShapesIcon,
  TargetIcon,
  TextTIcon,
} from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { IconButton, Slider } from "@/components/paint/controls"
import { SELECT_TOOL_INFO } from "@/components/paint/select-tools"
import { SHAPE_ICONS } from "@/components/paint/VectorPanel"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "@/paint/brushes"
import type { DistortMode } from "@/paint/distort"
import type { FillMode } from "@/paint/engine"
import {
  engine,
  isPaintTool,
  isSelectTool,
  selectedObject,
  type EngineState,
  type ToolId,
} from "@/paint/engine"
import { SHAPE_KINDS } from "@/paint/vector"

/**
 * The main tools, centred in the top bar. Several tools stand for a family:
 * the brush also covers effect brushes (picked in the brush library), select
 * covers every selection tool, and move covers the transform modes —
 * perspective, warp and liquify — whose choice sits in the side rail.
 */
const MAIN: { id: ToolId; label: string; icon: ReactNode; on: (t: ToolId) => boolean }[] = [
  { id: "brush", label: "Brush (B)", icon: <PaintBrushIcon />, on: (t) => t === "brush" || t === "fx" },
  { id: "smudge", label: "Smudge (S)", icon: <HandPointingIcon />, on: (t) => t === "smudge" },
  { id: "eraser", label: "Eraser (E)", icon: <EraserIcon />, on: (t) => t === "eraser" },
  { id: "fill", label: "Fill & gradient (G)", icon: <PaintBucketIcon />, on: (t) => t === "fill" },
  { id: "shape", label: "Shape (U)", icon: <ShapesIcon />, on: (t) => t === "shape" },
  { id: "text", label: "Text (T)", icon: <TextTIcon />, on: (t) => t === "text" },
  { id: "select-rect", label: "Select (A, L, P, Q, W)", icon: <SelectionIcon />, on: isSelectTool },
  {
    id: "move",
    label: "Move & transform — perspective, warp, liquify (V, D)",
    icon: <ArrowsOutCardinalIcon />,
    on: (t) => t === "move" || t === "distort",
  },
]

export function MainTools() {
  const s = useEngine()
  return (
    <div className="flex items-center gap-1">
      {MAIN.map((t) => (
        <IconButton
          key={t.id}
          label={t.label}
          active={t.on(s.tool)}
          onClick={() => {
            // Brush while painting an effect goes back to the plain brush.
            if (t.on(s.tool) && !(t.id === "brush" && s.tool === "fx")) return
            // Return to the selection tool last used rather than always the rectangle.
            engine.setTool(t.id === "select-rect" ? s.selectTool : t.id)
          }}
        >
          {t.icon}
        </IconButton>
      ))}
    </div>
  )
}

const TRANSFORM: { mode: DistortMode | null; label: string; icon: ReactNode }[] = [
  { mode: null, label: "Move (V)", icon: <ArrowsOutCardinalIcon /> },
  { mode: "perspective", label: "Perspective", icon: <PerspectiveIcon /> },
  { mode: "warp", label: "Warp (D)", icon: <GridNineIcon /> },
  { mode: "liquify", label: "Liquify", icon: <DropIcon /> },
]

const FILL: { mode: FillMode; label: string; icon: ReactNode }[] = [
  { mode: "bucket", label: "Fill bucket — click an area", icon: <PaintBucketIcon /> },
  { mode: "linear", label: "Linear gradient — drag from start to end (Shift snaps)", icon: <GradientIcon /> },
  { mode: "radial", label: "Radial gradient — drag from the centre outwards", icon: <TargetIcon /> },
]

/** Whether the active tool has anything to show in the side rail. */
export function hasRail(s: EngineState) {
  return (
    isPaintTool(s.tool) ||
    s.tool === "fill" ||
    isSelectTool(s.tool) ||
    s.tool === "shape" ||
    s.tool === "move" ||
    s.tool === "distort"
  )
}

/** Which options panel the active tool has, if any. */
export function optionsKind(s: EngineState): "brush" | "object" | "distort" | null {
  if (s.tool === "distort") return "distort"
  if (s.tool === "shape" || s.tool === "text" || selectedObject(s)) return "object"
  if (isPaintTool(s.tool)) return "brush"
  return null
}

/** Height of each size/opacity slider: tall when there is room, shorter on small windows. */
const sliderHeight = "h-[clamp(96px,calc((100svh-280px)/2),280px)]"

/**
 * The contextual side rail: brush size and opacity for the painting tools,
 * otherwise the variants of the active tool.
 */
export function ToolRail({ className }: { className?: string }) {
  const s = useEngine()
  const tool = s.tool
  const wrap = cn("flex flex-col items-center gap-1.5 p-1.5 pt-1", className)

  if (isPaintTool(tool)) {
    const settings = s.toolSettings[tool]
    const strength = tool === "smudge" || tool === "fx"
    return (
      <div className={wrap}>
        <Slider
          vertical
          label={`Brush size: ${Math.round(settings.size)} px`}
          className={sliderHeight}
          min={MIN_BRUSH_SIZE}
          max={MAX_BRUSH_SIZE}
          exp={2.4}
          value={settings.size}
          onChange={(v) => engine.setToolSettings(tool, { size: Math.round(v) })}
        />
        <div className="py-1.5">
          <div className="h-px w-6 bg-white/10" />
        </div>
        <Slider
          vertical
          label={`${strength ? (tool === "fx" ? "Effect strength" : "Smudge strength") : "Brush opacity"}: ${Math.round(settings.opacity * 100)}%`}
          className={sliderHeight}
          min={0.01}
          max={1}
          value={settings.opacity}
          onChange={(v) => engine.setToolSettings(tool, { opacity: v })}
        />
      </div>
    )
  }

  if (isSelectTool(tool)) {
    return (
      <div className={wrap}>
        {SELECT_TOOL_INFO.map((t) => (
          <IconButton key={t.id} soft label={t.label} active={tool === t.id} onClick={() => engine.setTool(t.id)}>
            {t.icon}
          </IconButton>
        ))}
      </div>
    )
  }

  if (tool === "fill") {
    return (
      <div className={wrap}>
        {FILL.map((f) => (
          <IconButton
            key={f.mode}
            soft
            label={f.label}
            active={s.fillMode === f.mode}
            onClick={() => engine.setFillOptions({ fillMode: f.mode })}
          >
            {f.icon}
          </IconButton>
        ))}
      </div>
    )
  }

  if (tool === "shape") {
    const kind = s.shapeStyle.shape
    return (
      <div className={wrap}>
        {SHAPE_KINDS.map((k) => (
          <IconButton key={k.id} soft label={k.label} active={kind === k.id} onClick={() => engine.setShapeKind(k.id)}>
            {SHAPE_ICONS[k.id]}
          </IconButton>
        ))}
      </div>
    )
  }

  if (tool === "move" || tool === "distort") {
    return (
      <div className={wrap}>
        {TRANSFORM.map((t) => {
          const on = t.mode === null ? tool === "move" : tool === "distort" && s.distortMode === t.mode
          return (
            <IconButton
              key={t.label}
              soft
              label={t.label}
              active={on}
              onClick={() => {
                if (on) return
                if (t.mode === null) return engine.setTool("move")
                // Set the mode first so entering the tool builds the right mesh.
                engine.setDistortOptions({ distortMode: t.mode })
                engine.setTool("distort")
              }}
            >
              {t.icon}
            </IconButton>
          )
        })}
      </div>
    )
  }

  return null
}
