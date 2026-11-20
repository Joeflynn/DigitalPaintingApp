/** Procedural stamp shapes, or `image` for a raster stamp. */
export type TipShape =
  | "round"
  | "grain"
  | "bristle"
  | "splatter"
  | "chalk"
  | "flat"
  | "sponge"
  | "star"
  | "triangle"
  | "heart"
  | "ring"
  | "sparkle"
  | "shard"
  | "image"

/** Order matters: the shaders identify a tip by its index here. */
export const TIP_SHAPES: TipShape[] = [
  "round",
  "grain",
  "bristle",
  "splatter",
  "chalk",
  "flat",
  "sponge",
  "star",
  "triangle",
  "heart",
  "ring",
  "sparkle",
  "shard",
]

/** A pattern fixed to the canvas that the mark is broken up by. */
export type TextureKind =
  | "none"
  | "paper"
  | "canvas"
  | "laid"
  | "rough"
  | "halftone"
  | "hatch"
  | "grit"
  | "stripes"
  | "checker"
  | "cells"
  | "image"

export const TEXTURE_KINDS: TextureKind[] = [
  "paper",
  "canvas",
  "laid",
  "rough",
  "halftone",
  "hatch",
  "grit",
  "stripes",
  "checker",
  "cells",
]

/** A pattern that runs along the stroke and across its tangent. */
export type StrokeTextureKind =
  | "none"
  | "fibres"
  | "drybrush"
  | "dashes"
  | "waves"
  | "zigzag"
  | "beads"
  | "rope"
  | "image"

export const STROKE_TEXTURE_KINDS: StrokeTextureKind[] = [
  "fibres",
  "drybrush",
  "dashes",
  "waves",
  "zigzag",
  "beads",
  "rope",
]

/** How a stamp, texture or stroke pattern combines with the mark so far. */
export type MaskBlend =
  | "multiply"
  | "subtract"
  | "darken"
  | "lighten"
  | "screen"
  | "overlay"
  | "difference"
  | "height"

export const MASK_BLENDS: MaskBlend[] = [
  "multiply",
  "subtract",
  "darken",
  "lighten",
  "screen",
  "overlay",
  "difference",
  "height",
]

/** How the finished stroke sits on the paint beneath it. */
export type PaintBlend = "normal" | "glaze" | "glow" | "invert"

export const PAINT_BLENDS: PaintBlend[] = ["normal", "glaze", "glow", "invert"]

/**
 * A treatment of the whole stroke as it is drawn, applied after the dabs have
 * been laid down: it reshapes or recolours the mark rather than the stamp.
 */
export type StrokeEffect =
  | "none"
  | "pixel"
  | "outline"
  | "sticker"
  | "chroma"
  | "glitch"
  | "mosaic"

/** Order matters: the resolve shader identifies an effect by its index here. */
export const STROKE_EFFECTS: StrokeEffect[] = [
  "none",
  "pixel",
  "outline",
  "sticker",
  "chroma",
  "glitch",
  "mosaic",
]

/**
 * The effect's reach in document pixels for a brush of this diameter: block
 * size, line width, colour offset or cell size, depending on the effect.
 */
export function effectScale(brush: BrushPreset, size: number): number {
  const a = Math.min(1, Math.max(0, brush.effectAmount))
  switch (brush.effect) {
    case "pixel":
      return Math.max(2, Math.round(size * a * 0.5))
    case "outline":
      return Math.max(1.5, size * a * 0.25)
    case "sticker":
      return Math.max(1.5, size * a * 0.3)
    case "chroma":
      return Math.max(1, size * a * 0.3)
    case "glitch":
      return Math.max(2, size * a * 1.5)
    case "mosaic":
      return Math.max(4, size * a * 0.8)
    default:
      return 0
  }
}

export type LinkInput = "pressure" | "speed" | "tilt" | "fade" | "random"

export type LinkTarget =
  | "size"
  | "flow"
  | "load"
  | "wet"
  | "texture"
  | "roundness"
  | "scatter"
  | "angle"
  | "hue"
  | "sat"
  | "lum"
  | "mix2"

/**
 * Drives one brush property from one input. Size, flow, load, wet, texture
 * and roundness are scaled (a positive amount shrinks them as the input
 * falls, a negative one as it rises); the rest are offset by amount × input.
 */
