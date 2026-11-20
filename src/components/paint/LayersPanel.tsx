import {
  ArrowCounterClockwiseIcon,
  ArrowElbowDownRightIcon,
  ArrowLineDownIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  FolderIcon,
  FolderPlusIcon,
  CheckIcon,
  CircleHalfIcon,
  SelectionIcon,
  ShapesIcon,
  ShuffleIcon,
  SwapIcon,
  CopyIcon,
  DotsThreeIcon,
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

import checkerImg from "@/assets/layer-checker.png"

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
import {
  BLEND_MODES,
  engine,
  layerDepth,
  moveBlock,
  moveBlocks,
  outermostLayers,
  type BlendMode,
  type DropPlace,
  type LayerMeta,
} from "@/paint/engine"

const checker =
  "repeating-conic-gradient(#d9d9d4 0% 25%, #f1f1ee 0% 50%) 0 0 / 10px 10px"

/** Canvas size for a thumbnail: long edge `edge` device pixels, document's aspect. */
function thumbSize(aspect: number, edge: number) {
  return aspect >= 1
    ? { width: edge, height: Math.max(1, Math.round(edge / aspect)) }
    : { width: Math.max(1, Math.round(edge * aspect)), height: edge }
}

/** The layer's pixels, fitted inside the tile's thumbnail box. */
function LayerThumb({ layer, aspect }: { layer: LayerMeta; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { width, height } = thumbSize(aspect, 256)

  useEffect(() => {
    const c = ref.current
    const src = engine.getLayerCanvas(layer.id)
    if (!c || !src) return
    const ctx = c.getContext("2d")!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(src, 0, 0, c.width, c.height)
  }, [layer.id, layer.rev, width, height])

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className="absolute inset-0 size-full object-contain"
    />
  )
}

/** The layer's mask in greyscale: white shows the layer, black hides it. */
function MaskThumb({ layer, aspect }: { layer: LayerMeta; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { width, height } = thumbSize(aspect, 96)

  useEffect(() => {
    const c = ref.current
    const src = engine.getMaskCanvas(layer.id)
    if (!c || !src) return
    const ctx = c.getContext("2d")!
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(src, 0, 0, c.width, c.height)
  }, [layer.id, layer.maskRev, width, height])

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={cn("block size-full bg-black object-contain", layer.maskOff && "opacity-30")}
    />
  )
}

/** The small square buttons over a tile's thumbnail (the menu and the eye). */
const thumbButtonClass =
  "absolute top-[3px] z-10 grid size-[22px] place-items-center rounded-[6px] text-muted-foreground outline-none transition-[background-color,opacity] [&_svg]:size-[18px] focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
/** Their resting look; they fill in while the tile is hovered or active. */
const thumbButtonRest = "opacity-60 group-hover/tile:bg-muted group-hover/tile:opacity-100 group-hover/tile:shadow-sm"
const thumbButtonOn = "bg-muted opacity-100 shadow-sm"

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
    <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,oklch(0.42_0.09_250),oklch(0.42_0.11_340))] text-white/90">
      <SlidersHorizontalIcon className="size-6" />
    </div>
  )
}

