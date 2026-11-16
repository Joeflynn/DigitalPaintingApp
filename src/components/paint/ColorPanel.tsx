import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CircleIcon,
  DiamondIcon,
  EyedropperIcon,
  SquareIcon,
  TriangleIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { ColorWheel, WHEEL_SHAPES, type WheelShape } from "@/components/paint/ColorWheel"
import { IconButton, Slider } from "@/components/paint/controls"
import { layout, useLayout } from "@/components/paint/layout"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { hsvToHex, hsvToRgb, rgbToHex, rgbToHsv, type HSV } from "@/paint/color"
import { engine } from "@/paint/engine"

const PALETTES: { name: string; colors: string[] }[] = [
  {
    name: "Basic",
    colors: [
      "#000000", "#262626", "#4d4d4d", "#808080", "#a6a6a6", "#cccccc", "#e6e6e6", "#ffffff",
      "#e03131", "#e8590c", "#f08c00", "#f6c445", "#9bc53d", "#2f9e44", "#0ca678", "#1098ad",
      "#1c7ed6", "#4263eb", "#27357e", "#7048e8", "#ae3ec9", "#d6336c", "#a9714b", "#5b3a29",
    ],
  },
  {
    name: "Skin tones",
    colors: [
      "#fdecdc", "#f9dcc4", "#f3cdaa", "#ebbc94", "#e0a97d", "#d39669", "#c18457", "#ad7248",
      "#99623c", "#855332", "#71452a", "#5e3923", "#4c2e1d", "#3c2418", "#2e1b13", "#21130e",
    ],
  },
  {
    name: "Pastel",
    colors: [
      "#ffadad", "#ffc2a8", "#ffd6a5", "#fdffb6", "#d9f8b4", "#caffbf", "#b5f2d8", "#9bf6ff",
      "#a8d8ff", "#a0c4ff", "#b4b8ff", "#bdb2ff", "#d7b8ff", "#ffc6ff", "#ffc2e2", "#fffffc",
    ],
  },
  {
    name: "Earth",
    colors: [
      "#2b2118", "#4a3728", "#6f4e37", "#8d6e4f", "#a98b67", "#c8ad7f", "#e3d0a8", "#f2e8cf",
      "#283618", "#606c38", "#8a9a5b", "#bc6c25", "#dda15e", "#9c4a1a", "#7f2f1d", "#5b1f1a",
    ],
  },
  {
    name: "Greyscale",
    colors: Array.from({ length: 16 }, (_, i) => {
      const n = Math.round((i / 15) * 255)
      return rgbToHex(n, n, n)
    }).reverse(),
  },
]

/** Swatches offered in the compact panel once the recent colours run out. */
const QUICK = [
  "#000000", "#808080", "#ffffff", "#e03131", "#f08c00", "#f6c445", "#2f9e44", "#1c7ed6",
  "#7048e8", "#d6336c", "#a9714b", "#5b3a29", "#0ca678", "#1098ad", "#27357e", "#cccccc",
]

const SHAPE_KEY = "pigment.wheel"
const SHAPE_INFO: Record<WheelShape, { label: string; icon: ReactNode }> = {
  diamond: { label: "Diamond", icon: <DiamondIcon /> },
  circle: { label: "Circle", icon: <CircleIcon /> },
  square: { label: "Square", icon: <SquareIcon /> },
  triangle: { label: "Triangle", icon: <TriangleIcon /> },
}

function loadShape(): WheelShape {
  try {
    const saved = localStorage.getItem(SHAPE_KEY) as WheelShape | null
    if (saved && WHEEL_SHAPES.includes(saved)) return saved
  } catch {
    // default below
  }
  return "diamond"
}

