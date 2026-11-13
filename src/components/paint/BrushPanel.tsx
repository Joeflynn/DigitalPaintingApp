import { useMemo, useState } from "react"

import { Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import {
  BRUSHES,
  BRUSH_CATEGORIES,
  getBrush,
  type BrushCategory,
  type BrushPreset,
  type TipShape,
} from "@/paint/brushes"
import { engine, isPaintTool } from "@/paint/engine"
import { BrushPreview } from "./BrushPreview"

const TOOL_LABEL = {
  brush: "Brush",
  eraser: "Eraser",
  smudge: "Smudge",
} as const

type NumericKey = {
  [K in keyof BrushPreset]: BrushPreset[K] extends number ? K : never
}[keyof BrushPreset]

type Control = [key: NumericKey, label: string, min: number, max: number]

const GROUPS: { title: string; controls: Control[] }[] = [
  {
    title: "Paint",
    controls: [
      ["pickup", "Colour pickup", 0, 1],
      ["relief", "Thickness", 0, 1],
      ["depletion", "Runs dry", 0, 1],
      ["wetness", "Wet bleed", 0, 1],
      ["drip", "Drips", 0, 1],
      ["grain", "Paper tooth", 0, 1],
      ["grainScale", "Paper scale", 0.3, 4],
    ],
  },
  {
    title: "Tip",
    controls: [
      ["hardness", "Hardness", 0, 1],
      ["bristles", "Bristle count", 6, 80],
      ["roundness", "Roundness", 0.1, 1],
      ["angle", "Angle", -180, 180],
      ["flow", "Flow", 0.01, 1],
      ["spacing", "Spacing", 0.02, 1],
    ],
  },
  {
    title: "Dynamics",
    controls: [
      ["sizePressure", "Pressure → size", 0, 1],
      ["flowPressure", "Pressure → flow", 0, 1],
      ["pressureCurve", "Pressure curve", 0.25, 3],
      ["minSize", "Minimum size", 0.01, 1],
      ["scatter", "Scatter", 0, 1],
      ["sizeJitter", "Size jitter", 0, 0.95],
      ["flowJitter", "Flow jitter", 0, 1],
      ["angleJitter", "Rotation jitter", 0, 1],
    ],
  },
]

const TIP_LABEL: Record<TipShape, string> = {
  round: "Round",
  grain: "Graphite",
  bristle: "Bristle",
  splatter: "Splatter",
  chalk: "Chalk",
}

function format(key: NumericKey, value: number): string {
  if (key === "bristles" || key === "angle") return String(Math.round(value))
  return value.toFixed(2)
}

function BrushStudio({
  tool,
  active,
  dynamics,
}: {
  tool: "brush" | "eraser"
  active: BrushPreset
  dynamics: Partial<BrushPreset>
}) {
  const set = (patch: Partial<BrushPreset>) =>
    engine.setToolSettings(tool, { dynamics: { ...dynamics, ...patch } })
  const edited = Object.keys(dynamics).length > 0

  return (
    <details className="mb-2 rounded-xl bg-black/20 text-xs">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Brush studio
        {edited && (
          <span className="rounded-full bg-primary/40 px-1.5 py-0.5 text-[9px] font-medium">
            edited
          </span>
        )}
      </summary>
      <div className="px-3 pb-3">
        <div className="mb-2 overflow-hidden rounded-lg bg-black/30">
          <BrushPreview brush={active} />
        </div>
        <div className="mb-2 flex items-center gap-2">
          <select
            aria-label="Tip shape"
            value={active.tip}
            onChange={(e) => set({ tip: e.target.value as TipShape })}
            className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
          >
            {(Object.keys(TIP_LABEL) as TipShape[]).map((t) => (
              <option key={t} value={t} className="bg-neutral-900">
                {TIP_LABEL[t]} tip
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              className="accent-primary"
              checked={active.followDirection}
              onChange={(e) => set({ followDirection: e.target.checked })}
            />
            Follow stroke
          </label>
        </div>
        {GROUPS.map((group) => (
          <div key={group.title} className="mt-3">
            <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group.title}
            </div>
            {group.controls.map(([key, label, min, max]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">
                  {label}
                </span>
                <Slider
                  label={label}
                  className="min-w-0 flex-1"
                  min={min}
                  max={max}
                  value={active[key]}
                  onChange={(v) =>
                    set({
                      [key]:
                        key === "bristles" || key === "angle"
                          ? Math.round(v)
                          : Math.round(v * 100) / 100,
                    })
                  }
                />
                <span className="w-8 shrink-0 text-right text-[10.5px] text-foreground tabular-nums">
                  {format(key, active[key])}
                </span>
              </div>
            ))}
          </div>
        ))}
        <button
          type="button"
          disabled={!edited}
          onClick={() => engine.setToolSettings(tool, { dynamics: {} })}
          className="mt-3 h-7 w-full rounded-lg bg-white/8 text-[11px] font-medium text-foreground outline-none hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Reset to preset
        </button>
      </div>
    </details>
  )
}

export function BrushPanel() {
  const s = useEngine()
  const tool = isPaintTool(s.tool) ? s.tool : "brush"
  const settings = s.toolSettings[tool]
  const selected = settings.brushId
  const dynamics = settings.dynamics ?? {}
  const active = { ...getBrush(selected), ...dynamics }
  const [category, setCategory] = useState<BrushCategory | "All">("All")

  const list = useMemo(
    () => BRUSHES.filter((b) => category === "All" || b.category === category),
    [category]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          Brush Library
        </h2>
        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">
          for {TOOL_LABEL[tool]}
        </span>
      </div>
      <div className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-3 pb-2">
        {(["All", ...BRUSH_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              category === c && "bg-white/12 text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-2 pb-2">
        {tool !== "smudge" && (
          <BrushStudio tool={tool} active={active} dynamics={dynamics} />
        )}
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => engine.selectBrush(tool, b.id)}
            aria-pressed={b.id === selected}
            className={cn(
              "group relative mb-1 block w-full overflow-hidden rounded-xl border border-transparent bg-black/20 text-left outline-none hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-ring",
              b.id === selected &&
                "border-primary bg-primary/25 hover:bg-primary/25"
            )}
          >
            <BrushPreview brush={b} />
            <span className="absolute top-1 left-2 text-[10.5px] font-medium text-foreground/80">
              {b.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