export interface BrushLink {
  input: LinkInput
  target: LinkTarget
  /** −1 to 1 */
  amount: number
  /** Response exponent: below one reacts early, above one late */
  curve: number
}

export type BrushCategory = "Sketch" | "Ink" | "Paint" | "Airbrush" | "Texture" | "FX"

export const BRUSH_CATEGORIES: BrushCategory[] = [
  "Sketch",
  "Ink",
  "Paint",
  "Airbrush",
  "Texture",
  "FX",
]

export interface BrushPreset {
  id: string
  name: string
  category: BrushCategory
  /** Made or imported by the user, and kept in local storage */
  custom?: boolean

  // ---- canvas texture: a pattern fixed to the page ------------------------
  texture: TextureKind
  /** Greyscale data URL, used when `texture` is "image" */
  textureImage: string
  textureBlend: MaskBlend
  textureInvert: boolean
  /** How strongly the texture breaks up the mark (0–1) */
  grain: number
  /** Size of the texture; 1 is fine, larger is coarser */
  grainScale: number

  // ---- dual stamp: a second shape combined with the tip in every dab ------
  dual: TipShape | "none"
  dualImage: string
  dualBlend: MaskBlend
  dualDepth: number
  /** Size of the second stamp relative to the tip */
  dualScale: number
  /** Random rotation of the second stamp per dab, 0–1 of a full turn */
  dualRotate: number
  /** Random offset of the second stamp per dab, as a fraction of the tip */
  dualOffset: number

  // ---- stroke texture: runs along the path, across its tangent ------------
  strokeTex: StrokeTextureKind
  strokeImage: string
  strokeBlend: MaskBlend
  strokeInvert: boolean
  strokeDepth: number
  strokeScale: number

  // ---- material: how the paint behaves once it is on the surface ----------
  /** How the stroke sits on what is beneath: opaque, a glaze, light, or inverting */
  paintBlend: PaintBlend
  /** A treatment of the whole stroke: pixel blocks, outlines, colour splits… */
  effect: StrokeEffect
  /** Scale of the effect relative to the brush size (0–1) */
  effectAmount: number
  /** Wet paint bleeds into its surroundings and dries with a dark rim (0–1) */
  wetness: number
  /** How far wet paint creeps outwards (0–1) */
  bleed: number
  /** How strongly pigment gathers at the rim of a wash as it dries (0–1) */
  edgeDarken: number
  /** Pigment settling into the valleys of the paper (0–1) */
  granulation: number
  /** Ragged, blooming fronts where water carries pigment outwards (0–1) */
  feather: number
  /** Uneven pigment density across a wash (0–1) */
  pigmentVariation: number
  /** How long the paint stays wet and keeps moving (0–1) */
  dryTime: number
  /** Shine of thick paint (0–1) */
  gloss: number
  /** Paint heavy enough to run down the canvas (0–1) */
  drip: number
  /** How much colour the tip picks up from the canvas and drags along (0–1) */
  pickup: number
  /** Thickness of the paint: lit ridges and highlights (0–1) */
  relief: number
  /** How quickly the brush runs out of paint along a stroke (0–1) */
  depletion: number
  /** Number of strands across a bristle tip */
  bristles: number

  // ---- tip: the shape that touches the surface ----------------------------
  tip: TipShape
  /** Greyscale data URL, used when `tip` is "image" */
  tipImage: string
  /** 0 = fully soft falloff, 1 = hard edge */
  hardness: number
  /** Default diameter in document pixels */
  size: number
  /** Default stroke opacity */
  opacity: number
  /** Dab spacing as a fraction of the dab diameter */
  spacing: number
  /** Weight of each dab */
  flow: number
  /** Tip squash, 1 = circular */
  roundness: number
  /** Base tip rotation in degrees */
  angle: number
  /** Rotate the tip to follow the stroke direction */
  followDirection: boolean

