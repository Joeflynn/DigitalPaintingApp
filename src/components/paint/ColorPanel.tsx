import { useState } from "react"
import type * as React from "react"

import { Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { hsvToHex } from "@/paint/color"
import { engine } from "@/paint/engine"

const PALETTE = [
  "#16130f", "#4a4a48", "#8b8b86", "#c9c8c1", "#f6f3ec", "#ffffff", "#5b3a29", "#a9714b",
  "#e0b58c", "#f4d9c0", "#b3261e", "#e5533d", "#f28c38", "#f6c445", "#f3e37c", "#9bc53d",
  "#3f9d5a", "#1f6f5c", "#38bdb0", "#4aa3df", "#2b5fb8", "#27357e", "#7a4fc4", "#d264a8",
]

function Swatch({ hex, active }: { hex: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={hex}
      aria-label={`Use colour ${hex}`}
      onClick={() => engine.setColorHex(hex)}
      className={cn(
        "aspect-square w-full rounded-md border border-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-white/80"
      )}
      style={{ background: hex }}
    />
  )
}

export function ColorPanel() {
  const s = useEngine()
  const { color } = s
  const hex = hsvToHex(color)
  // null while not editing, so the field always mirrors the live colour
  const [draft, setDraft] = useState<string | null>(null)

  const pickSV = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sat = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const val = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    engine.setColor({ h: color.h, s: sat, v: val })
  }

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div
        role="application"
        aria-label="Saturation and brightness"
        className="relative h-36 cursor-crosshair touch-none overflow-hidden rounded-xl"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${color.h} 100% 50%))`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickSV(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pickSV(e)
        }}
      >
        <div
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{
            left: `${color.s * 100}%`,
            top: `${(1 - color.v) * 100}%`,
            background: hex,
          }}
        />
      </div>

      <Slider
        label="Hue"
        min={0}
        max={359.9}
        value={color.h}
        onChange={(h) => engine.setColor({ ...color, h })}
        trackStyle={{
          height: 10,
          background:
            "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        }}
      />

      <div className="flex items-center gap-2">
        <span
          className="size-7 shrink-0 rounded-lg border border-white/15"
          style={{ background: hex }}
        />
        <input
          aria-label="Hex colour"
          value={draft ?? hex}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) engine.setColorHex(draft)
            setDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className="h-7 w-20 rounded-lg border border-white/10 bg-black/25 px-2 font-mono text-xs text-foreground uppercase outline-none focus:border-ring"
        />
        <div className="ml-auto flex gap-2 text-[11px] text-muted-foreground tabular-nums">
          <span>H {Math.round(color.h)}</span>
          <span>S {Math.round(color.s * 100)}</span>
          <span>B {Math.round(color.v * 100)}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-1">
        {PALETTE.map((p) => (
          <Swatch key={p} hex={p} active={p === hex} />
        ))}
      </div>

      {s.recentColors.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Recent
          </div>
          <div className="grid grid-cols-12 gap-1">
            {s.recentColors.slice(0, 12).map((p) => (
              <Swatch key={p} hex={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
