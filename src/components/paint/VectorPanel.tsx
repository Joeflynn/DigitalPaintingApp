import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  CircleIcon,
  CopyIcon,
  HexagonIcon,
  LineSegmentIcon,
  ProhibitIcon,
  RectangleIcon,
  StarIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextItalicIcon,
  TextUnderlineIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useState, type ReactNode } from "react"

import { IconButton, Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { engine, selectedObject } from "@/paint/engine"
import {
  FONT_WEIGHTS,
  FONTS,
  SHAPE_KINDS,
  type DashStyle,
  type ShapeKind,
  type ShapeStyle,
  type TextAlign,
  type TextStyle,
} from "@/paint/vector"

export const SHAPE_ICONS: Record<ShapeKind, ReactNode> = {
  rect: <RectangleIcon />,
  ellipse: <CircleIcon />,
  polygon: <HexagonIcon />,
  star: <StarIcon />,
  line: <LineSegmentIcon />,
  arrow: <ArrowUpRightIcon />,
}

const labelClass = "w-14 shrink-0 truncate text-[10px] text-muted-foreground uppercase"
const fieldClass =
  "h-7 min-w-0 rounded-lg border border-white/10 bg-black/30 px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
const checker =
  "repeating-conic-gradient(#d9d9d4 0% 25%, #f1f1ee 0% 50%) 0 0 / 8px 8px"

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  )
}

function Param({
  label,
  value,
  min,
  max,
  exp,
  format = (v) => String(Math.round(v)),
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  exp?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <Row label={label}>
      <Slider label={label} className="flex-1" min={min} max={max} exp={exp} value={value} onChange={onChange} />
      <span className="w-8 text-right text-[10px] text-muted-foreground tabular-nums">
        {format(value)}
      </span>
    </Row>
  )
}

/** A number box that commits on Enter or when it loses focus. */
function NumField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = Math.round(value * 10) / 10
  const commit = () => {
    if (draft === null) return
    const v = Number(draft)
    if (draft.trim() !== "" && Number.isFinite(v) && v !== shown) onCommit(v)
    setDraft(null)
  }
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        aria-label={label}
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        className={cn(fieldClass, "w-full tabular-nums")}
      />
    </label>
  )
}

/** A fill or stroke: its swatch picks what the colour panel edits. */
function PaintRow({
  label,
  target,
  value,
  active,
  fallback,
  children,
}: {
  label: string
  target: "fill" | "stroke"
  value: string | null
  active: boolean
  /** Colour used when the paint is switched back on. */
  fallback: string
  children?: ReactNode
}) {
  return (
    <Row label={label}>
      <button
        type="button"
        title={`Edit ${label.toLowerCase()} colour with the colour panel`}
        aria-label={`${label} colour`}
        aria-pressed={active}
        onClick={() => {
          if (value === null) engine.setVectorProps({ [target]: fallback })
          engine.setVecPaint(target)
        }}
        className={cn(
          "relative size-7 shrink-0 overflow-hidden rounded-lg border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "ring-2 ring-white/85"
        )}
        style={{ background: value ?? checker }}
      >
        {value === null && (
          <span className="absolute inset-0 grid place-items-center text-neutral-600">
            <ProhibitIcon className="size-4" />
          </span>
        )}
      </button>
      {children ?? (
        <span className="flex-1 text-[11px] text-muted-foreground tabular-nums">
          {value ?? "None"}
        </span>
      )}
      <IconButton
        label={value === null ? `Add ${label.toLowerCase()}` : `Remove ${label.toLowerCase()}`}
        className="size-7"
        active={value === null}
        onClick={() => {
          if (value === null) {
            engine.setVectorProps({ [target]: fallback })
            engine.setVecPaint(target)
          } else {
            engine.setVectorProps({ [target]: null })
            engine.setVecPaint(target === "fill" ? "stroke" : "fill")
          }
        }}
      >
        <ProhibitIcon />
      </IconButton>
    </Row>
  )
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string; icon: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-black/25 p-0.5">
      {options.map((o) => (
        <IconButton
          key={o.id}
          label={o.label}
          className="size-6 rounded-md [&_svg]:size-[15px]"
          active={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.icon}
        </IconButton>
      ))}
    </div>
  )
}

const DASHES: { id: DashStyle; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "dash", label: "Dashed" },
  { id: "dot", label: "Dotted" },
]