function Swatches({ colors, current }: { colors: string[]; current: string }) {
  return (
    <div className="grid shrink-0 grid-cols-8 gap-1">
      {colors.map((hex) => (
        <button
          key={hex}
          type="button"
          title={hex}
          aria-label={`Use colour ${hex}`}
          onClick={() => engine.setColorHex(hex)}
          className={cn(
            "aspect-square w-full rounded-md border border-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hex === current && "ring-2 ring-white/80"
          )}
          style={{ background: hex }}
        />
      ))}
    </div>
  )
}

function HexField({ hex, className }: { hex: string; className?: string }) {
  // null while not editing, so the field always mirrors the live colour
  const [draft, setDraft] = useState<string | null>(null)
  return (
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
      className={cn(
        "h-7 w-20 rounded-lg border border-white/10 bg-black/25 px-2 font-mono text-xs text-foreground uppercase outline-none select-text focus:border-ring",
        className
      )}
    />
  )
}

/** The wheel, sized to the space it is given, with tool buttons in its corners. */
function WheelArea({
  color,
  shape,
  left,
  right,
}: {
  color: HSV
  shape: WheelShape
  left?: ReactNode
  right?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(Math.max(0, Math.floor(Math.min(width, height))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className="relative grid min-h-24 flex-1 place-items-center">
      {size >= 60 && (
        <ColorWheel color={color} shape={shape} size={size} onChange={(c) => engine.setColor(c)} />
      )}
      <div className="absolute top-0 left-0">{left}</div>
      <div className="absolute top-0 right-0">{right}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="border-b border-white/8 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between rounded-lg px-1 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        <CaretDownIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="flex flex-col gap-2 px-1 pb-3">{children}</div>}
    </section>
  )
}

/** A labelled slider paired with a number field for exact values. */
function Channel({
  label,
  value,
  max,
  track,
  onChange,
}: {
  label: string
  value: number
  max: number
  track: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <input
          type="number"
          aria-label={label}
          min={0}
          max={max}
          value={Math.round(value)}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(Math.max(0, Math.min(max, n)))
          }}
          className="h-6 w-14 rounded-md border border-white/10 bg-black/25 px-1.5 text-right text-[11px] text-foreground tabular-nums outline-none select-text focus:border-ring"
        />
      </div>
      <Slider
        label={`${label} slider`}
        min={0}
        max={max}
        value={value}
        onChange={onChange}
        trackStyle={{ height: 10, background: track }}
      />
    </div>
  )
}

function Values({ color, hex }: { color: HSV; hex: string }) {
  const [r, g, b] = hsvToRgb(color)
  const hsv = (c: Partial<HSV>) => hsvToHex({ ...color, ...c })
  const setRgb = (nr: number, ng: number, nb: number) =>
    engine.setColor(rgbToHsv(Math.round(nr), Math.round(ng), Math.round(nb), color.h))
  const ramp = (from: string, to: string) => `linear-gradient(to right, ${from}, ${to})`
  return (
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
      <Section title="Hex">
        <HexField hex={hex} className="w-24" />
      </Section>
      <Section title="HSB">
        <Channel
          label="Hue"
          max={359}
          value={Math.min(359, color.h)}
          track="linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
          onChange={(h) => engine.setColor({ ...color, h })}
        />
        <Channel
          label="Saturation"
          max={100}
          value={color.s * 100}
          track={ramp(hsv({ s: 0 }), hsv({ s: 1 }))}
          onChange={(s) => engine.setColor({ ...color, s: s / 100 })}
        />
        <Channel
          label="Brightness"
          max={100}
          value={color.v * 100}
          track={ramp("#000", hsv({ v: 1 }))}
          onChange={(v) => engine.setColor({ ...color, v: v / 100 })}
        />
      </Section>
      <Section title="RGB">
        <Channel label="Red" max={255} value={r} track={ramp(rgbToHex(0, g, b), rgbToHex(255, g, b))} onChange={(n) => setRgb(n, g, b)} />
        <Channel label="Green" max={255} value={g} track={ramp(rgbToHex(r, 0, b), rgbToHex(r, 255, b))} onChange={(n) => setRgb(r, n, b)} />
        <Channel label="Blue" max={255} value={b} track={ramp(rgbToHex(r, g, 0), rgbToHex(r, g, 255))} onChange={(n) => setRgb(r, g, n)} />
      </Section>
    </div>
  )
}

