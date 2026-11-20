import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DownloadSimple,
  FloppyDisk,
  Plus,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react"

import { panelClass, Slider } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { importBrushImage, invertBrushImage } from "@/paint/brush-image"
import {
  BRUSH_CATEGORIES,
  BRUSH_DEFAULTS,
  deleteCustomBrush,
  getBrush,
  MASK_BLENDS,
  maskBrush,
  PAINT_BLENDS,
  PIGMENT_TARGETS,
  STROKE_EFFECTS,
  type StrokeEffect,
  normalizeBrush,
  saveCustomBrush,
  type BrushCategory,
  type BrushLink,
  type BrushPreset,
  type LinkInput,
  type LinkTarget,
  type MaskBlend,
  type PaintBlend,
  type StrokeTextureKind,
  type TextureKind,
  type TipShape,
} from "@/paint/brushes"
import { hexToRgb, hsvToHex } from "@/paint/color"
import { engine, type PaintTool } from "@/paint/engine"
import { GPUBrush } from "@/paint/gpu-brush"
import { Stroke } from "@/paint/stroke"
import { uid } from "@/paint/util"
import { BrushPreview } from "./BrushPreview"

// ---- vocabulary --------------------------------------------------------------

const TIP_LABEL: Record<TipShape, string> = {
  round: "Round",
  flat: "Flat",
  bristle: "Bristle",
  grain: "Graphite",
  chalk: "Chalk",
  splatter: "Splatter",
  sponge: "Sponge",
  star: "Star",
  triangle: "Triangle",
  heart: "Heart",
  ring: "Ring",
  sparkle: "Sparkle",
  shard: "Shard",
  image: "Image…",
}

const TEXTURE_LABEL: Record<TextureKind, string> = {
  none: "None",
  paper: "Paper",
  rough: "Cold press",
  canvas: "Canvas",
  laid: "Laid",
  halftone: "Halftone",
  hatch: "Hatch",
  grit: "Grit",
  stripes: "Stripes",
  checker: "Checker",
  cells: "Tiles",
  image: "Image…",
}

const STROKE_LABEL: Record<StrokeTextureKind, string> = {
  none: "None",
  fibres: "Fibres",
  drybrush: "Dry brush",
  dashes: "Dashes",
  waves: "Waves",
  zigzag: "Zigzag",
  beads: "Beads",
  rope: "Rope",
  image: "Image…",
}

const BLEND_LABEL: Record<MaskBlend, string> = {
  multiply: "Multiply",
  subtract: "Subtract",
  darken: "Darken",
  lighten: "Lighten",
  screen: "Screen",
  overlay: "Overlay",
  difference: "Difference",
  height: "Height (pressure)",
}

const PAINT_BLEND_LABEL: Record<PaintBlend, string> = {
  normal: "Opaque",
  glaze: "Glaze",
  glow: "Glow",
  invert: "Invert",
}

const EFFECT_LABEL: Record<StrokeEffect, string> = {
  none: "None",
  pixel: "Pixel",
  outline: "Outline",
  sticker: "Sticker",
  chroma: "Colour split",
  glitch: "Glitch",
  mosaic: "Mosaic",
}

const EFFECT_HINT: Record<StrokeEffect, string> = {
  none: "The stroke is drawn as the stamp lays it down.",
  pixel: "Snaps the stroke to chunky, hard-edged blocks.",
  outline: "Draws only the rim of the stroke, so overlapping passes merge into one hollow shape.",
  sticker: "Adds a white border and a soft shadow, like a die-cut sticker.",
  chroma: "Slides the red and blue channels apart, like a misprinted comic.",
  glitch: "Tears the stroke into rows that jump sideways.",
  mosaic: "Breaks the stroke into irregular tiles with dark lines between them.",
}

const INPUT_LABEL: Record<LinkInput, string> = {
  pressure: "Pressure",
  speed: "Speed",
  tilt: "Tilt",
  fade: "Fade (distance)",
  random: "Random",
}

const TARGET_LABEL: Record<LinkTarget, string> = {
  size: "Size",
  flow: "Flow",
  load: "Paint load (blend ↔ paint)",
  wet: "Wetness",
  texture: "Texture depth",
  roundness: "Roundness",
  scatter: "Scatter",
  angle: "Angle",
  hue: "Hue",
  sat: "Saturation",
  lum: "Luminance",
  mix2: "Secondary colour",
}