const ALIGNS: { id: TextAlign; label: string; icon: ReactNode }[] = [
  { id: "left", label: "Align left", icon: <TextAlignLeftIcon /> },
  { id: "center", label: "Align centre", icon: <TextAlignCenterIcon /> },
  { id: "right", label: "Align right", icon: <TextAlignRightIcon /> },
]

function ShapeParams({ style }: { style: ShapeStyle }) {
  const set = engine.setVectorProps.bind(engine)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const deg = (v: number) => `${Math.round(v)}°`
  switch (style.shape) {
    case "rect":
      return (
        <Param label="Corners" min={0} max={400} exp={2} value={style.radius} onChange={(v) => set({ radius: Math.round(v) })} />
      )
    case "ellipse":
      return (
        <>
          <Param label="Sweep" min={5} max={360} value={style.sweep} format={deg} onChange={(v) => set({ sweep: Math.round(v) })} />
          <Param label="Start" min={0} max={360} value={style.start} format={deg} onChange={(v) => set({ start: Math.round(v) })} />
          <Param label="Hole" min={0} max={0.95} value={style.ring} format={pct} onChange={(v) => set({ ring: v })} />
        </>
      )
    case "polygon":
      return (
        <>
          <Param label="Sides" min={3} max={12} value={style.sides} onChange={(v) => set({ sides: Math.round(v) })} />
          <Param label="Corners" min={0} max={300} exp={2} value={style.radius} onChange={(v) => set({ radius: Math.round(v) })} />
        </>
      )
    case "star":
      return (
        <>
          <Param label="Points" min={3} max={24} value={style.sides} onChange={(v) => set({ sides: Math.round(v) })} />
          <Param label="Depth" min={0.1} max={0.95} value={style.inner} format={pct} onChange={(v) => set({ inner: v })} />
          <Param label="Corners" min={0} max={200} exp={2} value={style.radius} onChange={(v) => set({ radius: Math.round(v) })} />
        </>
      )
    case "arrow":
      return (
        <Param label="Head" min={1.5} max={10} value={style.head} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ head: v })} />
      )
    default:
      return null
  }
}

function TextParams({ style }: { style: TextStyle }) {
  const set = engine.setVectorProps.bind(engine)
  return (
    <>
      <Row label="Font">
        <select
          aria-label="Font"
          value={style.font}
          onChange={(e) => set({ font: e.target.value })}
          className={cn(fieldClass, "flex-1")}
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} className="bg-neutral-900">
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Style">
        <select
          aria-label="Font weight"
          value={style.weight}
          onChange={(e) => set({ weight: Number(e.target.value) })}
          className={cn(fieldClass, "flex-1")}
        >
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value} className="bg-neutral-900">
              {w.label}
            </option>
          ))}
        </select>
        <IconButton label="Italic" className="size-7" active={style.italic} onClick={() => set({ italic: !style.italic })}>
          <TextItalicIcon />
        </IconButton>
        <IconButton label="Underline" className="size-7" active={style.underline} onClick={() => set({ underline: !style.underline })}>
          <TextUnderlineIcon />
        </IconButton>
      </Row>
      <Param label="Size" min={8} max={600} exp={2} value={style.size} onChange={(v) => set({ size: Math.round(v) })} />
      <Row label="Align">
        <Segment value={style.align} options={ALIGNS} onChange={(align) => set({ align })} />
      </Row>
      <Param label="Leading" min={0.7} max={2.5} value={style.lineHeight} format={(v) => v.toFixed(2)} onChange={(v) => set({ lineHeight: Math.round(v * 100) / 100 })} />
      <Param label="Tracking" min={-0.1} max={0.6} value={style.spacing} format={(v) => String(Math.round(v * 100))} onChange={(v) => set({ spacing: Math.round(v * 100) / 100 })} />
    </>
  )
}