type Tab = "basic" | "palettes" | "values"
const TABS: [Tab, string][] = [
  ["basic", "Basic"],
  ["palettes", "Palettes"],
  ["values", "Value"],
]

export function ColorPanel() {
  const s = useEngine()
  const { colorExpanded } = useLayout()
  const { color } = s
  const hex = hsvToHex(color)
  const [shape, setShape] = useState(loadShape)
  const [tab, setTab] = useState<Tab>("basic")

  const nextShape = () => {
    const next = WHEEL_SHAPES[(WHEEL_SHAPES.indexOf(shape) + 1) % WHEEL_SHAPES.length]
    setShape(next)
    try {
      localStorage.setItem(SHAPE_KEY, next)
    } catch {
      // not remembered
    }
  }

  const small = "size-7 [&_svg]:size-4"
  const eyedropper = (
    <IconButton
      label="Pick a colour from the canvas (I)"
      className={small}
      active={s.tool === "eyedropper"}
      onClick={() => engine.setTool("eyedropper")}
    >
      <EyedropperIcon />
    </IconButton>
  )
  const shapeButton = (
    <IconButton
      label={`Picker shape: ${SHAPE_INFO[shape].label} — click to change`}
      className={small}
      onClick={nextShape}
    >
      {SHAPE_INFO[shape].icon}
    </IconButton>
  )
  const expandButton = (
    <IconButton
      label={colorExpanded ? "Collapse the colour panel" : "Expand the colour panel"}
      className={small}
      aria-expanded={colorExpanded}
      onClick={() => layout.toggleColor()}
    >
      {colorExpanded ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
    </IconButton>
  )

  if (!colorExpanded) {
    const quick = [...new Set([...s.recentColors.slice(0, 8), ...QUICK])].slice(0, 16)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3 pt-2">
        <WheelArea color={color} shape={shape} left={eyedropper} right={expandButton} />
        <Swatches colors={quick} current={hex} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3 pt-2">
      <div className="flex shrink-0 items-center gap-2">
        <div role="tablist" aria-label="Colour views" className="flex flex-1 gap-0.5 rounded-xl bg-black/25 p-0.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-7 flex-1 rounded-[10px] text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                tab === id && "bg-white/12 text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {expandButton}
      </div>

      {tab === "basic" && (
        <>
          <WheelArea color={color} shape={shape} left={eyedropper} right={shapeButton} />
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              title="Swap with previous colour (X)"
              aria-label="Swap with previous colour"
              onClick={() => engine.swapColors()}
              className="relative h-7 w-12 shrink-0 overflow-hidden rounded-lg border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ background: hex }}
            >
              <span
                className="absolute inset-y-0 right-0 w-4 border-l border-black/30"
                style={{ background: hsvToHex(s.prevColor) }}
              />
            </button>
            <div className="ml-auto flex gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>H {Math.round(color.h)}</span>
              <span>S {Math.round(color.s * 100)}</span>
              <span>B {Math.round(color.v * 100)}</span>
            </div>
            <HexField hex={hex} />
          </div>
          <Swatches colors={PALETTES[0].colors} current={hex} />
          {s.recentColors.length > 0 && <Swatches colors={s.recentColors.slice(0, 8)} current="" />}
        </>
      )}

      {tab === "palettes" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          {s.recentColors.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">Recent</h3>
              <Swatches colors={s.recentColors} current={hex} />
            </div>
          )}
          {PALETTES.map((p) => (
            <div key={p.name}>
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">{p.name}</h3>
              <Swatches colors={p.colors} current={hex} />
            </div>
          ))}
        </div>
      )}

      {tab === "values" && <Values color={color} hex={hex} />}
    </div>
  )
}
