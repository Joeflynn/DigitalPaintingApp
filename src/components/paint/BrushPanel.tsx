import { useMemo, useState } from "react"

import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { BRUSHES, BRUSH_CATEGORIES, type BrushCategory } from "@/paint/brushes"
import { engine, isPaintTool } from "@/paint/engine"
import { brushPreview } from "@/paint/stroke"

const TOOL_LABEL = { brush: "Brush", eraser: "Eraser", smudge: "Smudge" } as const

export function BrushPanel() {
  const s = useEngine()
  const tool = isPaintTool(s.tool) ? s.tool : "brush"
  const selected = s.toolSettings[tool].brushId
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
      <div className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => engine.selectBrush(tool, b.id)}
            aria-pressed={b.id === selected}
            className={cn(
              "group relative mb-1 block w-full overflow-hidden rounded-xl border border-transparent bg-black/20 text-left outline-none hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-ring",
              b.id === selected && "border-primary bg-primary/25 hover:bg-primary/25"
            )}
          >
            <img
              src={brushPreview(b)}
              alt=""
              draggable={false}
              className="h-11 w-full object-contain opacity-90"
            />
            <span className="absolute top-1 left-2 text-[10.5px] font-medium text-foreground/80">
              {b.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