  // ---- dynamics: how the tip responds to the hand -------------------------
  /** How much pen pressure drives size (0–1) */
  sizePressure: number
  /** How much pen pressure drives flow (0–1) */
  flowPressure: number
  /** Pressure response exponent: below one feels softer */
  pressureCurve: number
  /** Smallest size pressure can reach, as a fraction of the full size */
  minSize: number
  flowJitter: number
  sizeJitter: number
  /** Random rotation per dab, 0–1 of a full turn */
  angleJitter: number
  /** Random offset per dab as a fraction of size */
  scatter: number
  /** Default stabilisation, 0–1 */
  streamline: number
  /** Stroke length, in brush diameters, over which the fade input runs 0→1 */
  fadeLength: number
  /** Extra input → property mappings */
  links: BrushLink[]

  // ---- colour: shifts applied to each stamp or each stroke ----------------
  /** Random hue shift per stamp; 1 covers the whole wheel */
  hueJitter: number
  satJitter: number
  lumJitter: number
  /** Random shift chosen once per stroke */
  strokeHueJitter: number
  strokeSatJitter: number
  strokeLumJitter: number
  /** Hue turns steadily along the stroke; 1 is a full turn every 8 diameters */
  hueCycle: number
  /** Each stamp mixes in a random amount of the secondary colour (0–1) */
  secondaryMix: number
}

export const BRUSH_DEFAULTS: Omit<BrushPreset, "id" | "name" | "category"> = {
  texture: "paper",
  textureImage: "",
  textureBlend: "height",
  textureInvert: false,
  grain: 0,
  grainScale: 1,
  dual: "none",
  dualImage: "",
  dualBlend: "multiply",
  dualDepth: 1,
  dualScale: 1,
  dualRotate: 1,
  dualOffset: 0,
  strokeTex: "none",
  strokeImage: "",
  strokeBlend: "multiply",
  strokeInvert: false,
  strokeDepth: 0.6,
  strokeScale: 1,
  paintBlend: "normal",
  effect: "none",
  effectAmount: 0.3,
  wetness: 0,
  bleed: 0.5,
  edgeDarken: 0.5,
  granulation: 0,
  feather: 0,
  pigmentVariation: 0,
  dryTime: 0.5,
  gloss: 0.5,
  drip: 0,
  pickup: 0,
  relief: 0,
  depletion: 0,
  bristles: 32,
  tip: "round",
  tipImage: "",
  hardness: 0.9,
  size: 12,
  opacity: 1,
  spacing: 0.06,
  flow: 1,
  roundness: 1,
  angle: 0,
  followDirection: false,
  sizePressure: 0,
  flowPressure: 0,
  pressureCurve: 1,
  minSize: 0.03,
  flowJitter: 0,
  sizeJitter: 0,
  angleJitter: 0,
  scatter: 0,
  streamline: 0.3,
  fadeLength: 20,
  links: [],
  hueJitter: 0,
  satJitter: 0,
  lumJitter: 0,
  strokeHueJitter: 0,
  strokeSatJitter: 0,
  strokeLumJitter: 0,
  hueCycle: 0,
  secondaryMix: 0,
}

function preset(
  id: string,
  name: string,
  category: BrushCategory,
  over: Partial<BrushPreset>
): BrushPreset {
  return { ...BRUSH_DEFAULTS, id, name, category, ...over }
}

