import { ArrowCounterClockwiseIcon, HandGrabbingIcon } from "@phosphor-icons/react"
import { useState } from "react"
import type { ReactNode } from "react"

import { Slider } from "@/components/paint/controls"
import { cn } from "@/lib/utils"
import { aids, useAids, type GridKind, type SymmetryMode } from "@/paint/aids"
import { MODELS, POSES, type RefStyle } from "@/paint/ref3d"

function Switch({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-8 w-full shrink-0 items-center justify-between rounded-lg px-1 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <span className={cn("relative h-4.5 w-8 rounded-full bg-white/15 transition-colors", on && "bg-primary")}>
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white transition-transform",
            on && "translate-x-3.5"
          )}
        />
      </span>
    </button>
  )
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-0.5 rounded-lg bg-black/25 p-0.5">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-7 min-w-0 flex-1 truncate rounded-md px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            value === id && "bg-white/12 text-foreground"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Range({
  label,
  value,
  min,
  max,
  exp,
  show,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  exp?: number
  show: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="w-16 shrink-0 truncate text-[10px] text-muted-foreground uppercase">{label}</span>
      <Slider label={label} className="flex-1" min={min} max={max} exp={exp} value={value} onChange={onChange} />
      <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">{show}</span>
    </div>
  )
}

function Action({
  onClick,
  active,
  children,
}: {
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg bg-black/25 px-2 text-[11px] text-foreground outline-none hover:bg-black/45 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
        active && "bg-primary hover:bg-primary"
      )}
    >
      {children}
    </button>
  )
}

const heading = "pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
const pct = (n: number) => `${Math.round(n * 100)}%`
const deg = (n: number) => `${Math.round(n)}°`

function SymmetryTab() {
  const { symmetry: s } = useAids()
  const set = aids.setSymmetry
  return (
    <>
      <Switch on={s.on} onChange={(on) => set({ on })}>
        Symmetry <span className="mr-auto ml-2 font-mono text-[10px] text-muted-foreground">M</span>
      </Switch>
      <Segmented<SymmetryMode>
        label="Symmetry type"
        value={s.mode}
        onChange={(mode) => set({ mode, on: true })}
        options={[
          ["vertical", "Vertical"],
          ["horizontal", "Horizontal"],
          ["quad", "Quadrant"],
          ["radial", "Radial"],
        ]}
      />
      {s.mode === "radial" && (
        <>
          <Range label="Segments" min={2} max={16} value={s.segments} show={String(s.segments)} onChange={(v) => set({ segments: Math.round(v) })} />
          <Switch on={s.mirror} onChange={(mirror) => set({ mirror })}>
            Mirror each segment
          </Switch>
        </>
      )}
      <Range label="Angle" min={-90} max={90} value={s.angle} show={deg(s.angle)} onChange={(v) => set({ angle: Math.round(v) })} />
      <div className={heading}>Centre</div>
      <Range label="Across" min={0} max={1} value={s.cx} show={pct(s.cx)} onChange={(cx) => set({ cx })} />
      <Range label="Down" min={0} max={1} value={s.cy} show={pct(s.cy)} onChange={(cy) => set({ cy })} />
      <div className="flex gap-1">
        <Action onClick={() => set({ cx: 0.5, cy: 0.5, angle: 0 })}>
          <ArrowCounterClockwiseIcon /> Centre on canvas
        </Action>
      </div>
    </>
  )
}

function GuidesTab() {
  const { grid, perspective: p, guideOpacity } = useAids()
  return (
    <>
      <Switch on={grid.on} onChange={(on) => aids.setGrid({ on })}>
        Grid
      </Switch>
      <Segmented<GridKind>
        label="Grid type"
        value={grid.kind}
        onChange={(kind) => aids.setGrid({ kind, on: true })}
        options={[
          ["square", "Square"],
          ["iso", "Isometric"],
          ["thirds", "Thirds"],
        ]}
      />
      {grid.kind !== "thirds" && (
        <Range label="Spacing" min={10} max={500} exp={2} value={grid.size} show={`${Math.round(grid.size)}`} onChange={(v) => aids.setGrid({ size: Math.round(v) })} />
      )}

      <div className="mt-1 border-t border-white/8 pt-1">
        <Switch on={p.on} onChange={(on) => aids.setPerspective({ on, editing: on && p.editing })}>
          Perspective
        </Switch>
      </div>
      <Segmented<1 | 2 | 3>
        label="Vanishing points"
        value={p.points}
        onChange={(points) => aids.setPerspective({ points, on: true })}
        options={[
          [1, "1 point"],
          [2, "2 point"],
          [3, "3 point"],
        ]}
      />
      <Range label="Lines" min={4} max={48} value={p.density} show={String(p.density)} onChange={(v) => aids.setPerspective({ density: Math.round(v) })} />
      <div className="flex gap-1">
        <Action active={p.on && p.editing} onClick={() => aids.setPerspective({ on: true, editing: !(p.on && p.editing) })}>
          <HandGrabbingIcon /> Move points
        </Action>
        <Action onClick={() => aids.resetVanishingPoints()}>
          <ArrowCounterClockwiseIcon /> Reset
        </Action>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        Move points puts a handle on each vanishing point. Zoom out to reach ones that sit off the canvas.
      </p>

      <div className="mt-1 border-t border-white/8 pt-2">
        <Range label="Opacity" min={0.1} max={1} value={guideOpacity} show={pct(guideOpacity)} onChange={(v) => aids.setGuideOpacity(v)} />
      </div>
    </>
  )
}

