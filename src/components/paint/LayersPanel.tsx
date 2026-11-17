import {
  ArrowCounterClockwiseIcon,
  ArrowElbowDownRightIcon,
  ArrowLineDownIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  CircleHalfIcon,
  SelectionIcon,
  ShapesIcon,
  ShuffleIcon,
  SwapIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { IconButton, Slider, panelClass, useDismiss } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import {
  defaultFx,
  EFFECT_GROUPS,
  EFFECTS,
  formatParam,
  getEffect,
  LOOKS,
  presetParams,
  randomParams,
  type EffectDef,
} from "@/paint/effects"
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

/** The layer's mask in greyscale: white shows the layer, black hides it. */
function MaskThumb({ layer, aspect }: { layer: LayerMeta; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = 34
  const h = Math.max(20, Math.min(36, Math.round(w / aspect)))

  useEffect(() => {
    const c = ref.current
    const src = engine.getMaskCanvas(layer.id)
    if (!c || !src) return
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(src, 0, 0, c.width, c.height)
  }, [layer.id, layer.maskRev, h])

  return (
    <canvas
      ref={ref}
      width={w * 2}
      height={h * 2}
      className={cn("block rounded-[5px]", layer.maskOff && "opacity-30")}
      style={{ width: w, height: h }}
    />
  )
}

/** Wraps a thumbnail so clicking it chooses what painting edits. */
function EditTarget({
  label,
  selected,
  onPick,
  children,
}: {
  label: string
  selected: boolean
  onPick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation()
        onPick(e)
      }}
      className={cn(
        "shrink-0 rounded-md border border-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-white ring-1 ring-white"
      )}
    >
      {children}
    </button>
  )
}

function MaskControls({ layer }: { layer: LayerMeta }) {
  const id = layer.id
  return (
    <div className="flex items-center gap-0.5 border-t border-white/8 px-2 pt-1.5 pb-2">
      <span className="mr-auto text-[10px] text-muted-foreground uppercase">Mask</span>
      <IconButton label="Invert mask" className="size-7" onClick={() => engine.invertMask(id)}>
        <SwapIcon />
      </IconButton>
      <IconButton
        label={layer.maskOff ? "Enable mask" : "Disable mask (Shift-click its thumbnail)"}
        className="size-7"
        onClick={() => engine.setLayerProps(id, { maskOff: !layer.maskOff })}
      >
        {layer.maskOff ? <EyeSlashIcon className="opacity-50" /> : <EyeIcon />}
      </IconButton>
      <IconButton label="Load mask as selection" className="size-7" onClick={() => engine.selectFromMask(id)}>
        <SelectionIcon />
      </IconButton>
      {!layer.fx && (
        <IconButton label="Apply mask to the layer's pixels" className="size-7" onClick={() => engine.applyMask(id)}>
          <CheckIcon />
        </IconButton>
      )}
      <IconButton label="Delete mask" className="size-7" onClick={() => engine.removeMask(id)}>
        <TrashIcon />
      </IconButton>
    </div>
  )
}

function AddMaskButton({ layer }: { layer: LayerMeta }) {
  const { hasSelection } = useEngine()
  if (layer.mask) return null
  return (
    <IconButton
      label={hasSelection ? "Add mask from selection" : "Add layer mask"}
      className="size-7"
      onClick={() => engine.addMask(layer.id)}
    >
      <CircleHalfIcon />
    </IconButton>
  )
}

function FxThumb() {
  return (
    <div className="grid h-9 w-[52px] shrink-0 place-items-center rounded-md border border-white/10 bg-[linear-gradient(135deg,oklch(0.42_0.09_250),oklch(0.42_0.11_340))] text-white/90">
      <SlidersHorizontalIcon className="size-4" />
    </div>
  )
}