/** Properties of the selected vector object, or of the next one to be drawn. */
export function VectorPanel() {
  const s = useEngine()
  const obj = selectedObject(s)
  const isText = obj ? obj.type === "text" : s.tool === "text"
  const style: ShapeStyle | TextStyle = obj ?? (isText ? s.textStyle : s.shapeStyle)
  const shape = "shape" in style ? style : null
  const text = "font" in style ? style : null
  const line = shape?.shape === "line" || shape?.shape === "arrow"
  const set = engine.setVectorProps.bind(engine)
  const paint = line ? "stroke" : s.vecPaint

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
        <h2 className="mr-auto pl-1 text-xs font-semibold tracking-wide text-foreground uppercase">
          {isText ? "Text" : "Shape"}
          <span className="ml-2 font-normal tracking-normal text-muted-foreground normal-case">
            {obj ? "selected" : "next drawn"}
          </span>
        </h2>
        {obj && (
          <>
            <IconButton label="Bring forward" className="size-7" onClick={() => engine.orderObject(1)}>
              <ArrowUpIcon />
            </IconButton>
            <IconButton label="Send backward" className="size-7" onClick={() => engine.orderObject(-1)}>
              <ArrowDownIcon />
            </IconButton>
            <IconButton label="Duplicate object" className="size-7" onClick={() => engine.duplicateObject()}>
              <CopyIcon />
            </IconButton>
            <IconButton label="Delete object (Backspace)" className="size-7" onClick={() => engine.deleteObject()}>
              <TrashIcon />
            </IconButton>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
        {shape && (
          <div className="flex gap-0.5 rounded-xl bg-black/25 p-0.5" role="group" aria-label="Shape">
            {SHAPE_KINDS.map((k) => (
              <IconButton
                key={k.id}
                label={k.label}
                className="h-7 flex-1 rounded-lg"
                active={shape.shape === k.id}
                onClick={() => set({ shape: k.id })}
              >
                {SHAPE_ICONS[k.id]}
              </IconButton>
            ))}
          </div>
        )}

        {text && <TextParams style={text} />}

        {!line && (
          <PaintRow label="Fill" target="fill" value={style.fill} active={paint === "fill"} fallback={style.stroke ?? "#e5533d"} />
        )}
        <PaintRow
          label={line ? "Colour" : isText ? "Outline" : "Stroke"}
          target="stroke"
          value={style.stroke}
          active={paint === "stroke"}
          fallback={isText ? "#ffffff" : "#16130f"}
        >
          {line ? undefined : (
            <select
              aria-label="Stroke style"
              value={style.dash}
              disabled={isText || style.stroke === null}
              onChange={(e) => set({ dash: e.target.value as DashStyle })}
              className={cn(fieldClass, "flex-1 disabled:opacity-40")}
            >
              {DASHES.map((d) => (
                <option key={d.id} value={d.id} className="bg-neutral-900">
                  {d.label}
                </option>
              ))}
            </select>
          )}
        </PaintRow>
        {(line || style.stroke !== null) && (
          <Param label="Width" min={1} max={120} exp={2} value={style.strokeWidth} onChange={(v) => set({ strokeWidth: Math.round(v) })} />
        )}
        {line && (
          <Row label="Line">
            <select
              aria-label="Line style"
              value={style.dash}
              onChange={(e) => set({ dash: e.target.value as DashStyle })}
              className={cn(fieldClass, "flex-1")}
            >
              {DASHES.map((d) => (
                <option key={d.id} value={d.id} className="bg-neutral-900">
                  {d.label}
                </option>
              ))}
            </select>
          </Row>
        )}

        {shape && <ShapeParams style={shape} />}

        <Param label="Opacity" min={0} max={1} value={style.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} />

        {obj && (
          <>
            <div className="flex gap-2">
              <NumField label="X" value={obj.x} onCommit={(x) => set({ x })} />
              <NumField label="Y" value={obj.y} onCommit={(y) => set({ y })} />
              {!line && (
                <NumField
                  label="°"
                  value={(((obj.rot * 180) / Math.PI) % 360 + 360) % 360}
                  onCommit={(d) => set({ rot: (d * Math.PI) / 180 })}
                />
              )}
            </div>
            {obj.type === "shape" && (
              <div className="flex gap-2">
                <NumField label="W" value={obj.w} onCommit={(w) => set({ w: line ? w : Math.max(1, w) })} />
                <NumField label="H" value={obj.h} onCommit={(h) => set({ h: line ? h : Math.max(1, h) })} />
              </div>
            )}
          </>
        )}

        <p className="text-[10px] leading-snug text-muted-foreground">
          {obj
            ? "Pick a colour above to recolour the highlighted swatch."
            : isText
              ? "Click to type, or drag a box for wrapped text."
              : "Drag on the canvas to draw. Hold Shift to constrain."}
        </p>
      </div>
    </div>
  )
}
