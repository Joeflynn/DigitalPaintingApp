export type TipShape = "round" | "grain" | "bristle" | "splatter" | "chalk"

export type BrushCategory = "Sketch" | "Ink" | "Paint" | "Airbrush" | "Texture"

export const BRUSH_CATEGORIES: BrushCategory[] = [
  "Sketch",
  "Ink",
  "Paint",
  "Airbrush",
  "Texture",
]

export interface BrushPreset {
  id: string
  name: string
  category: BrushCategory

  // ---- material: how the paint behaves once it is on the surface ----------
  /** How strongly the paper's tooth breaks up the mark (0–1) */
  grain: number
  /** Size of the paper texture; 1 is fine, larger is coarser */
  grainScale: number
  /** Wet paint bleeds into its surroundings and dries with a dark rim (0–1) */
  wetness: number
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
}

const base: Omit<BrushPreset, "id" | "name" | "category"> = {
  grain: 0,
  grainScale: 1,
  wetness: 0,
  drip: 0,
  pickup: 0,
  relief: 0,
  depletion: 0,
  bristles: 32,
  tip: "round",
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
}

function preset(
  id: string,
  name: string,
  category: BrushCategory,
  over: Partial<BrushPreset>
): BrushPreset {
  return { ...base, id, name, category, ...over }
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
    wetness: 0.7,
    grain: 0.35,
    grainScale: 1.3,
    streamline: 0.2,
  }),
  preset("granulating-wash", "Granulating Wash", "Paint", {
    hardness: 0.78,
    size: 95,
    opacity: 0.8,
    spacing: 0.08,
    flow: 0.14,
    wetness: 1,
    grain: 0.85,
    grainScale: 1.8,
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
]

const byId = new Map(BRUSHES.map((b) => [b.id, b]))

export function getBrush(id: string): BrushPreset {
  return byId.get(id) ?? BRUSHES[0]
}

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 400