/** Starting points for a medium: only the properties that define it. */
const MEDIA: { name: string; hint: string; patch: Partial<BrushPreset> }[] = [
  {
    name: "Dry",
    hint: "Pencil, chalk, pastel: sits on the ridges of the paper",
    patch: {
      paintBlend: "normal", wetness: 0, drip: 0, pickup: 0, relief: 0,
      granulation: 0, feather: 0, pigmentVariation: 0,
      texture: "paper", textureBlend: "height", grain: 0.7,
    },
  },
  {
    name: "Oil",
    hint: "Thick, glossy, picks up and drags the paint beneath it",
    patch: {
      paintBlend: "normal", wetness: 0, drip: 0, pickup: 0.55, relief: 0.75,
      gloss: 0.65, depletion: 0.35, granulation: 0, feather: 0, pigmentVariation: 0,
      texture: "canvas", textureBlend: "height", grain: 0.2,
    },
  },
  {
    name: "Watercolour",
    hint: "A transparent wash that bleeds, granulates and dries to a dark rim",
    patch: {
      paintBlend: "glaze", wetness: 0.7, bleed: 0.5, edgeDarken: 0.65,
      granulation: 0.4, feather: 0.35, pigmentVariation: 0.4, dryTime: 0.5,
      pickup: 0, relief: 0, drip: 0, flow: 0.12,
      texture: "rough", textureBlend: "height", grain: 0.12,
    },
  },
  {
    name: "Gouache",
    hint: "Opaque and matte, softens into what is beneath it",
    patch: {
      paintBlend: "normal", wetness: 0.1, bleed: 0.3, edgeDarken: 0.2, pickup: 0.3,
      relief: 0.1, gloss: 0.1, granulation: 0, feather: 0, pigmentVariation: 0.15,
      drip: 0, texture: "paper", textureBlend: "height", grain: 0.15,
    },
  },
  {
    name: "Ink",
    hint: "Flat, saturated and hard-edged, with a little bleed",
    patch: {
      paintBlend: "normal", wetness: 0.12, bleed: 0.3, edgeDarken: 0.4, pickup: 0,
      relief: 0, granulation: 0, feather: 0.1, pigmentVariation: 0, drip: 0, grain: 0,
    },
  },
]

const LINK_RECIPES: { name: string; links: BrushLink[]; patch?: Partial<BrushPreset> }[] = [
  {
    name: "Light pressure blends, heavy paints",
    links: [{ input: "pressure", target: "load", amount: 1, curve: 1.6 }],
  },
  {
    name: "Tilt flattens and widens the tip",
    links: [
      { input: "tilt", target: "roundness", amount: -0.7, curve: 1 },
      { input: "tilt", target: "size", amount: -0.6, curve: 1 },
    ],
  },
  {
    name: "Fast strokes thin out",
    links: [
      { input: "speed", target: "size", amount: -0.5, curve: 1 },
      { input: "speed", target: "flow", amount: -0.5, curve: 1 },
    ],
  },
  {
    name: "Stroke fades out",
    links: [{ input: "fade", target: "flow", amount: -1, curve: 1 }],
  },
  {
    name: "Pressure shifts hue and lightens",
    links: [
      { input: "pressure", target: "hue", amount: 0.15, curve: 1 },
      { input: "pressure", target: "lum", amount: 0.3, curve: 1 },
    ],
  },
  {
    name: "Pressure wets the brush",
    links: [{ input: "pressure", target: "wet", amount: 0.8, curve: 1 }],
  },
]

// ---- controls ----------------------------------------------------------------

interface Editing {
  brush: BrushPreset
  set: (patch: Partial<BrushPreset>) => void
  /**
   * The brush is for the effect brush, which only paints a mask: settings
   * that act on pigment would do nothing, so they are left out.
   */
  mask: boolean
}

const EditingContext = createContext<Editing | null>(null)

function useEditing(): Editing {
  const editing = useContext(EditingContext)
  if (!editing) throw new Error("Brush control used outside the studio")
  return editing
}

type NumKey = {
  [K in keyof BrushPreset]-?: BrushPreset[K] extends number ? K : never
}[keyof BrushPreset]

const fieldClass =
  "h-7 min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 text-[11px] text-foreground outline-none focus:border-ring"

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3" title={hint}>
      <span className="w-32 shrink-0 truncate text-[11.5px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Num({
  k,
  label,
  min,
  max,
  hint,
  whole,
}: {
  k: NumKey
  label: string
  min: number
  max: number
  hint?: string
  whole?: boolean
}) {
  const { brush, set } = useEditing()
  const value = brush[k]
  return (
    <Row label={label} hint={hint}>
      <Slider
        label={label}
        className="min-w-0 flex-1"
        min={min}
        max={max}
        value={value}
        onChange={(v) => set({ [k]: whole ? Math.round(v) : Math.round(v * 100) / 100 })}
      />
      <span className="w-9 shrink-0 text-right text-[10.5px] text-foreground tabular-nums">
        {whole ? Math.round(value) : value.toFixed(2)}
      </span>
    </Row>
  )
}

function Chips<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full bg-white/6 px-2.5 py-1 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            o === value && "bg-primary text-primary-foreground hover:text-primary-foreground"
          )}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  )
}