function ReferenceTab() {
  const { reference: r } = useAids()
  const set = aids.setReference
  return (
    <>
      <Switch on={r.on} onChange={(on) => set({ on, adjusting: on && r.adjusting })}>
        3D reference
      </Switch>
      {MODELS.map((g) => (
        <div key={g.group} className="flex shrink-0 flex-col gap-1">
          <div className={heading}>{g.group}</div>
          <div className="grid grid-cols-3 gap-1">
            {g.items.map((m) => (
              <Action key={m.id} active={r.model === m.id} onClick={() => set({ model: m.id, on: true })}>
                {m.label}
              </Action>
            ))}
          </div>
          {g.group === "Figure" && r.model === "mannequin" && (
            <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="Pose">
              {POSES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={r.pose === p.id}
                  onClick={() => set({ pose: p.id, on: true })}
                  className={cn(
                    "h-6 truncate rounded-md px-1 text-[10px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    r.pose === p.id && "bg-white/12 text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className={heading}>Look</div>
      <Segmented<RefStyle>
        label="Rendering"
        value={r.style}
        onChange={(style) => set({ style })}
        options={[
          ["shaded", "Shaded"],
          ["both", "Both"],
          ["wire", "Wire"],
        ]}
      />
      <Range label="Opacity" min={0.05} max={1} value={r.opacity} show={pct(r.opacity)} onChange={(opacity) => set({ opacity })} />
      <Switch on={r.floor} onChange={(floor) => set({ floor })}>
        Floor grid
      </Switch>

      <div className={heading}>Camera</div>
      <Range label="Rotate" min={-180} max={180} value={r.yaw} show={deg(r.yaw)} onChange={(v) => set({ yaw: Math.round(v) })} />
      <Range label="Tilt" min={-89} max={89} value={r.pitch} show={deg(r.pitch)} onChange={(v) => set({ pitch: Math.round(v) })} />
      <Range label="Size" min={0.1} max={4} exp={2} value={r.size} show={pct(r.size)} onChange={(size) => set({ size })} />
      <Range label="Lens" min={10} max={110} value={r.fov} show={deg(r.fov)} onChange={(v) => set({ fov: Math.round(v) })} />
      <Range label="Across" min={-1.5} max={1.5} value={r.x} show={r.x.toFixed(2)} onChange={(x) => set({ x })} />
      <Range label="Up" min={-1.5} max={1.5} value={r.y} show={r.y.toFixed(2)} onChange={(y) => set({ y })} />
      <div className="flex gap-1">
        <Action active={r.on && r.adjusting} onClick={() => set({ on: true, adjusting: !(r.on && r.adjusting) })}>
          <HandGrabbingIcon /> Move on canvas
        </Action>
        <Action onClick={() => aids.resetCamera()}>
          <ArrowCounterClockwiseIcon /> Reset
        </Action>
      </div>
    </>
  )
}

type Tab = "symmetry" | "guides" | "reference"

export function AidsPanel() {
  const a = useAids()
  const [tab, setTab] = useState<Tab>("symmetry")
  const tabs: [Tab, string, boolean][] = [
    ["symmetry", "Symmetry", a.symmetry.on],
    ["guides", "Guides", a.grid.on || a.perspective.on],
    ["reference", "3D", a.reference.on],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">Drawing aids</h2>
        <span className="text-[10px] text-muted-foreground">Not exported</span>
      </div>
      <div role="tablist" aria-label="Drawing aids" className="mx-3 mb-2 flex shrink-0 gap-0.5 rounded-xl bg-black/25 p-0.5">
        {tabs.map(([id, label, on]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              tab === id && "bg-white/12 text-foreground"
            )}
          >
            {label}
            {on && <span className="size-1.5 rounded-full bg-emerald-400" aria-label="on" />}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
        {tab === "symmetry" && <SymmetryTab />}
        {tab === "guides" && <GuidesTab />}
        {tab === "reference" && <ReferenceTab />}
      </div>
    </div>
  )
}