export const BRUSHES: BrushPreset[] = [
  // ---- Paint ---------------------------------------------------------------
  preset("loaded-oil", "Loaded Oil", "Paint", {
    tip: "bristle",
    size: 90,
    roundness: 0.7,
    followDirection: true,
    spacing: 0.04,
    flow: 0.8,
    sizePressure: 0.35,
    flowPressure: 0.25,
    relief: 0.8,
    pickup: 0.6,
    depletion: 0.3,
    bristles: 38,
    gloss: 0.65,
    texture: "canvas",
    textureBlend: "height",
    grain: 0.25,
    grainScale: 1.2,
    streamline: 0.3,
  }),
  preset("oil-blender", "Oil Blender", "Paint", {
    tip: "bristle",
    size: 70,
    roundness: 0.75,
    followDirection: true,
    spacing: 0.04,
    flow: 0.85,
    sizePressure: 0.25,
    relief: 0.6,
    pickup: 0.7,
    depletion: 0.15,
    bristles: 34,
    gloss: 0.6,
    // A light touch only pushes the paint already there; pressing lays colour.
    links: [{ input: "pressure", target: "load", amount: 1, curve: 1.6 }],
    streamline: 0.3,
  }),
  preset("oil-bristle", "Oil Bristle", "Paint", {
    tip: "bristle",
    size: 52,
    roundness: 0.8,
    followDirection: true,
    spacing: 0.04,
    flow: 0.7,
    sizePressure: 0.3,
    flowPressure: 0.4,
    relief: 0.55,
    pickup: 0.35,
    depletion: 0.55,
    bristles: 26,
    streamline: 0.2,
  }),
  preset("dry-fan", "Dry Fan", "Paint", {
    tip: "bristle",
    size: 85,
    roundness: 0.3,
    followDirection: true,
    spacing: 0.04,
    flow: 0.75,
    grain: 0.5,
    grainScale: 1.4,
    relief: 0.35,
    depletion: 1,
    bristles: 54,
    flowPressure: 0.6,
    streamline: 0.25,
  }),
  preset("canvas-knife", "Palette Knife", "Paint", {
    hardness: 0.86,
    size: 110,
    roundness: 0.22,
    followDirection: true,
    angle: 90,
    spacing: 0.03,
    flow: 0.9,
    relief: 0.7,
    pickup: 0.85,
    flowPressure: 0.3,
    streamline: 0.3,
  }),
  preset("gouache", "Gouache", "Paint", {
    hardness: 0.75,
    size: 40,
    spacing: 0.05,
    flow: 0.85,
    flowPressure: 0.5,
    sizePressure: 0.4,
    pickup: 0.25,
    grain: 0.15,
    streamline: 0.2,
  }),
  preset("rigger", "Rigger", "Paint", {
    hardness: 0.8,
    size: 9,
    spacing: 0.05,
    sizePressure: 0.9,
    minSize: 0.12,
    pickup: 0.2,
    depletion: 0.25,
    streamline: 0.55,
  }),
  preset("watercolor", "Watercolor Wash", "Paint", {
    hardness: 0.72,
    size: 80,
    opacity: 0.75,
    spacing: 0.08,
    flow: 0.1,
    flowPressure: 0.6,
    sizePressure: 0.4,
    paintBlend: "glaze",
    wetness: 0.7,
    edgeDarken: 0.65,
    granulation: 0.35,
    feather: 0.35,
    pigmentVariation: 0.4,
    texture: "rough",
    textureBlend: "height",
    grain: 0.12,
    grainScale: 1.3,
    streamline: 0.2,
  }),
  preset("wet-on-wet", "Wet-on-Wet Bloom", "Paint", {
    hardness: 0.55,
    size: 110,
    opacity: 0.7,
    spacing: 0.08,
    flow: 0.09,
    flowPressure: 0.5,
    sizePressure: 0.3,
    paintBlend: "glaze",
    wetness: 1,
    bleed: 0.9,
    edgeDarken: 0.35,
    granulation: 0.25,
    feather: 0.9,
    pigmentVariation: 0.6,
    dryTime: 0.85,
    grainScale: 1.6,
    streamline: 0.2,
  }),
  preset("dry-brush-wc", "Watercolor Dry Brush", "Paint", {
    hardness: 0.8,
    size: 60,
    opacity: 0.8,
    roundness: 0.6,
    followDirection: true,
    spacing: 0.05,
    flow: 0.5,
    flowPressure: 0.5,
    paintBlend: "glaze",
    wetness: 0.25,
    bleed: 0.25,
    edgeDarken: 0.5,
    granulation: 0.3,
    texture: "rough",
    grain: 0.8,
    grainScale: 1.5,
    strokeTex: "drybrush",
    strokeDepth: 0.75,
    depletion: 0.5,
    streamline: 0.2,
  }),
  preset("granulating-wash", "Granulating Wash", "Paint", {
    hardness: 0.78,
    size: 95,
    opacity: 0.8,
    spacing: 0.08,
    flow: 0.14,
    paintBlend: "glaze",
    wetness: 1,
    edgeDarken: 0.7,
    granulation: 0.9,
    feather: 0.3,
    pigmentVariation: 0.5,
    grainScale: 1.6,
    pickup: 0.3,
    sizePressure: 0.5,
    flowPressure: 0.5,
    streamline: 0.2,
  }),
  preset("wet-ink", "Dripping Ink", "Paint", {
    hardness: 0.8,
    size: 46,
    spacing: 0.05,
    flow: 0.9,
    sizePressure: 0.5,
    drip: 0.8,
    wetness: 0.2,
    relief: 0.3,
    streamline: 0.3,
  }),
  preset("chisel-marker", "Chisel Marker", "Paint", {
    hardness: 0.88,
    size: 34,
    opacity: 0.65,
    spacing: 0.04,
    roundness: 0.3,
    angle: -40,
    streamline: 0.25,
  }),

  // ---- Ink -----------------------------------------------------------------
  preset("studio-pen", "Studio Pen", "Ink", {
    hardness: 0.92,
    size: 12,
    spacing: 0.05,
    sizePressure: 0.85,
    streamline: 0.5,
  }),
  preset("technical-pen", "Technical Pen", "Ink", {
    hardness: 0.95,
    size: 5,
    spacing: 0.05,
    streamline: 0.35,
  }),
  preset("calligraphy", "Calligraphy Nib", "Ink", {
    hardness: 0.92,
    size: 26,
    roundness: 0.16,
    angle: -35,
    spacing: 0.03,
    sizePressure: 0.35,
    streamline: 0.45,
  }),
  preset("sumi", "Sumi Brush", "Ink", {
    tip: "bristle",
    size: 34,
    followDirection: true,
    spacing: 0.035,
    sizePressure: 1,
    flowPressure: 0.2,
    depletion: 0.45,
    bristles: 22,
    wetness: 0.15,
    streamline: 0.6,
  }),
  preset("dry-ink", "Dry Ink", "Ink", {
    tip: "chalk",
    size: 20,
    spacing: 0.08,
    flow: 0.9,
    grain: 0.75,
    sizePressure: 0.7,
    streamline: 0.4,
  }),

  // ---- Sketch --------------------------------------------------------------
  preset("hb-pencil", "HB Pencil", "Sketch", {
    tip: "grain",
    hardness: 0.5,
    size: 7,
    spacing: 0.12,
    flow: 0.5,
    flowPressure: 0.8,
    sizePressure: 0.25,
    grain: 0.6,
    grainScale: 0.6,
    streamline: 0.1,
  }),
  preset("6b-pencil", "6B Pencil", "Sketch", {
    tip: "grain",
    hardness: 0.2,
    size: 18,
    spacing: 0.1,
    flow: 0.45,
    flowPressure: 0.9,
    sizePressure: 0.4,
    grain: 0.8,
    grainScale: 0.8,
    scatter: 0.03,
    streamline: 0.1,
  }),
  preset("charcoal", "Charcoal", "Sketch", {
    tip: "chalk",
    size: 46,
    spacing: 0.08,
    flow: 0.55,
    flowPressure: 0.85,
    sizePressure: 0.2,
    roundness: 0.6,
    followDirection: true,
    grain: 0.95,
    grainScale: 1.3,
    streamline: 0.1,
  }),
  preset("pastel", "Soft Pastel", "Sketch", {
    tip: "chalk",
    size: 60,
    spacing: 0.07,
    flow: 0.65,
    flowPressure: 0.6,
    grain: 0.8,
    grainScale: 2,
    pickup: 0.25,
    streamline: 0.15,
  }),

  // ---- Airbrush ------------------------------------------------------------
  preset("hard-round", "Hard Round", "Airbrush", {
    hardness: 0.9,
    size: 40,
    spacing: 0.05,
    sizePressure: 0.3,
    streamline: 0.2,
  }),
  preset("hard-airbrush", "Hard Airbrush", "Airbrush", {
    hardness: 0.6,
    size: 60,
    spacing: 0.06,
    flow: 0.15,
    flowPressure: 1,
    streamline: 0.2,
  }),
  preset("soft-airbrush", "Soft Airbrush", "Airbrush", {
    hardness: 0,
    size: 120,
    spacing: 0.08,
    flow: 0.06,
    flowPressure: 1,
    streamline: 0.2,
  }),

  // ---- Texture -------------------------------------------------------------
  preset("chalk", "Chalk", "Texture", {
    tip: "chalk",
    size: 30,
    spacing: 0.08,
    flow: 0.8,
    flowPressure: 0.5,
    followDirection: true,
    grain: 0.85,
    streamline: 0.15,
  }),
  preset("spray", "Spray Paint", "Texture", {
    tip: "splatter",
    size: 90,
    spacing: 0.2,
    flow: 0.5,
    flowPressure: 0.5,
    angleJitter: 1,
    scatter: 0.35,
    sizeJitter: 0.5,
    drip: 0.35,
    streamline: 0.1,
  }),
  preset("stipple", "Stipple", "Texture", {
    tip: "splatter",
    size: 36,
    spacing: 0.5,
    flow: 0.9,
    angleJitter: 1,
    scatter: 0.6,
    sizeJitter: 0.6,
    sizePressure: 0.3,
    streamline: 0.1,
  }),
  preset("sponge", "Sea Sponge", "Texture", {
    tip: "sponge",
    hardness: 0.6,
    size: 90,
    spacing: 0.35,
    flow: 0.7,
    flowPressure: 0.4,
    angleJitter: 1,
    scatter: 0.15,
    dual: "splatter",
    dualBlend: "subtract",
    dualDepth: 0.5,
    lumJitter: 0.12,
    streamline: 0.1,
  }),
  preset("halftone", "Halftone Marker", "Texture", {
    hardness: 0.7,
    size: 70,
    spacing: 0.05,
    flowPressure: 0.7,
    texture: "halftone",
    textureBlend: "height",
    grain: 1,
    grainScale: 1.4,
    streamline: 0.25,
  }),

  // ---- FX ------------------------------------------------------------------
  preset("neon", "Neon Tube", "FX", {
    hardness: 0.1,
    size: 34,
    spacing: 0.05,
    flow: 0.35,
    sizePressure: 0.4,
    paintBlend: "glow",
    hueCycle: 0.25,
    streamline: 0.5,
  }),
  preset("rainbow-ribbon", "Rainbow Ribbon", "FX", {
    tip: "flat",
    hardness: 0.85,
    size: 46,
    roundness: 0.25,
    followDirection: true,
    angle: 90,
    spacing: 0.03,
    hueCycle: 1,
    strokeTex: "fibres",
    strokeDepth: 0.35,
    streamline: 0.5,
  }),
  preset("confetti", "Confetti", "FX", {
    tip: "star",
    hardness: 0.9,
    size: 44,
    spacing: 0.7,
    angleJitter: 1,
    scatter: 1.2,
    sizeJitter: 0.7,
    hueJitter: 0.35,
    satJitter: 0.2,
    lumJitter: 0.25,
    secondaryMix: 0.5,
    sizePressure: 0.4,
    streamline: 0.1,
  }),
  preset("impressionist", "Impressionist Dabs", "FX", {
    tip: "bristle",
    size: 50,
    roundness: 0.5,
    followDirection: true,
    spacing: 0.04,
    flow: 0.9,
    relief: 0.6,
    pickup: 0.2,
    bristles: 18,
    strokeHueJitter: 0.08,
    strokeSatJitter: 0.25,
    strokeLumJitter: 0.3,
    hueJitter: 0.02,
    streamline: 0.15,
  }),
  preset("pixel-pen", "Pixel Pen", "FX", {
    hardness: 0.95,
    size: 40,
    spacing: 0.05,
    sizePressure: 0.5,
    effect: "pixel",
    effectAmount: 0.3,
    streamline: 0.2,
  }),
  preset("hollow-liner", "Hollow Liner", "FX", {
    hardness: 0.92,
    size: 38,
    spacing: 0.04,
    sizePressure: 0.7,
    minSize: 0.2,
    effect: "outline",
    effectAmount: 0.3,
    streamline: 0.5,
  }),
  preset("sticker", "Sticker Marker", "FX", {
    hardness: 0.92,
    size: 36,
    spacing: 0.04,
    sizePressure: 0.35,
    effect: "sticker",
    effectAmount: 0.4,
    streamline: 0.45,
  }),
  preset("anaglyph", "3D Glasses", "FX", {
    hardness: 0.88,
    size: 30,
    spacing: 0.04,
    sizePressure: 0.5,
    effect: "chroma",
    effectAmount: 0.45,
    streamline: 0.4,
  }),
  preset("glitch", "Glitch", "FX", {
    tip: "flat",
    hardness: 0.9,
    size: 56,
    roundness: 0.45,
    spacing: 0.05,
    effect: "glitch",
    effectAmount: 0.45,
    strokeHueJitter: 0.1,
    streamline: 0.2,
  }),
  preset("stained-glass", "Stained Glass", "FX", {
    hardness: 0.8,
    size: 90,
    spacing: 0.06,
    sizePressure: 0.3,
    effect: "mosaic",
    effectAmount: 0.35,
    hueJitter: 0.12,
    lumJitter: 0.2,
    streamline: 0.2,
  }),
  preset("negative", "Negative", "FX", {
    hardness: 0.85,
    size: 70,
    spacing: 0.05,
    sizePressure: 0.3,
    paintBlend: "invert",
    streamline: 0.3,
  }),
  preset("bokeh", "Bokeh", "FX", {
    tip: "ring",
    hardness: 0.75,
    size: 80,
    opacity: 0.8,
    spacing: 0.9,
    flow: 0.5,
    flowJitter: 0.6,
    scatter: 1.1,
    sizeJitter: 0.7,
    paintBlend: "glow",
    hueJitter: 0.1,
    lumJitter: 0.15,
    secondaryMix: 0.4,
    streamline: 0.1,
  }),
  preset("glimmer", "Glimmer", "FX", {
    tip: "sparkle",
    size: 60,
    spacing: 0.5,
    flow: 0.9,
    flowJitter: 0.4,
    angleJitter: 0.08,
    scatter: 1,
    sizeJitter: 0.85,
    sizePressure: 0.4,
    paintBlend: "glow",
    hueJitter: 0.08,
    streamline: 0.1,
  }),
  preset("hearts", "Heart Trail", "FX", {
    tip: "heart",
    hardness: 0.9,
    size: 46,
    spacing: 0.85,
    angleJitter: 0.12,
    scatter: 0.5,
    sizeJitter: 0.5,
    sizePressure: 0.4,
    hueJitter: 0.08,
    lumJitter: 0.2,
    secondaryMix: 0.35,
    streamline: 0.2,
  }),
  preset("shatter", "Shatter", "FX", {
    tip: "shard",
    hardness: 0.95,
    size: 70,
    spacing: 0.3,
    angleJitter: 1,
    scatter: 0.7,
    sizeJitter: 0.6,
    sizePressure: 0.4,
    hueJitter: 0.05,
    lumJitter: 0.45,
    secondaryMix: 0.3,
    streamline: 0.1,
  }),
  preset("bunting", "Bunting", "FX", {
    tip: "triangle",
    hardness: 0.95,
    size: 44,
    spacing: 0.95,
    followDirection: true,
    angle: 180,
    hueJitter: 0.5,
    satJitter: 0.1,
    sizePressure: 0.3,
    streamline: 0.5,
  }),
  preset("bead-chain", "Bead Chain", "FX", {
    hardness: 0.9,
    size: 32,
    spacing: 0.03,
    strokeTex: "beads",
    strokeDepth: 1,
    relief: 0.9,
    gloss: 0.9,
    streamline: 0.55,
  }),
  preset("candy-rope", "Candy Rope", "FX", {
    hardness: 0.9,
    size: 34,
    spacing: 0.03,
    strokeTex: "rope",
    strokeDepth: 1,
    relief: 0.8,
    gloss: 0.8,
    streamline: 0.55,
  }),
  preset("zigzag", "Zigzag Stitch", "FX", {
    hardness: 0.95,
    size: 36,
    spacing: 0.03,
    strokeTex: "zigzag",
    strokeDepth: 1,
    streamline: 0.6,
  }),
  preset("bubblegum", "Bubblegum", "FX", {
    hardness: 0.35,
    size: 44,
    spacing: 0.04,
    sizePressure: 0.4,
    relief: 1,
    gloss: 1,
    streamline: 0.5,
  }),
  preset("checker-roller", "Checker Roller", "FX", {
    tip: "flat",
    hardness: 0.92,
    size: 90,
    roundness: 0.5,
    followDirection: true,
    angle: 90,
    spacing: 0.04,
    texture: "checker",
    textureBlend: "multiply",
    grain: 1,
    grainScale: 1.5,
    streamline: 0.3,
  }),
  preset("stripe-roller", "Stripe Roller", "FX", {
    tip: "flat",
    hardness: 0.92,
    size: 90,
    roundness: 0.5,
    followDirection: true,
    angle: 90,
    spacing: 0.04,
    texture: "stripes",
    textureBlend: "multiply",
    grain: 1,
    grainScale: 1.2,
    streamline: 0.3,
  }),
  preset("tile-press", "Tile Press", "FX", {
    hardness: 0.85,
    size: 100,
    spacing: 0.05,
    flowPressure: 0.3,
    texture: "cells",
    textureBlend: "height",
    grain: 1,
    grainScale: 1.6,
    relief: 0.5,
    lumJitter: 0.1,
    streamline: 0.2,
  }),
]