function Pick<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  labels: Record<T, string>
  onChange: (value: T) => void
}) {
  return (
    <Row label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(fieldClass, "flex-1")}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-neutral-900">
            {labels[o]}
          </option>
        ))}
      </select>
    </Row>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-7 items-center gap-2 text-[11.5px] text-muted-foreground">
      <input
        type="checkbox"
        className="accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-foreground/80 uppercase">
        {title}
      </h3>
      {hint && <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
      <div className="mt-1.5 flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

/** Picks, shows and inverts the raster image behind a stamp or texture. */
function ImageSlot({
  value,
  mode,
  onChange,
}: {
  value: string
  mode: "stamp" | "tile"
  onChange: (url: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")

  const load = async (file: File | undefined) => {
    if (!file) return
    try {
      onChange(await importBrushImage(file, mode))
      setError("")
    } catch {
      setError("That file could not be read as an image.")
    }
  }

  return (
    <div className="my-1 flex items-center gap-3 rounded-xl bg-black/25 p-2">
      <div
        className="size-16 shrink-0 rounded-lg border border-white/10 bg-black bg-contain bg-center bg-no-repeat"
        style={value ? { backgroundImage: `url(${value})` } : undefined}
        role="img"
        aria-label={value ? "Current image" : "No image chosen"}
      />
      <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        <p className="mb-1.5 leading-snug">
          {mode === "stamp"
            ? "White marks, black does not. Transparent PNGs and dark-on-light drawings are converted for you."
            : "A greyscale tile that repeats across the canvas; white is the raised part."}
        </p>
        <div className="flex gap-1.5">
          <button type="button" className={buttonClass} onClick={() => input.current?.click()}>
            <UploadSimple /> {value ? "Replace" : "Choose image"}
          </button>
          {value && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => void invertBrushImage(value).then(onChange)}
            >
              Invert
            </button>
          )}
        </div>
        {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void load(e.target.files?.[0])
          e.target.value = ""
        }}
      />
    </div>
  )
}

const buttonClass =
  "inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/8 px-2.5 text-[11px] font-medium text-foreground outline-none hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"

// ---- sections ----------------------------------------------------------------

const TIP_ORDER: TipShape[] = ["round", "flat", "bristle", "grain", "chalk", "splatter", "sponge", "star", "image"]

function StampSection() {
  const { brush, set } = useEditing()
  return (
    <>
      <Group title="Stamp" hint="The shape pressed onto the canvas with every dab.">
        <Chips label="Stamp shape" value={brush.tip} options={TIP_ORDER} labels={TIP_LABEL} onChange={(tip) => set({ tip })} />
        {brush.tip === "image" && (
          <ImageSlot value={brush.tipImage} mode="stamp" onChange={(tipImage) => set({ tipImage })} />
        )}
      </Group>
      <Group title="Shape">
        {brush.tip !== "image" && <Num k="hardness" label="Hardness" min={0} max={1} />}
        {(brush.tip === "bristle" || brush.dual === "bristle") && (
          <Num k="bristles" label="Bristle count" min={6} max={80} whole />
        )}
        <Num k="roundness" label="Roundness" min={0.1} max={1} />
        <Num k="angle" label="Angle" min={-180} max={180} whole />
        <Check label="Rotate to follow the stroke" checked={brush.followDirection} onChange={(followDirection) => set({ followDirection })} />
      </Group>
      <Group title="Laying down">
        <Num k="spacing" label="Spacing" min={0.02} max={1.5} hint="Distance between dabs, in brush diameters" />
        <Num k="flow" label="Flow" min={0.01} max={1} hint="How much each dab adds" />
        <Num k="size" label="Default size" min={1} max={400} whole />
        <Num k="opacity" label="Default opacity" min={0.05} max={1} />
        <Num k="streamline" label="Stabiliser" min={0} max={1} />
      </Group>
    </>
  )
}

function DualSection() {
  const { brush, set } = useEditing()
  const on = brush.dual !== "none"
  return (
    <>
      <Group
        title="Dual stamp"
        hint="A second shape inside every dab, combined with the stamp through a blend mode. Try a round stamp cut by splatter, or a bristle tip lightened by a sponge."
      >
        <Chips
          label="Second stamp shape"
          value={brush.dual}
          options={["none", ...TIP_ORDER] as const}
          labels={{ none: "None", ...TIP_LABEL }}
          onChange={(dual) => set({ dual })}
        />
        {brush.dual === "image" && (
          <ImageSlot value={brush.dualImage} mode="stamp" onChange={(dualImage) => set({ dualImage })} />
        )}
      </Group>
      {on && (
        <Group title="Mix">
          <Pick label="Blend mode" value={brush.dualBlend} options={MASK_BLENDS} labels={BLEND_LABEL} onChange={(dualBlend) => set({ dualBlend })} />
          <Num k="dualDepth" label="Depth" min={0} max={1} />
          <Num k="dualScale" label="Scale" min={0.2} max={3} hint="Size of the second stamp relative to the first" />
          <Num k="dualRotate" label="Rotation jitter" min={0} max={1} />
          <Num k="dualOffset" label="Offset jitter" min={0} max={1} />
        </Group>
      )}
    </>
  )
}

const TEXTURE_ORDER: TextureKind[] = ["none", "paper", "rough", "canvas", "laid", "halftone", "hatch", "grit", "image"]

