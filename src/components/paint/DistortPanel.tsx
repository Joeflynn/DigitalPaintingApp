import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  ClockCounterClockwiseIcon,
  GridFourIcon,
  HandGrabbingIcon,
} from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { IconButton, Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import type { DistortMode, LiquifyTool } from "@/paint/distort"
import { engine } from "@/paint/engine"

const MODES: { id: DistortMode; label: string; hint: string }[] = [
  { id: "warp", label: "Warp", hint: "Drag the grid's points to bend the layer. Dragging anywhere pulls the nearest point." },
  { id: "perspective", label: "Perspective", hint: "Drag the four corners to tilt the layer in space." },
  { id: "liquify", label: "Liquify", hint: "Brush over the layer to push it around. Hold still with twirl, pinch or bloat to keep going." },
]

const LIQUIFY: { id: LiquifyTool; label: string; icon: ReactNode }[] = [
  { id: "push", label: "Push", icon: <HandGrabbingIcon /> },
  { id: "twirl-cw", label: "Twirl clockwise", icon: <ArrowClockwiseIcon /> },
  { id: "twirl-ccw", label: "Twirl anticlockwise", icon: <ArrowCounterClockwiseIcon /> },
  { id: "pinch", label: "Pinch", icon: <ArrowsInSimpleIcon /> },
  { id: "bloat", label: "Bloat", icon: <ArrowsOutSimpleIcon /> },
  { id: "restore", label: "Restore — brush the distortion away", icon: <ClockCounterClockwiseIcon /> },
]

const GRIDS = [1, 2, 3, 4, 5]

const labelClass = "w-14 shrink-0 truncate text-[10px] text-muted-foreground uppercase"
const pill =
  "h-7 flex-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
const action =
  "h-8 flex-1 rounded-lg text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"

/** Options for the distort tool: its mode, that mode's settings, and apply/reset. */
export function DistortPanel() {
  const s = useEngine()
  const set = engine.setDistortOptions.bind(engine)
  const layer = s.layers.find((l) => l.id === s.activeLayerId)
  const mode = MODES.find((m) => m.id === s.distortMode)!

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5">
        <h2 className="mr-auto text-xs font-semibold tracking-wide text-foreground uppercase">
          Transform
        </h2>
        <span className="max-w-32 truncate rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">
          {layer?.name}
        </span>
        <IconButton
          label={s.distortGrid ? "Hide grid" : "Show grid"}
          className="size-7"
          active={s.distortGrid}
          onClick={() => set({ distortGrid: !s.distortGrid })}
        >
          <GridFourIcon />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
        <div className="flex gap-0.5 rounded-xl bg-black/25 p-0.5" role="group" aria-label="Distortion mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={s.distortMode === m.id}
              onClick={() => set({ distortMode: m.id })}
              className={cn(pill, s.distortMode === m.id && "bg-primary text-primary-foreground hover:text-primary-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>

        {!s.distortActive ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {layer?.vector
              ? "Vector layers must be rasterised before they can be distorted."
              : "Select a paint layer to distort."}
          </p>
        ) : (
          <>
            {s.distortMode === "warp" && (
              <div className="flex items-center gap-2">
                <span className={labelClass}>Grid</span>
                <div className="flex flex-1 gap-0.5 rounded-lg bg-black/25 p-0.5" role="group" aria-label="Warp grid">
                  {GRIDS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      title={n === 1 ? "Four corners" : `${n} × ${n} cells`}
                      aria-pressed={s.warpGrid === n}
                      onClick={() => set({ warpGrid: n })}
                      className={cn(pill, "h-6 px-0 tabular-nums", s.warpGrid === n && "bg-white/15 text-foreground")}
                    >
                      {n}×{n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {s.distortMode === "liquify" && (
              <>
                <div className="flex gap-0.5 rounded-xl bg-black/25 p-0.5" role="group" aria-label="Liquify brush">
                  {LIQUIFY.map((t) => (
                    <IconButton
                      key={t.id}
                      label={t.label}
                      className="h-7 flex-1 rounded-lg"
                      active={s.liqTool === t.id}
                      onClick={() => set({ liqTool: t.id })}
                    >
                      {t.icon}
                    </IconButton>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className={labelClass}>Size</span>
                  <Slider label="Liquify brush size" className="flex-1" min={20} max={1200} exp={2} value={s.liqSize} onChange={(v) => set({ liqSize: v })} />
                  <span className="w-8 text-right text-[10px] text-muted-foreground tabular-nums">{s.liqSize}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={labelClass}>Strength</span>
                  <Slider label="Liquify strength" className="flex-1" min={0.05} max={1} value={s.liqStrength} onChange={(v) => set({ liqStrength: v })} />
                  <span className="w-8 text-right text-[10px] text-muted-foreground tabular-nums">
                    {Math.round(s.liqStrength * 100)}%
                  </span>
                </div>
              </>
            )}

            <p className="text-[10px] leading-snug text-muted-foreground">{mode.hint}</p>

            <div className="mt-auto flex gap-2 pt-1">
              <button
                type="button"
                disabled={!s.distortDirty}
                onClick={() => engine.resetDistort()}
                className={cn(action, "bg-white/8 text-foreground hover:bg-white/14")}
              >
                Reset
              </button>
              <button
                type="button"
                disabled={!s.distortDirty}
                onClick={() => engine.applyDistort()}
                className={cn(action, "bg-primary text-primary-foreground hover:bg-primary/85")}
              >
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