// ---- brush library: built-in presets plus the user's own -------------------

const STORAGE_KEY = "pigment.brushes.v1"

/** Fills in anything a saved or imported brush is missing. */
export function normalizeBrush(raw: Partial<BrushPreset>): BrushPreset {
  const b: BrushPreset = {
    ...BRUSH_DEFAULTS,
    id: "",
    name: "Untitled",
    category: "Paint",
    ...raw,
  }
  if (!BRUSH_CATEGORIES.includes(b.category)) b.category = "Paint"
  if (!STROKE_EFFECTS.includes(b.effect)) b.effect = "none"
  b.links = Array.isArray(b.links) ? b.links.map((l) => ({ ...l })) : []
  return b
}

function loadCustom(): BrushPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!Array.isArray(raw)) return []
    return raw
      .filter((b) => b && typeof b.id === "string")
      .map((b) => ({ ...normalizeBrush(b), custom: true }))
  } catch {
    return []
  }
}

let custom: BrushPreset[] = typeof localStorage === "undefined" ? [] : loadCustom()
let all: BrushPreset[] = [...custom, ...BRUSHES]
let byId = new Map(all.map((b) => [b.id, b]))
const listeners = new Set<() => void>()

function publish(next: BrushPreset[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Most likely the storage quota: raster stamps are the bulk of a brush.
    return false
  }
  custom = next
  all = [...custom, ...BRUSHES]
  byId = new Map(all.map((b) => [b.id, b]))
  for (const l of listeners) l()
  return true
}