function TextureSection() {
  const { brush, set } = useEditing()
  return (
    <>
      <Group
        title="Canvas texture"
        hint="A pattern fixed to the page. Every dab sees the same surface, so texture builds up where you go over it instead of smearing."
      >
        <Chips label="Canvas texture" value={brush.texture} options={TEXTURE_ORDER} labels={TEXTURE_LABEL} onChange={(texture) => set({ texture, grain: texture !== "none" && brush.grain === 0 ? 0.6 : brush.grain })} />
        {brush.texture === "image" && (
          <ImageSlot value={brush.textureImage} mode="tile" onChange={(textureImage) => set({ textureImage })} />
        )}
      </Group>
      {brush.texture !== "none" && (
        <Group title="Mix">
          <Pick label="Blend mode" value={brush.textureBlend} options={MASK_BLENDS} labels={BLEND_LABEL} onChange={(textureBlend) => set({ textureBlend })} />
          <Num k="grain" label="Depth" min={0} max={1} />
          <Num k="grainScale" label="Scale" min={0.3} max={4} />
          <Check label="Invert" checked={brush.textureInvert} onChange={(textureInvert) => set({ textureInvert })} />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
            Height treats the texture as relief: a light touch only catches the ridges and
            pressing harder pushes paint down into the valleys.
          </p>
        </Group>
      )}
    </>
  )
}

const STROKE_ORDER: StrokeTextureKind[] = ["none", "fibres", "drybrush", "dashes", "waves", "image"]

function StrokeSection() {
  const { brush, set } = useEditing()
  return (
    <>
      <Group
        title="Stroke texture"
        hint="A pattern that travels with the stroke: it runs along the path and spans its width, so streaks bend round curves."
      >
        <Chips label="Stroke texture" value={brush.strokeTex} options={STROKE_ORDER} labels={STROKE_LABEL} onChange={(strokeTex) => set({ strokeTex })} />
        {brush.strokeTex === "image" && (
          <ImageSlot value={brush.strokeImage} mode="tile" onChange={(strokeImage) => set({ strokeImage })} />
        )}
      </Group>
      {brush.strokeTex !== "none" && (
        <Group title="Mix">
          <Pick label="Blend mode" value={brush.strokeBlend} options={MASK_BLENDS} labels={BLEND_LABEL} onChange={(strokeBlend) => set({ strokeBlend })} />
          <Num k="strokeDepth" label="Depth" min={0} max={1} />
          <Num k="strokeScale" label="Scale" min={0.2} max={4} hint="Length of the pattern along the stroke" />
          <Check label="Invert" checked={brush.strokeInvert} onChange={(strokeInvert) => set({ strokeInvert })} />
        </Group>
      )}
    </>
  )
}

function MediaSection() {
  const { brush, set, mask } = useEditing()
  const effects = mask ? STROKE_EFFECTS.filter((e) => e !== "chroma") : STROKE_EFFECTS
  return (
    <>
      {!mask && <Group title="Start from a medium" hint="Sets the paint behaviour below and leaves the stamp and dynamics alone.">
        <div className="flex flex-wrap gap-1">
          {MEDIA.map((m) => (
            <button key={m.name} type="button" title={m.hint} className={buttonClass} onClick={() => set(m.patch)}>
              {m.name}
            </button>
          ))}
        </div>
      </Group>}
      {!mask && <Group title="On the surface">
        <div className="mb-1">
          <Chips
            label="How paint sits on what is beneath"
            value={brush.paintBlend}
            options={PAINT_BLENDS}
            labels={PAINT_BLEND_LABEL}
            onChange={(paintBlend) => set({ paintBlend })}
          />
        </div>
        <p className="mb-1 text-[11px] leading-snug text-muted-foreground/80">
          {brush.paintBlend === "glaze"
            ? "Transparent, like watercolour: layers darken and tint what is under them."
            : brush.paintBlend === "glow"
              ? "Adds light to what is under it. Best over dark paint."
              : brush.paintBlend === "invert"
                ? "Turns what is under it into its negative, whatever colour is picked."
                : "Covers what is under it."}
        </p>
      </Group>}
      <Group title="Stroke effect" hint="Redraws the whole stroke after the stamps have been laid down.">
        <div className="mb-1">
          <Chips
            label="Stroke effect"
            value={brush.effect}
            options={effects}
            labels={EFFECT_LABEL}
            onChange={(effect) => set({ effect })}
          />
        </div>
        <p className="mb-1 text-[11px] leading-snug text-muted-foreground/80">{EFFECT_HINT[brush.effect]}</p>
        {brush.effect !== "none" && (
          <Num k="effectAmount" label="Effect size" min={0.02} max={1} hint="Block, line or offset size relative to the brush" />
        )}
      </Group>
      {mask ? (
        <Group title="Load" hint="How long a stroke keeps revealing the effect.">
          <Num k="depletion" label="Runs dry" min={0} max={1} hint="How quickly the brush runs out along a stroke" />
        </Group>
      ) : (
        <Group title="Oil & impasto" hint="Thick paint that mixes on the canvas.">
          <Num k="pickup" label="Colour pickup" min={0} max={1} hint="How much the tip takes up from the canvas and drags along" />
          <Num k="relief" label="Thickness" min={0} max={1} hint="Raised ridges, lit from the upper left" />
          <Num k="gloss" label="Gloss" min={0} max={1} hint="Shine of thick paint; needs some thickness" />
          <Num k="depletion" label="Runs dry" min={0} max={1} hint="How quickly the brush runs out along a stroke" />
        </Group>
      )}
      <Group
        title="Watercolour & wet media"
        hint={mask ? "A wet edge: the revealed area keeps spreading after the stroke." : "Paint that keeps moving after it is laid down."}
      >
        <Num k="wetness" label="Wetness" min={0} max={1} hint="How much water the brush carries" />
        <Num k="bleed" label="Bleed" min={0} max={1} hint="How far wet paint creeps outwards" />
        <Num k="edgeDarken" label="Edge darkening" min={0} max={1} hint="Pigment gathering at the rim as a wash dries" />
        <Num k="feather" label="Feathering" min={0} max={1} hint="Ragged, blooming fronts" />
        <Num k="granulation" label="Granulation" min={0} max={1} hint="Pigment settling into the hollows of the paper" />
        <Num k="pigmentVariation" label="Pigment variation" min={0} max={1} hint="Uneven density across a wash" />
        <Num k="dryTime" label="Drying time" min={0} max={1} hint="How long the paint keeps moving" />
        <Num k="drip" label="Drips" min={0} max={1} hint="Paint heavy enough to run down the canvas" />
        {brush.wetness === 0 && brush.drip === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground/80">Raise wetness to bring these to life.</p>
        )}
      </Group>
    </>
  )
}