/** Sliders for an adjustment layer's effect. */
function FxControls({ layer, def }: { layer: LayerMeta; def: EffectDef }) {
  const fx = layer.fx!
  const matches = (params: Record<string, number>) =>
    def.params.every((p) => Math.abs((fx.params[p.key] ?? p.value) - params[p.key]) < 1e-6)
  return (
    <div className="flex flex-col gap-2 px-2 pt-0.5 pb-2">
      {def.presets && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Presets">
          {def.presets.map((preset) => {
            const params = presetParams(def, preset)
            const on = matches(params)
            return (
              <button
                key={preset.name}
                type="button"
                aria-pressed={on}
                onClick={() => engine.setFxParams(layer.id, params)}
                className={cn(
                  "rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] text-foreground outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring",
                  on && "border-white/60 bg-white/15"
                )}
              >
                {preset.name}
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="w-16 truncate text-[10px] text-muted-foreground uppercase">Strength</span>
        <Slider
          label="Effect strength"
          className="flex-1"
          min={0}
          max={1}
          value={layer.opacity}
          onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
        />
        <span className="w-7 text-right text-[10px] text-muted-foreground tabular-nums">
          {Math.round(layer.opacity * 100)}
        </span>
      </div>
      {def.params.map((p) => {
        const v = fx.params[p.key] ?? p.value
        return (
          <div key={p.key} className="flex items-center gap-2">
            <span className="w-16 truncate text-[10px] text-muted-foreground uppercase">{p.label}</span>
            <Slider
              label={p.label}
              className="flex-1"
              min={p.min}
              max={p.max}
              exp={p.exp}
              value={v}
              onChange={(n) => engine.setFxParams(layer.id, { [p.key]: n })}
            />
            <span className="w-7 text-right text-[10px] text-muted-foreground tabular-nums">
              {formatParam(p, v)}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5">
        <span className="mr-auto text-[10px] text-muted-foreground">
          {layer.clip ? "Affects the layer below" : "Affects all layers below"}
        </span>
        {def.params.length > 0 && (
          <IconButton
            label="Randomize settings"
            className="size-7"
            onClick={() => engine.setFxParams(layer.id, randomParams(def))}
          >
            <ShuffleIcon />
          </IconButton>
        )}
        <IconButton
          label="Reset to defaults"
          className="size-7"
          onClick={() => engine.setFxParams(layer.id, defaultFx(def).params)}
        >
          <ArrowCounterClockwiseIcon />
        </IconButton>
        <AddMaskButton layer={layer} />
        <IconButton
          label="Clipping mask — affect only the layer below"
          className="size-7"
          active={layer.clip}
          onClick={() => engine.setLayerProps(layer.id, { clip: !layer.clip })}
        >
          <ArrowElbowDownRightIcon />
        </IconButton>
      </div>
    </div>
  )
}

function AddEffectMenu({
  onPick,
  onLook,
}: {
  onPick: (id: string) => void
  onLook: (id: string) => void
}) {
  return (
    <div className="flex max-h-[min(60vh,26rem)] flex-col gap-2 overflow-y-auto [scrollbar-width:thin]">
      <div>
        <div className="px-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Looks
        </div>
        <div className="grid grid-cols-2 gap-1">
          {LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              title={`${look.hint} (${look.layers.length} layers)`}
              onClick={() => onLook(look.id)}
              className="truncate rounded-lg border border-white/10 bg-[linear-gradient(135deg,oklch(0.42_0.09_250/0.55),oklch(0.42_0.11_340/0.55))] px-1.5 py-1.5 text-left text-xs text-foreground outline-none hover:border-white/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {look.label}
            </button>
          ))}
        </div>
      </div>
      {EFFECT_GROUPS.map((group) => (
        <div key={group}>
          <div className="px-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {group}
          </div>
          <div className="grid grid-cols-2 gap-0.5">
            {EFFECTS.filter((e) => e.group === group).map((e) => (
              <button
                key={e.id}
                type="button"
                title={e.hint}
                onClick={() => onPick(e.id)}
                className="truncate rounded-lg px-1.5 py-1.5 text-left text-xs text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The menu a right-click or long press on a layer brings up. */
function LayerMenu({
  layer,
  at,
  onClose,
  onRename,
}: {
  layer: LayerMeta
  at: { x: number; y: number }
  onClose: () => void
  onRename: () => void
}) {
  useDismiss(true, onClose)
  const item = (label: string, run: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose()
        run()
      }}
      className={cn(
        "flex h-8 w-full items-center rounded-lg px-2 text-left text-xs text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring",
        danger && "text-destructive"
      )}
    >
      {label}
    </button>
  )
  // In a portal: the panel's backdrop blur would otherwise trap a fixed box.
  return createPortal(
    <div
      data-popover
      role="menu"
      aria-label={`Actions for ${layer.name}`}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(panelClass, "fixed z-[80] w-52 p-1.5 select-none")}
      style={{
        left: Math.max(8, Math.min(at.x, window.innerWidth - 216)),
        top: Math.max(8, Math.min(at.y, window.innerHeight - 220)),
      }}
    >
      {layer.vector && (
        <>
          {item("Convert to raster layer", () => engine.rasterizeLayer(layer.id))}
          <div className="mx-2 my-1 h-px bg-white/10" />
        </>
      )}
      {item("Rename", onRename)}
      {item("Duplicate", () => engine.duplicateLayer(layer.id))}
      {!layer.fx && item("Merge down", () => engine.mergeDown(layer.id))}
      {item(layer.visible ? "Hide" : "Show", () => engine.setLayerProps(layer.id, { visible: !layer.visible }))}
      <div className="mx-2 my-1 h-px bg-white/10" />
      {item("Delete", () => engine.deleteLayer(layer.id), true)}
    </div>,
    document.body
  )
}

function LayerRow({
  layer,
  active,
  aspect,
  editMask,
}: {
  layer: LayerMeta
  active: boolean
  aspect: number
  editMask: boolean
}) {
  const onMask = active && editMask && !!layer.mask
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const press = useRef({ timer: 0, x: 0, y: 0 })
  const cancelPress = () => window.clearTimeout(press.current.timer)
  const blend = BLEND_MODES.find((b) => b.id === layer.blend)
  const fxDef = layer.fx ? getEffect(layer.fx.type) : undefined

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
        aria-haspopup="menu"
        onClick={() => engine.setActiveLayer(layer.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          cancelPress()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        // Touch and pen have no right button: holding still opens the menu.
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return
          const { clientX: x, clientY: y } = e
          cancelPress()
          press.current = { x, y, timer: window.setTimeout(() => setMenu({ x, y }), 550) }
        }}
        onPointerMove={(e) => {
          if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) cancelPress()
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget)
            engine.setActiveLayer(layer.id)
        }}
        className="flex cursor-default items-center gap-2 rounded-xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {layer.clip && (
          <ArrowElbowDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {layer.mask ? (
          <>
            <EditTarget
              label={layer.fx ? "Adjustment" : "Paint on the layer"}
              selected={active && !onMask}
              onPick={() => {
                engine.setActiveLayer(layer.id)
                engine.setEditMask(false)
              }}
            >
              {layer.fx ? <FxThumb /> : <LayerThumb layer={layer} aspect={aspect} />}
            </EditTarget>
            <EditTarget
              label="Paint on the mask (Shift-click to disable it)"
              selected={onMask}
              onPick={(e) => {
                if (e.shiftKey) {
                  engine.setLayerProps(layer.id, { maskOff: !layer.maskOff })
                  return
                }
                engine.setActiveLayer(layer.id)
                engine.setEditMask(true)
              }}
            >
              <MaskThumb layer={layer} aspect={aspect} />
            </EditTarget>
          </>
        ) : layer.fx ? (
          <FxThumb />
        ) : (
          <LayerThumb layer={layer} aspect={aspect} />
        )}
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
            {layer.vector && <ShapesIcon className="size-3" weight="fill" aria-label="Vector layer" />}
            <span>{onMask ? "Editing mask" : layer.fx ? "Adjustment" : (blend?.label ?? "Normal")}</span>
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

      {menu && (
        <LayerMenu layer={layer} at={menu} onClose={() => setMenu(null)} onRename={() => setEditing(true)} />
      )}

      {active && fxDef && <FxControls layer={layer} def={fxDef} />}

      {active && !layer.fx && (
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
            {layer.vector ? (
              <button
                type="button"
                title="Turn this vector layer into pixels so it can be painted on"
                onClick={() => engine.rasterizeLayer(layer.id)}
                className="h-7 shrink-0 rounded-lg px-2 text-[11px] text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                Rasterise
              </button>
            ) : (
              <IconButton
                label="Alpha lock — paint only on existing pixels"
                className="size-7"
                active={layer.alphaLock}
                onClick={() => engine.setLayerProps(layer.id, { alphaLock: !layer.alphaLock })}
              >
                {layer.alphaLock ? <LockSimpleIcon /> : <LockSimpleOpenIcon />}
              </IconButton>
            )}
            <IconButton
              label="Clipping mask — clip to the layer below"
              className="size-7"
              active={layer.clip}
              onClick={() => engine.setLayerProps(layer.id, { clip: !layer.clip })}
            >
              <ArrowElbowDownRightIcon />
            </IconButton>
            <AddMaskButton layer={layer} />
          </div>
        </div>
      )}

      {onMask && (
        <p className="px-2 pb-1.5 text-[10px] leading-snug text-muted-foreground">
          Painting the mask: dark colours hide the layer, light colours reveal it.
        </p>
      )}
      {active && layer.mask && <MaskControls layer={layer} />}
    </div>
  )
}

export function LayersPanel() {
  const s = useEngine()
  const id = s.activeLayerId
  const idx = s.layers.findIndex((l) => l.id === id)
  const aspect = s.docW / s.docH
  const [fxMenu, setFxMenu] = useState(false)
  useDismiss(fxMenu, () => setFxMenu(false))

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {fxMenu && (
        <>
          <div data-popover className={cn(panelClass, "absolute inset-x-0 bottom-full z-50 mb-2 p-2 group-data-[tight]/panel:top-10 group-data-[tight]/panel:bottom-auto group-data-[tight]/panel:mb-0")}>
            <AddEffectMenu
              onPick={(type) => {
                engine.addAdjustment(type)
                setFxMenu(false)
              }}
              onLook={(lookId) => {
                const look = LOOKS.find((l) => l.id === lookId)
                if (look) engine.addAdjustments(look.layers)
                setFxMenu(false)
              }}
            />
          </div>
        </>
      )}
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
        <IconButton label="Add effect or adjustment layer" data-popover className="size-7" active={fxMenu} onClick={() => setFxMenu(!fxMenu)}>
          <SlidersHorizontalIcon />
        </IconButton>
        <IconButton label="New layer" className="size-7 bg-white/10 text-foreground" onClick={() => engine.addLayer()}>
          <PlusIcon />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:thin]">
        {[...s.layers].reverse().map((l) => (
          <LayerRow key={l.id} layer={l} active={l.id === id} aspect={aspect} editMask={s.editMask} />
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
