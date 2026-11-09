import {
  ArrowElbowDownRightIcon,
  ArrowLineDownIcon,
  CaretDownIcon,
  CaretUpIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { IconButton, Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { BLEND_MODES, engine, type BlendMode, type LayerMeta } from "@/paint/engine"

const checker =
  "repeating-conic-gradient(#d9d9d4 0% 25%, #f1f1ee 0% 50%) 0 0 / 10px 10px"

function LayerThumb({ layer, aspect }: { layer: LayerMeta; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = 52
  const h = Math.max(20, Math.min(52, Math.round(w / aspect)))

  useEffect(() => {
    const c = ref.current
    const src = engine.getLayerCanvas(layer.id)
    if (!c || !src) return
    const ctx = c.getContext("2d")!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(src, 0, 0, c.width, c.height)
  }, [layer.id, layer.rev, h])

  return (
    <canvas
      ref={ref}
      width={w * 2}
      height={h * 2}
      className="shrink-0 rounded-md border border-white/10"
      style={{ width: w, height: h, background: checker }}
    />
  )
}

function LayerRow({
  layer,
  active,
  aspect,
}: {
  layer: LayerMeta
  active: boolean
  aspect: number
}) {
  const [editing, setEditing] = useState(false)
  const blend = BLEND_MODES.find((b) => b.id === layer.blend)

  return (
    <div
      className={cn(
        "mb-1 rounded-xl border border-transparent bg-black/20",
        active && "border-primary bg-primary/25"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={active}
        onClick={() => engine.setActiveLayer(layer.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget)
            engine.setActiveLayer(layer.id)
        }}
        className="flex cursor-default items-center gap-2 rounded-xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {layer.clip && (
          <ArrowElbowDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <LayerThumb layer={layer} aspect={aspect} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              defaultValue={layer.name}
              aria-label="Layer name"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== layer.name) engine.setLayerProps(layer.id, { name })
                setEditing(false)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") setEditing(false)
              }}
              className="h-6 w-full rounded-md border border-ring bg-black/30 px-1.5 text-xs text-foreground outline-none"
            />
          ) : (
            <div
              className="truncate text-xs font-medium text-foreground"
              title="Double-click to rename"
              onDoubleClick={() => setEditing(true)}
            >
              {layer.name}
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{blend?.label ?? "Normal"}</span>
            <span>·</span>
            <span className="tabular-nums">{Math.round(layer.opacity * 100)}%</span>
            {layer.alphaLock && <LockSimpleIcon className="size-3" weight="fill" />}
          </div>
        </div>
        <IconButton
          label={layer.visible ? "Hide layer" : "Show layer"}
          className="size-7"
          onClick={(e) => {
            e.stopPropagation()
            engine.setLayerProps(layer.id, { visible: !layer.visible })
          }}
        >
          {layer.visible ? <EyeIcon /> : <EyeSlashIcon className="opacity-50" />}
        </IconButton>
      </div>

      {active && (
        <div className="flex flex-col gap-2 px-2 pt-0.5 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-12 text-[10px] text-muted-foreground uppercase">Opacity</span>
            <Slider
              label="Layer opacity"
              className="flex-1"
              min={0}
              max={1}
              value={layer.opacity}
              onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Blend mode"
              value={layer.blend}
              onChange={(e) =>
                engine.setLayerProps(layer.id, { blend: e.target.value as BlendMode })
              }
              className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
            >
              {BLEND_MODES.map((b) => (
                <option key={b.id} value={b.id} className="bg-neutral-900">
                  {b.label}
                </option>
              ))}
            </select>
            <IconButton
              label="Alpha lock — paint only on existing pixels"
              className="size-7"
              active={layer.alphaLock}
              onClick={() => engine.setLayerProps(layer.id, { alphaLock: !layer.alphaLock })}
            >
              {layer.alphaLock ? <LockSimpleIcon /> : <LockSimpleOpenIcon />}
            </IconButton>
            <IconButton
              label="Clipping mask — clip to the layer below"
              className="size-7"
              active={layer.clip}
              onClick={() => engine.setLayerProps(layer.id, { clip: !layer.clip })}
            >
              <ArrowElbowDownRightIcon />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  )
}

export function LayersPanel() {
  const s = useEngine()
  const id = s.activeLayerId
  const idx = s.layers.findIndex((l) => l.id === id)
  const aspect = s.docW / s.docH

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
        <h2 className="mr-auto pl-1 text-xs font-semibold tracking-wide text-foreground uppercase">
          Layers
        </h2>
        <IconButton label="Move layer up" className="size-7" disabled={idx >= s.layers.length - 1} onClick={() => engine.moveLayer(id, 1)}>
          <CaretUpIcon />
        </IconButton>
        <IconButton label="Move layer down" className="size-7" disabled={idx <= 0} onClick={() => engine.moveLayer(id, -1)}>
          <CaretDownIcon />
        </IconButton>
        <IconButton label="Merge down" className="size-7" disabled={idx <= 0} onClick={() => engine.mergeDown(id)}>
          <ArrowLineDownIcon />
        </IconButton>
        <IconButton label="Duplicate layer" className="size-7" onClick={() => engine.duplicateLayer(id)}>
          <CopyIcon />
        </IconButton>
        <IconButton label="Delete layer" className="size-7" onClick={() => engine.deleteLayer(id)}>
          <TrashIcon />
        </IconButton>
        <IconButton label="New layer" className="size-7 bg-white/10 text-foreground" onClick={() => engine.addLayer()}>
          <PlusIcon />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:thin]">
        {[...s.layers].reverse().map((l) => (
          <LayerRow key={l.id} layer={l} active={l.id === id} aspect={aspect} />
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2">
        <label
          className="relative size-6 shrink-0 overflow-hidden rounded-md border border-white/15"
          style={{ background: s.showBackground ? s.background : checker }}
          title="Paper colour"
        >
          <input
            type="color"
            aria-label="Paper colour"
            value={s.background}
            onChange={(e) => engine.setBackground(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <span className="flex-1 text-xs text-muted-foreground">Paper</span>
        <IconButton
          label={s.showBackground ? "Hide paper (transparent)" : "Show paper"}
          className="size-7"
          onClick={() => engine.setShowBackground(!s.showBackground)}
        >
          {s.showBackground ? <EyeIcon /> : <EyeSlashIcon className="opacity-50" />}
        </IconButton>
      </div>
    </div>
  )
}