function GroupThumb({ layer }: { layer: LayerMeta }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#26261f] text-white/80">
      <FolderIcon className="size-6" weight={layer.brushFx ? "fill" : "regular"} />
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
      <Slider
        bar
        label="Effect strength"
        className="@min-[190px]:hidden"
        min={0}
        max={1}
        value={layer.opacity}
        onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
      />
      {def.params.map((p) => {
        const v = fx.params[p.key] ?? p.value
        return (
          <div key={p.key} className="flex flex-wrap items-center gap-x-2">
            <span className="w-16 truncate text-[10px] text-muted-foreground uppercase @max-[189px]:basis-full">{p.label}</span>
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
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto text-[10px] text-muted-foreground">
          {layer.clip
            ? "Affects the layer below"
            : layer.parent
              ? "Affects everything below, where its group shows"
              : "Affects all layers below"}
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

export function AddEffectMenu({
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
  selection,
  layer,
  at,
  onClose,
  onRename,
}: {
  layer: LayerMeta
  selection: string[]
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
      {!layer.fx && !layer.group && item("Merge down", () => engine.mergeDown(layer.id))}
      {selection.length > 1
        ? item(`Group ${selection.length} layers`, () => engine.groupLayers(selection))
        : item("Group", () => engine.groupLayer(layer.id))}
      {layer.group && item("Ungroup", () => engine.ungroup(layer.id))}
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
  depth,
  selected,
  selection,
  onSelect,
  drop,
  dragged,
  onDragPointerDown,
}: {
  layer: LayerMeta
  active: boolean
  aspect: number
  editMask: boolean
  depth: number
  /** Part of a multi-layer selection. */
  selected: boolean
  /** Every selected layer, for the menu. */
  selection: string[]
  onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void
  /** Where a layer being dragged would land relative to this one. */
  drop?: DropPlace
  dragged: boolean
  onDragPointerDown: (e: React.PointerEvent) => void
}) {
  const thumb = layer.group ? (
    <GroupThumb layer={layer} />
  ) : layer.fx ? (
    <FxThumb />
  ) : (
    <>
      <div
        aria-hidden
        className="absolute inset-0 opacity-44"
        style={{ backgroundImage: `url(${checkerImg})`, backgroundSize: "40px 40px" }}
      />
      <LayerThumb layer={layer} aspect={aspect} />
    </>
  )
  // Only plain pixel layers have a blend mode to pick.
  const hasBlend = !layer.fx && !layer.group
  const onMask = active && editMask && !!layer.mask
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const press = useRef({ timer: 0, x: 0, y: 0 })
  const cancelPress = () => window.clearTimeout(press.current.timer)
  const blend = BLEND_MODES.find((b) => b.id === layer.blend)
  const fxDef = layer.fx ? getEffect(layer.fx.type) : undefined
  const modified = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey

  return (
    <div
      data-layer-row={layer.id}
      className={cn(
        "relative mb-1 rounded-xl border border-transparent bg-black/20",
        layer.group && "bg-white/6",
        selected && "border-primary/60 bg-primary/12",
        active && "border-primary bg-primary/25",
        dragged && "opacity-40",
        drop === "inside" && "border-primary ring-2 ring-primary"
      )}
      style={depth ? { marginLeft: Math.min(depth, 4) * 12 } : undefined}
    >
      {(drop === "above" || drop === "below") && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-primary",
            drop === "above" ? "-top-[3px]" : "-bottom-[3px]"
          )}
        />
      )}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={active || selected}
        aria-haspopup="menu"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          cancelPress()
          if (!selected) onSelect(e)
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        // Touch and pen have no right button: holding still opens the menu.
        onPointerDown={(e) => {
          onDragPointerDown(e)
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
          if (e.key === "Enter" && e.target === e.currentTarget) onSelect(e)
        }}
        // Three layouts by panel width: thumbnail only, + name and opacity,
        // + blend mode picker. See the @container on the panel.
        className="group/tile flex h-[84px] cursor-default items-stretch gap-1.5 rounded-xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring @min-[250px]:h-[108px]"
      >
        {/* The thumbnail is where touch drags start; elsewhere a touch scrolls the list. */}
        <div
          data-drag-handle
          style={{ touchAction: "none" }}
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-black @min-[190px]:max-w-32",
            layer.mask && active && !onMask && "border-white ring-1 ring-white",
            !layer.visible && "[&>canvas]:opacity-40 [&>div]:opacity-40"
          )}
        >
          {thumb}
          {layer.mask && (
            // With a mask, the thumbnail picks painting the layer itself.
            <button
              type="button"
              aria-label={layer.group ? "Group" : layer.fx ? "Adjustment" : "Paint on the layer"}
              title={layer.group ? "Group" : layer.fx ? "Adjustment" : "Paint on the layer"}
              aria-pressed={active && !onMask}
              onClick={(e) => {
                e.stopPropagation()
                if (modified(e)) return onSelect(e)
                engine.setActiveLayer(layer.id)
                engine.setEditMask(false)
              }}
              className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
          )}
          <button
            type="button"
            aria-label={`Actions for ${layer.name}`}
            title="Layer actions"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.left, y: r.bottom + 4 })
            }}
            className={cn(thumbButtonClass, "left-[3px]", active || menu ? thumbButtonOn : thumbButtonRest)}
          >
            <DotsThreeIcon weight="bold" />
          </button>
          <button
            type="button"
            aria-label={layer.visible ? "Hide layer" : "Show layer"}
            title={layer.visible ? "Hide layer" : "Show layer"}
            onClick={(e) => {
              e.stopPropagation()
              engine.setLayerProps(layer.id, { visible: !layer.visible })
            }}
            className={cn(thumbButtonClass, "right-[3px]", active || !layer.visible ? thumbButtonOn : thumbButtonRest)}
          >
            {layer.visible ? <EyeIcon /> : <EyeSlashIcon />}
          </button>
          {(layer.group || layer.clip) && (
            <div className="absolute bottom-[3px] left-[3px] z-10 flex gap-0.5">
              {layer.group && (
                <button
                  type="button"
                  aria-label={layer.collapsed ? "Expand group" : "Collapse group"}
                  aria-expanded={!layer.collapsed}
                  onClick={(e) => {
                    e.stopPropagation()
                    engine.setLayerProps(layer.id, { collapsed: !layer.collapsed }, false)
                  }}
                  className="grid size-[22px] place-items-center rounded-[6px] bg-muted text-muted-foreground shadow-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {layer.collapsed ? <CaretRightIcon className="size-3.5" /> : <CaretDownIcon className="size-3.5" />}
                </button>
              )}
              {layer.clip && !layer.group && (
                <span
                  title="Clipped to the layer below"
                  className="grid size-[22px] place-items-center rounded-[6px] bg-muted text-muted-foreground shadow-sm"
                >
                  <ArrowElbowDownRightIcon className="size-3.5" />
                </span>
              )}
            </div>
          )}
          {layer.mask && (
            <button
              type="button"
              title="Paint on the mask (Shift-click to disable it)"
              aria-label="Paint on the mask (Shift-click to disable it)"
              aria-pressed={onMask}
              onClick={(e) => {
                e.stopPropagation()
                if (e.metaKey || e.ctrlKey) return onSelect(e)
                if (e.shiftKey) {
                  engine.setLayerProps(layer.id, { maskOff: !layer.maskOff })
                  return
                }
                engine.setActiveLayer(layer.id)
                engine.setEditMask(true)
              }}
              className={cn(
                "absolute right-[3px] bottom-[3px] z-10 size-[42%] max-h-9 max-w-9 overflow-hidden rounded-[5px] border border-white/30 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                onMask && "border-white ring-1 ring-white"
              )}
            >
              <MaskThumb layer={layer} aspect={aspect} />
            </button>
          )}
        </div>

        <div className="hidden w-[87px] min-w-0 shrink-0 flex-col gap-0.5 @min-[190px]:flex @min-[250px]:w-auto @min-[250px]:min-w-[116px] @min-[250px]:flex-1">
          <div className="flex h-4 items-center @min-[250px]:h-7">
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
                className="truncate text-xs leading-4 font-medium text-foreground"
                title="Double-click to rename"
                onDoubleClick={() => setEditing(true)}
              >
                {layer.name}
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex min-w-0 items-center gap-1 text-[10px] leading-[14px] text-muted-foreground",
              hasBlend && !onMask && "@min-[250px]:hidden"
            )}
          >
            {layer.vector && <ShapesIcon className="size-3 shrink-0" weight="fill" aria-label="Vector layer" />}
            <span className="truncate">
              {onMask
                ? "Editing mask"
                : layer.group
                  ? layer.brushFx
                    ? "Effect group"
                    : "Group"
                  : layer.fx
                    ? (fxDef?.label ?? "Adjustment")
                    : (blend?.label ?? "Normal")}
            </span>
            {layer.alphaLock && <LockSimpleIcon className="size-3 shrink-0" weight="fill" aria-label="Alpha locked" />}
          </div>
          {hasBlend && !onMask && (
            <div className="relative hidden h-7 @min-[250px]:block">
              <select
                aria-label="Blend mode"
                value={layer.blend}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => engine.setLayerProps(layer.id, { blend: e.target.value as BlendMode })}
                className="size-full appearance-none rounded-lg border border-white/10 bg-black/30 pr-6 pl-2 text-[11px] leading-4 text-foreground outline-none hover:border-white/30 focus:border-ring"
              >
                {BLEND_MODES.map((b) => (
                  <option key={b.id} value={b.id} className="bg-neutral-900">
                    {b.label}
                  </option>
                ))}
              </select>
              <CaretDownIcon className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-foreground opacity-70" />
            </div>
          )}
          <div
            className="mt-auto"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Slider
              bar
              label={layer.fx ? "Effect strength" : layer.group ? "Group opacity" : "Layer opacity"}
              min={0}
              max={1}
              value={layer.opacity}
              onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
            />
          </div>
        </div>
      </div>

      {menu && (
        <LayerMenu layer={layer} selection={selected ? selection : [layer.id]} at={menu} onClose={() => setMenu(null)} onRename={() => setEditing(true)} />
      )}

      {active && fxDef && <FxControls layer={layer} def={fxDef} />}

      {active && layer.group && (
        <div className={cn("flex items-center justify-end gap-2 px-2 pt-0.5 pb-2", layer.mask && "@min-[190px]:hidden")}>
          <Slider
            bar
            label="Group opacity"
            className="flex-1 @min-[190px]:hidden"
            min={0}
            max={1}
            value={layer.opacity}
            onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
          />
          <AddMaskButton layer={layer} />
        </div>
      )}

      {active && !layer.fx && !layer.group && (
        <div className="flex flex-col gap-2 px-2 pt-0.5 pb-2">
          <div className="@min-[190px]:hidden">
            <Slider
              bar
              label="Layer opacity"
              min={0}
              max={1}
              value={layer.opacity}
              onChange={(v) => engine.setLayerProps(layer.id, { opacity: v }, false)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <select
              aria-label="Blend mode"
              value={layer.blend}
              onChange={(e) =>
                engine.setLayerProps(layer.id, { blend: e.target.value as BlendMode })
              }
              className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-1.5 text-[11px] text-foreground outline-none focus:border-ring @max-[249px]:basis-full @min-[250px]:hidden"
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
          {layer.group
            ? "Painting the mask: light colours (or the effect brush) show the group, dark colours hide it."
            : "Painting the mask: dark colours hide the layer, light colours reveal it."}
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
  // Layers folded away inside a collapsed group. Going down the stack from the
  // top, a group is always met before the layers inside it.
  const folded = new Set<string>()
  for (let i = s.layers.length - 1; i >= 0; i--) {
    const l = s.layers[i]
    const parent = l.parent && s.layers.find((p) => p.id === l.parent)
    if (parent && (parent.collapsed || folded.has(parent.id))) folded.add(l.id)
  }
  // Rows top to bottom, as shown.
  const rows = [...s.layers].reverse().filter((l) => !folded.has(l.id))

  // The layers picked with Cmd/Ctrl- and Shift-click. The active layer is
  // always among them; if it has changed elsewhere, the selection is just it.
  const [picked, setPicked] = useState<string[]>([])
  const selection = (() => {
    if (!picked.includes(id)) return id ? [id] : []
    const live = new Set(s.layers.map((l) => l.id))
    return picked.filter((p) => live.has(p))
  })()
  const selected = new Set(selection)

  const select = (layerId: string, e: React.MouseEvent | React.KeyboardEvent) => {
    if (e.shiftKey && id && !("key" in e)) {
      const a = rows.findIndex((l) => l.id === id)
      const b = rows.findIndex((l) => l.id === layerId)
      if (a >= 0 && b >= 0) {
        setPicked(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => l.id))
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      if (selected.has(layerId)) {
        const rest = selection.filter((p) => p !== layerId)
        if (!rest.length) return
        setPicked(rest)
        if (layerId === id) engine.setActiveLayer(rest[rest.length - 1])
      } else {
        setPicked([...selection, layerId])
        engine.setActiveLayer(layerId)
      }
      return
    }
    setPicked([layerId])
    engine.setActiveLayer(layerId)
  }

  const groupSelection = () => {
    const ids = outermostLayers(s.layers, selection)
    if (!ids.length) return
    engine.groupLayers(ids)
    setPicked([])
  }

  // ---- drag to reorder, or into a group ----
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{
    ids: string[]
    target: { id: string | null; place: DropPlace } | null
  } | null>(null)

  const beginDrag = (layerId: string, e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("input, select, [role=slider]")) return
    if (e.pointerType === "touch" && !(e.target as HTMLElement).closest("[data-drag-handle]")) return
    const ids = selected.has(layerId) ? outermostLayers(s.layers, selection) : [layerId]
    const start = { x: e.clientX, y: e.clientY }
    let started = false
    let target: { id: string | null; place: DropPlace } | null = null

    const aim = (x: number, y: number) => {
      const list = listRef.current
      if (!list) return null
      const box = list.getBoundingClientRect()
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null
      if (y < box.top + 20) list.scrollTop -= 8
      else if (y > box.bottom - 20) list.scrollTop += 8
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-layer-row]")
      const layers = engine.getState().layers
      let next: { id: string | null; place: DropPlace }
      if (!row || !list.contains(row)) {
        next = { id: null, place: "below" } // Past the last row: the bottom of the stack.
      } else {
        const over = layers.find((l) => l.id === row.dataset.layerRow)
        if (!over) return null
        const r = row.getBoundingClientRect()
        const f = (y - r.top) / r.height
        const place: DropPlace = over.group
          ? f < 0.3
            ? "above"
            : over.collapsed && f > 0.7
              ? "below"
              : "inside"
          : f < 0.5
            ? "above"
            : "below"
        next = { id: over.id, place }
      }
      return moveBlocks(layers, ids, next.id, next.place) ? next : null
    }

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
        started = true
      }
      target = aim(ev.clientX, ev.clientY)
      setDrag({ ids, target })
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      if (!started) return
      setDrag(null)
      // The click that ends a drag should not also select the row.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation()
        c.preventDefault()
      }
      window.addEventListener("click", swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0)
      if (ev.type === "pointerup" && target) engine.moveLayersTo(ids, target.id, target.place)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }

  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      {fxMenu && (
        <>
          <div data-popover className={cn(panelClass, "absolute inset-x-0 bottom-full z-50 mb-2 p-2 @max-[249px]:w-60 @max-[249px]:group-data-[side=l]/panel:right-auto @max-[249px]:group-data-[side=r]/panel:left-auto group-data-[tight]/panel:top-10 group-data-[tight]/panel:bottom-auto group-data-[tight]/panel:mb-0")}>
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
      <div className="flex flex-wrap items-center justify-end gap-0.5 px-2 pt-1.5 pb-1 @max-[189px]:justify-center">
        <h2 className="mr-auto pl-1 @max-[189px]:hidden text-xs font-semibold tracking-wide text-foreground uppercase">
          Layers
        </h2>
        <IconButton label="Move layer up" className="size-7" disabled={!moveBlock(s.layers, id, 1)} onClick={() => engine.moveLayer(id, 1)}>
          <CaretUpIcon />
        </IconButton>
        <IconButton label="Move layer down" className="size-7" disabled={!moveBlock(s.layers, id, -1)} onClick={() => engine.moveLayer(id, -1)}>
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
        <IconButton
          label={selection.length > 1 ? `Group ${selection.length} selected layers (Cmd/Ctrl+G)` : "New group"}
          className="size-7"
          active={selection.length > 1}
          onClick={() => (selection.length > 1 ? groupSelection() : engine.addGroup())}
        >
          <FolderPlusIcon />
        </IconButton>
        <IconButton label="New layer" className="size-7 bg-white/10 text-foreground" onClick={() => engine.addLayer()}>
          <PlusIcon />
        </IconButton>
      </div>

      <div
        ref={listRef}
        onKeyDown={(e) => {
          if (e.key.toLowerCase() !== "g" || !(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          if (e.shiftKey) {
            const active = s.layers.find((l) => l.id === id)
            if (active?.group) engine.ungroup(id)
          } else groupSelection()
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:thin]", drag && "select-none")}
      >
        {rows.map((l) => (
          <LayerRow
            key={l.id}
            layer={l}
            active={l.id === id}
            aspect={aspect}
            editMask={s.editMask}
            depth={layerDepth(s.layers, l)}
            selected={selected.has(l.id)}
            selection={selection}
            onSelect={(e) => select(l.id, e)}
            drop={drag?.target?.id === l.id ? drag.target.place : undefined}
            dragged={!!drag && drag.ids.includes(l.id)}
            onDragPointerDown={(e) => beginDrag(l.id, e)}
          />
        ))}
        {drag?.target && drag.target.id === null && (
          <div aria-hidden className="h-0.5 rounded-full bg-primary" />
        )}
        {/* Room below the last row to drop onto the bottom of the stack. */}
        <div className="h-8" />
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
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground @max-[189px]:invisible">Paper</span>
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