export function subscribeBrushes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every brush, the user's own first. The array is stable between changes. */
export function allBrushes(): BrushPreset[] {
  return all
}

/** Adds or replaces one of the user's brushes. False if it could not be stored. */
export function saveCustomBrush(brush: BrushPreset): boolean {
  const b = { ...normalizeBrush(brush), custom: true }
  const i = custom.findIndex((c) => c.id === b.id)
  return publish(
    i >= 0 ? custom.map((c, j) => (j === i ? b : c)) : [b, ...custom]
  )
}

export function deleteCustomBrush(id: string) {
  publish(custom.filter((c) => c.id !== id))
}

export function getBrush(id: string): BrushPreset {
  return byId.get(id) ?? BRUSHES[0]
}

/**
 * The brush as the smudge tool uses it: the same tip, textures and dynamics,
 * but dry. It lays no pigment, so thin washes and airbrushes are given enough
 * contact to move paint, and the lightest touch still blends a little.
 */
export function dryBrush(brush: BrushPreset): BrushPreset {
  return {
    ...brush,
    flow: Math.max(brush.flow, 0.35),
    flowPressure: Math.min(brush.flowPressure, 0.8),
    flowJitter: Math.min(brush.flowJitter, 0.3),
  }
}

/** Link targets that only change pigment, not where the brush marks. */
export const PIGMENT_TARGETS: LinkTarget[] = ["load", "hue", "sat", "lum", "mix2"]

/**
 * The brush as the effect brush uses it. It paints a mask, which is only
 * ever coverage, so everything that acts on pigment is dropped: colour
 * shifts, pickup, thickness and shine, the paint blend and the colour-only
 * stroke effect. Shape, texture, dynamics and wet edges all still apply.
 */
export function maskBrush(brush: BrushPreset): BrushPreset {
  return {
    ...brush,
    paintBlend: "normal",
    effect: brush.effect === "chroma" ? "none" : brush.effect,
    pickup: 0,
    relief: 0,
    hueJitter: 0,
    satJitter: 0,
    lumJitter: 0,
    strokeHueJitter: 0,
    strokeSatJitter: 0,
    strokeLumJitter: 0,
    hueCycle: 0,
    secondaryMix: 0,
    links: (brush.links ?? []).filter((l) => !PIGMENT_TARGETS.includes(l.target)),
  }
}

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 400
