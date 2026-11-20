import { useMemo, useState, useSyncExternalStore } from "react"
import { SlidersHorizontal } from "@phosphor-icons/react"

import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import {
  allBrushes,
  BRUSH_CATEGORIES,
  getBrush,
  maskBrush,
  subscribeBrushes,
  type BrushCategory,
  type BrushPreset,
} from "@/paint/brushes"
import { engine, isPaintTool } from "@/paint/engine"
import { BrushPreview } from "./BrushPreview"

const TOOL_LABEL = {
  brush: "Brush",
  eraser: "Eraser",
  smudge: "Smudge",
  fx: "Effect brush",
} as const

type Filter = BrushCategory | "All" | "Mine"

export function BrushPanel({ onOpenStudio }: { onOpenStudio: () => void }) {
  const s = useEngine()
  const brushes = useSyncExternalStore(subscribeBrushes, allBrushes)
  const tool = isPaintTool(s.tool) ? s.tool : "brush"
  const settings = s.toolSettings[tool]
  const selected = settings.brushId
  const dynamics = settings.dynamics ?? {}
  const active = { ...getBrush(selected), ...dynamics }
  const edited = Object.keys(dynamics).length > 0
  const [category, setCategory] = useState<Filter>("All")
  const hasCustom = brushes.some((b) => b.custom)

  const list = useMemo(
    () =>
      brushes.filter((b) =>
        category === "All"
          ? true
          : category === "Mine"
            ? b.custom
            : b.category === category
      ),
    [brushes, category]
  )
  // The effect brush paints a mask, so previews show the mark without pigment.
  const look = (b: BrushPreset) => (tool === "fx" ? maskBrush(b) : b)
  const filters: Filter[] = ["All", ...(hasCustom ? ["Mine" as const] : []), ...BRUSH_CATEGORIES]

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
        {filters.map((c) => (
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
        <button
          type="button"
          onClick={onOpenStudio}
          className="group mb-2 block w-full overflow-hidden rounded-xl bg-black/20 text-left outline-none hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrushPreview brush={look(active)} />
          <span className="flex items-center gap-1.5 px-3 pb-2 text-xs font-semibold">
            <SlidersHorizontal className="size-3.5" />
            Brush studio
            <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
              {active.name}
            </span>
            {edited && (
              <span className="rounded-full bg-primary/40 px-1.5 py-0.5 text-[9px] font-medium">
                edited
              </span>
            )}
          </span>
        </button>
        {list.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">
            No brushes here yet.
          </p>
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
            <BrushPreview brush={look(b)} />
            <span className="absolute top-1 left-2 text-[10.5px] font-medium text-foreground/80">
              {b.name}
              {b.custom && <span className="ml-1.5 text-primary-foreground/60">· mine</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