function LinkCurve({ link }: { link: BrushLink }) {
  // The response of the driven property across the input's range.
  const pts = Array.from({ length: 17 }, (_, i) => {
    const x = i / 16
    const v = Math.pow(x, link.curve || 1)
    const m = link.amount >= 0 ? 1 - link.amount * (1 - v) : 1 + link.amount * v
    return `${2 + x * 28},${22 - Math.min(1, Math.max(0, m)) * 20}`
  })
  return (
    <svg viewBox="0 0 32 24" className="h-6 w-8 shrink-0 rounded bg-black/30" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function DynamicsSection() {
  const { brush, set, mask } = useEditing()
  const links = brush.links
  const usable = (t: LinkTarget) => !mask || !PIGMENT_TARGETS.includes(t)
  const recipes = LINK_RECIPES.filter((r) => r.links.every((l) => usable(l.target)))
  const update = (i: number, patch: Partial<BrushLink>) =>
    set({ links: links.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  return (
    <>
      <Group title="Pressure">
        <Num k="sizePressure" label="Pressure → size" min={0} max={1} />
        <Num k="minSize" label="Minimum size" min={0.01} max={1} />
        <Num k="flowPressure" label="Pressure → flow" min={0} max={1} />
        <Num k="pressureCurve" label="Pressure curve" min={0.25} max={3} hint="Below 1 responds to a lighter touch" />
      </Group>
      <Group
        title="Links"
        hint="Drive any property from pressure, speed, tilt, distance or chance. A positive amount lowers the property as the input falls; a negative one lowers it as the input rises."
      >
        {links.map((l, i) => (
          <div key={i} className="mb-1.5 rounded-xl bg-black/25 p-2">
            <div className="flex items-center gap-1.5">
              <select aria-label="Input" value={l.input} onChange={(e) => update(i, { input: e.target.value as LinkInput })} className={cn(fieldClass, "w-32")}>
                {(Object.keys(INPUT_LABEL) as LinkInput[]).map((k) => (
                  <option key={k} value={k} className="bg-neutral-900">{INPUT_LABEL[k]}</option>
                ))}
              </select>
              <span className="text-muted-foreground" aria-hidden>→</span>
              <select aria-label="Property" value={l.target} onChange={(e) => update(i, { target: e.target.value as LinkTarget })} className={cn(fieldClass, "flex-1")}>
                {(Object.keys(TARGET_LABEL) as LinkTarget[]).filter((k) => usable(k) || k === l.target).map((k) => (
                  <option key={k} value={k} className="bg-neutral-900">{TARGET_LABEL[k]}</option>
                ))}
              </select>
              <LinkCurve link={l} />
              <button type="button" aria-label="Remove link" title="Remove link" className={cn(buttonClass, "px-1.5")} onClick={() => set({ links: links.filter((_, j) => j !== i) })}>
                <Trash />
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                Amount
                <Slider label="Amount" className="min-w-0 flex-1" min={-1} max={1} value={l.amount} onChange={(v) => update(i, { amount: Math.round(v * 20) / 20 })} />
                <span className="w-8 text-right text-foreground tabular-nums">{l.amount.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                Curve
                <Slider label="Curve" className="min-w-0 flex-1" min={0.25} max={4} exp={2} value={l.curve} onChange={(v) => update(i, { curve: Math.round(v * 20) / 20 })} />
                <span className="w-8 text-right text-foreground tabular-nums">{l.curve.toFixed(2)}</span>
              </label>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={buttonClass} onClick={() => set({ links: [...links, { input: "pressure", target: "flow", amount: 0.5, curve: 1 }] })}>
            <Plus /> Add link
          </button>
          <select
            aria-label="Add a recipe"
            value=""
            onChange={(e) => {
              const recipe = recipes.find((r) => r.name === e.target.value)
              if (recipe) {
                set({
                  links: [...links, ...recipe.links],
                  // Paint load only shows on a brush that mixes with the canvas.
                  ...(recipe.links.some((l) => l.target === "load") && brush.pickup < 0.3 ? { pickup: 0.5 } : {}),
                })
              }
            }}
            className={cn(fieldClass, "flex-1")}
          >
            <option value="" className="bg-neutral-900">Add a recipe…</option>
            {LINK_RECIPES.map((r) => (
              <option key={r.name} value={r.name} className="bg-neutral-900">{r.name}</option>
            ))}
          </select>
        </div>
        {links.some((l) => l.input === "fade") && (
          <div className="mt-1.5">
            <Num k="fadeLength" label="Fade length" min={1} max={80} whole hint="Brush diameters over which the fade input runs from 0 to 1" />
          </div>
        )}
      </Group>
      <Group title="Jitter" hint="Chance, per dab.">
        <Num k="scatter" label="Scatter" min={0} max={2} />
        <Num k="sizeJitter" label="Size" min={0} max={0.95} />
        <Num k="flowJitter" label="Flow" min={0} max={1} />
        <Num k="angleJitter" label="Rotation" min={0} max={1} />
      </Group>
    </>
  )
}

function ColourSection() {
  return (
    <>
      <Group title="Every stamp" hint="Each dab gets its own shift from the colour you picked.">
        <Num k="hueJitter" label="Hue" min={0} max={1} hint="1 covers the whole colour wheel" />
        <Num k="satJitter" label="Saturation" min={0} max={1} />
        <Num k="lumJitter" label="Luminance" min={0} max={1} />
        <Num k="secondaryMix" label="Secondary colour" min={0} max={1} hint="Mixes in a random amount of the previous colour (swap with X)" />
      </Group>
      <Group title="Every stroke" hint="One shift chosen when the pen touches down: good for foliage, hair and impressionist dabs.">
        <Num k="strokeHueJitter" label="Hue" min={0} max={1} />
        <Num k="strokeSatJitter" label="Saturation" min={0} max={1} />
        <Num k="strokeLumJitter" label="Luminance" min={0} max={1} />
      </Group>
      <Group title="Along the stroke">
        <Num k="hueCycle" label="Hue cycle" min={-2} max={2} hint="Hue turns steadily with distance; 1 is a full rainbow every 8 brush widths" />
      </Group>
      <p className="text-[11px] leading-snug text-muted-foreground/80">
        Hue, saturation, luminance and the secondary colour can also follow pressure, speed or
        tilt: add a link under Dynamics. For light effects set the paint to Glow under Media.
      </p>
    </>
  )
}

const SECTIONS = [
  ["Stamp", StampSection],
  ["Dual stamp", DualSection],
  ["Texture", TextureSection],
  ["Stroke", StrokeSection],
  ["Media", MediaSection],
  ["Dynamics", DynamicsSection],
  ["Colour", ColourSection],
] as const

/** Whether a section departs from a plain brush, for the dot in the nav. */
function sectionActive(name: string, b: BrushPreset): boolean {
  switch (name) {
    case "Dual stamp":
      return b.dual !== "none" && b.dualDepth > 0
    case "Texture":
      return b.texture !== "none" && b.grain > 0
    case "Stroke":
      return b.strokeTex !== "none" && b.strokeDepth > 0
    case "Media":
      return b.wetness > 0 || b.pickup > 0 || b.relief > 0 || b.drip > 0 || b.paintBlend !== "normal" || b.effect !== "none"
    case "Dynamics":
      return b.links.length > 0
    case "Colour":
      return (
        b.hueJitter + b.satJitter + b.lumJitter + b.secondaryMix + b.strokeHueJitter +
          b.strokeSatJitter + b.strokeLumJitter > 0 || b.hueCycle !== 0
      )
    default:
      return false
  }
}

// ---- scratch pad -------------------------------------------------------------

const PAD_W = 560
const PAD_H = 320

/** A small canvas for trying the brush, drawn by the real brush shaders. */
function ScratchPad({ brush, size, opacity }: { brush: BrushPreset; size: number; opacity: number }) {
  const s = useEngine()
  const canvas = useRef<HTMLCanvasElement>(null)
  const gpu = useRef<GPUBrush | null>(null)
  const live = useRef<{ stroke: Stroke | null; settle: number; raf: number; pressure: number; x: number; y: number }>({
    stroke: null,
    settle: 0,
    raf: 0,
    pressure: 0.75,
    x: 0,
    y: 0,
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const state = live.current
    GPUBrush.create(() => {})
      .then((renderer) => {
        if (cancelled) renderer.device.destroy()
        else gpu.current = renderer
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      cancelAnimationFrame(state.raf)
      gpu.current?.device.destroy()
      gpu.current = null
    }
  }, [])

  useEffect(() => {
    void gpu.current?.preload(brush)
  }, [brush])

  /** Copies the renderer's view of the pad, stroke included, onto the pad. */
  const show = () => {
    const ctx = canvas.current?.getContext("2d")
    if (!ctx || !gpu.current) return
    ctx.globalCompositeOperation = "copy"
    ctx.drawImage(gpu.current.canvas, 0, 0)
    ctx.globalCompositeOperation = "source-over"
  }

  const tick = () => {
    const state = live.current
    const renderer = gpu.current
    state.raf = 0
    if (!renderer) return
    if (state.stroke) {
      renderer.frame()
      show()
      if (renderer.wet) state.raf = requestAnimationFrame(tick)
    } else if (state.settle > 0) {
      state.settle--
      renderer.frame(state.settle > 0)
      show()
      if (state.settle > 0) state.raf = requestAnimationFrame(tick)
    }
  }
  const schedule = () => {
    if (!live.current.raf) live.current.raf = requestAnimationFrame(tick)
  }

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * PAD_W, ((e.clientY - r.top) / r.height) * PAD_H]
  }
  const extra = (e: React.PointerEvent) => ({
    tilt: e.pointerType === "pen" ? Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 60) : 0,
    time: e.timeStamp,
  })
  const pressure = (e: React.PointerEvent) =>
    e.pointerType === "pen" ? Math.max(0.02, e.pressure) : live.current.pressure

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = gpu.current
    const state = live.current
    if (!renderer || !canvas.current || e.button !== 0) return
    // Paint still settling from the last stroke is fixed where it stands.
    if (state.settle > 0) {
      state.settle = 0
      renderer.frame(false)
      show()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const rgb = (hex: string) => {
      const c = hexToRgb(hex) ?? [0, 0, 0]
      return [c[0] / 255, c[1] / 255, c[2] / 255] as [number, number, number]
    }
    try {
      renderer.begin({
        width: PAD_W,
        height: PAD_H,
        source: canvas.current,
        brush,
        color: rgb(hsvToHex(s.color)),
        color2: rgb(hsvToHex(s.prevColor)),
        size,
        opacity,
        seed: Math.random() * 1000,
        mode: "paint",
      })
    } catch {
      return
    }
    const [x, y] = at(e)
    state.pressure = 0.75
    state.x = x
    state.y = y
    state.stroke = new Stroke((dab) => renderer.dab(dab), brush, {
      size,
      streamline: brush.streamline,
    })
    state.stroke.add(x, y, pressure(e), extra(e))
    schedule()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = live.current
    if (!state.stroke) return
    const [x, y] = at(e)
    // Mice have no pressure, so a slow hand presses and a fast one skims.
    const moved = Math.hypot(x - state.x, y - state.y)
    state.pressure += (Math.min(1, Math.max(0.3, 1.15 - moved / 42)) - state.pressure) * 0.22
    state.x = x
    state.y = y
    state.stroke.add(x, y, pressure(e), extra(e))
    schedule()
  }

  const up = () => {
    const state = live.current
    const renderer = gpu.current
    if (!state.stroke || !renderer) return
    state.stroke.end()
    state.stroke = null
    state.settle = renderer.settleFrames + 1
    schedule()
  }

  const clear = () => {
    const state = live.current
    state.stroke = null
    state.settle = 0
    canvas.current?.getContext("2d")?.clearRect(0, 0, PAD_W, PAD_H)
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#f3f0e8]">
      <canvas
        ref={canvas}
        width={PAD_W}
        height={PAD_H}
        aria-label="Scratch pad: draw here to try the brush"
        className="block w-full touch-none cursor-crosshair"
        style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <span className="pointer-events-none absolute top-1.5 left-2.5 text-[10.5px] font-medium text-black/40">
        {failed ? "The scratch pad needs WebGPU" : "Scratch pad: draw here"}
      </span>
      <button
        type="button"
        onClick={clear}
        className="absolute top-1.5 right-1.5 rounded-md bg-black/10 px-2 py-0.5 text-[10.5px] font-medium text-black/60 outline-none hover:bg-black/20 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Clear
      </button>
    </div>
  )
}

// ---- the overlay -------------------------------------------------------------

export function BrushStudio({ tool, onClose }: { tool: PaintTool; onClose: () => void }) {
  const s = useEngine()
  const settings = s.toolSettings[tool]
  const edits = settings.dynamics ?? {}
  const base = getBrush(settings.brushId)
  const brush: BrushPreset = { ...base, ...edits }
  const edited = Object.keys(edits).length > 0
  const [section, setSection] = useState<string>("Stamp")
  const [message, setMessage] = useState("")
  const importInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [onClose])

  const set = (patch: Partial<BrushPreset>) =>
    engine.setToolSettings(tool, { dynamics: { ...edits, ...patch } })

  const store = (b: BrushPreset, done: string) => {
    if (saveCustomBrush(b)) {
      // Picking a brush resets size and opacity to its defaults; keep the
      // ones being tested with.
      const { size, opacity } = settings
      engine.selectBrush(tool, b.id)
      engine.setToolSettings(tool, { size, opacity })
      setMessage(done)
    } else {
      setMessage("Not saved: browser storage is full. Remove a brush with images and try again.")
    }
  }

  const saveNew = () => {
    const name = brush.name === base.name && !base.custom ? `${brush.name} (mine)` : brush.name
    store({ ...brush, id: uid("custom"), name, custom: true }, `Saved “${name}” to your brushes.`)
  }

  const exportBrush = () => {
    const { custom: _custom, ...data } = brush
    void _custom
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ pigmentBrush: 1, brush: data }, null, 2)], { type: "application/json" })
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `${brush.name.replace(/[^\w-]+/g, "-").toLowerCase() || "brush"}.pigmentbrush.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importBrush = async (file: File | undefined) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      const raw = data?.brush ?? data
      if (!raw || typeof raw !== "object" || typeof raw.name !== "string") throw new Error("not a brush")
      // Only take properties a brush has, with the types a brush expects.
      const clean: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(BRUSH_DEFAULTS)) {
        if (typeof raw[k] === typeof v && Array.isArray(raw[k]) === Array.isArray(v)) clean[k] = raw[k]
      }
      const b = normalizeBrush({ ...clean, name: raw.name.slice(0, 60), category: raw.category })
      store({ ...b, id: uid("custom"), custom: true }, `Imported “${b.name}”.`)
    } catch {
      setMessage("That file is not a Pigment brush.")
    }
  }

  const mask = tool === "fx"
  // What the tool will really paint with: the effect brush ignores pigment.
  const shown = mask ? maskBrush(brush) : brush
  const Section =
    SECTIONS.find(([name]) => name === section && !(mask && name === "Colour"))?.[1] ?? StampSection

  return (
    <div
      data-modal
      className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Brush studio"
        tabIndex={-1}
        className={cn(panelClass, "flex h-[min(760px,100%)] w-[min(1120px,100%)] flex-col overflow-hidden outline-none select-none")}
      >
        <header className="flex flex-wrap items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <h2 className="mr-1 text-sm font-semibold">{mask ? "Effect brush studio" : "Brush studio"}</h2>
          <input
            aria-label="Brush name"
            value={brush.name}
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
            className={cn(fieldClass, "w-48 select-text")}
          />
          <select
            aria-label="Category"
            value={brush.category}
            onChange={(e) => set({ category: e.target.value as BrushCategory })}
            className={fieldClass}
          >
            {BRUSH_CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-neutral-900">{c}</option>
            ))}
          </select>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">
            {base.custom ? "Your brush" : "Built-in"}
            {edited && " · edited"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" className={buttonClass} disabled={!edited} onClick={() => engine.setToolSettings(tool, { dynamics: {} })}>
              Reset
            </button>
            {base.custom && (
              <button type="button" className={buttonClass} disabled={!edited} onClick={() => store({ ...brush, id: base.id, custom: true }, `Saved “${brush.name}”.`)}>
                <FloppyDisk /> Save
              </button>
            )}
            <button type="button" className={cn(buttonClass, "bg-primary text-primary-foreground hover:bg-primary/85")} onClick={saveNew}>
              <Plus /> Save as new
            </button>
            <button type="button" className={buttonClass} title="Export this brush as a file" onClick={exportBrush}>
              <DownloadSimple /> Export
            </button>
            <button type="button" className={buttonClass} title="Import a brush file" onClick={() => importInput.current?.click()}>
              <UploadSimple /> Import
            </button>
            {base.custom && (
              <button
                type="button"
                className={buttonClass}
                title="Delete this brush"
                onClick={() => {
                  deleteCustomBrush(base.id)
                  engine.selectBrush(tool, getBrush("").id)
                  setMessage(`Deleted “${base.name}”.`)
                }}
              >
                <Trash /> Delete
              </button>
            )}
            <button type="button" aria-label="Close brush studio" title="Close (Esc)" className={cn(buttonClass, "px-1.5")} onClick={onClose}>
              <X />
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void importBrush(e.target.files?.[0])
                e.target.value = ""
              }}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Brush settings" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-white/8 p-2">
            {SECTIONS.filter(([name]) => !(mask && name === "Colour")).map(([name]) => (
              <button
                key={name}
                type="button"
                aria-current={name === section}
                onClick={() => setSection(name)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  name === section && "bg-white/10 text-foreground"
                )}
              >
                {name}
                {sectionActive(name, shown) && <span className="size-1.5 rounded-full bg-primary" aria-label="in use" />}
              </button>
            ))}
          </nav>

          <EditingContext.Provider value={{ brush, set, mask }}>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <Section />
            </div>
          </EditingContext.Provider>

          <aside className="flex w-[44%] max-w-[480px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-white/8 p-3">
            <div className="overflow-hidden rounded-xl bg-black/30">
              <BrushPreview brush={shown} className="h-20 w-full object-contain" />
            </div>
            <ScratchPad brush={shown} size={Math.min(settings.size, 140)} opacity={settings.opacity} />
            <div className="flex flex-col gap-0.5">
              <Row label="Size">
                <Slider label="Size" className="min-w-0 flex-1" min={1} max={400} exp={2.2} value={settings.size} onChange={(v) => engine.setToolSettings(tool, { size: Math.round(v) })} />
                <span className="w-9 text-right text-[10.5px] tabular-nums">{Math.round(settings.size)}</span>
              </Row>
              <Row label="Opacity">
                <Slider label="Opacity" className="min-w-0 flex-1" min={0.01} max={1} value={settings.opacity} onChange={(v) => engine.setToolSettings(tool, { opacity: v })} />
                <span className="w-9 text-right text-[10.5px] tabular-nums">{Math.round(settings.opacity * 100)}%</span>
              </Row>
            </div>
            <p role="status" className="min-h-4 text-[11px] leading-snug text-muted-foreground">
              {message || "Changes apply to the brush straight away. Save as new to keep them in your library."}
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
