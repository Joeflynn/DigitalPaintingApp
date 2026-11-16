export type EffectGroup = "Adjustments" | "Filters" | "Effects"

export interface EffectParam {
  key: string
  label: string
  min: number
  max: number
  /** Default value */
  value: number
  /** How the value is shown next to its slider. */
  display: "percent" | "px" | "deg" | "number"
  /** >1 gives finer control at the low end of the slider */
  exp?: number
}

export interface EffectDef {
  id: string
  /** Index of the matching `case` in effects.wgsl */
  code: number
  label: string
  group: EffectGroup
  hint: string
  params: EffectParam[]
  /** Gaussian sigma (px) of the blurred copy the shader needs, if any. */
  blur?: (p: Record<string, number>) => number
}

/** A non-destructive effect held by an adjustment layer. */
export interface LayerFx {
  type: string
  params: Record<string, number>
}

const pct = (
  key: string,
  label: string,
  value = 0,
  min = -1,
  max = 1
): EffectParam => ({ key, label, min, max, value, display: "percent" })

export const EFFECTS: EffectDef[] = [
  {
    id: "brightness-contrast",
    code: 0,
    label: "Brightness / Contrast",
    group: "Adjustments",
    hint: "Lighten, darken and stretch tones",
    params: [pct("brightness", "Brightness"), pct("contrast", "Contrast")],
  },
  {
    id: "hue-saturation",
    code: 1,
    label: "Hue / Saturation",
    group: "Adjustments",
    hint: "Shift hues and colour intensity",
    params: [
      { key: "hue", label: "Hue", min: -180, max: 180, value: 0, display: "deg" },
      pct("saturation", "Saturation"),
      pct("lightness", "Lightness"),
    ],
  },
  {
    id: "temperature",
    code: 2,
    label: "Temperature",
    group: "Adjustments",
    hint: "Warm or cool the colours",
    params: [pct("temperature", "Warmth", 0.3), pct("tint", "Tint")],
  },
  {
    id: "levels",
    code: 3,
    label: "Levels",
    group: "Adjustments",
    hint: "Set black point, white point and gamma",
    params: [
      pct("black", "Black", 0, 0, 1),
      pct("white", "White", 1, 0, 1),
      { key: "gamma", label: "Gamma", min: 0.2, max: 3, value: 1, display: "number" },
    ],
  },
  {
    id: "invert",
    code: 4,
    label: "Invert",
    group: "Adjustments",
    hint: "Flip every colour to its negative",
    params: [],
  },
  {
    id: "monochrome",
    code: 5,
    label: "Monochrome",
    group: "Adjustments",
    hint: "Black and white, with an optional tint",
    params: [
      { key: "hue", label: "Tint hue", min: 0, max: 360, value: 35, display: "deg" },
      pct("tint", "Tint", 0, 0, 1),
    ],
  },
  {
    id: "posterize",
    code: 6,
    label: "Posterize",
    group: "Adjustments",
    hint: "Reduce to a few flat tones",
    params: [
      { key: "levels", label: "Levels", min: 2, max: 16, value: 5, display: "number" },
    ],
  },
  {
    id: "blur",
    code: 7,
    label: "Gaussian Blur",
    group: "Filters",
    hint: "Soften everything beneath",
    params: [
      { key: "radius", label: "Radius", min: 0, max: 120, value: 12, display: "px", exp: 2 },
    ],
    blur: (p) => p.radius / 2,
  },
  {
    id: "sharpen",
    code: 8,
    label: "Sharpen",
    group: "Filters",
    hint: "Unsharp mask for crisper edges",
    params: [
      pct("amount", "Amount", 0.8, 0, 3),
      { key: "radius", label: "Radius", min: 0.5, max: 12, value: 2, display: "px" },
    ],
    blur: (p) => p.radius,
  },
  {
    id: "noise",
    code: 9,
    label: "Noise",
    group: "Filters",
    hint: "Film grain, mono or coloured",
    params: [pct("amount", "Amount", 0.2, 0, 1), pct("color", "Colour", 0, 0, 1)],
  },
  {
    id: "pixelate",
    code: 10,
    label: "Pixelate",
    group: "Filters",
    hint: "Chunky mosaic blocks",
    params: [
      { key: "size", label: "Block", min: 2, max: 96, value: 12, display: "px", exp: 2 },
    ],
  },
  {
    id: "vignette",
    code: 11,
    label: "Vignette",
    group: "Effects",
    hint: "Darken or lighten the corners",
    params: [
      pct("amount", "Amount", 0.5),
      pct("size", "Size", 0.45, 0, 1),
      pct("softness", "Softness", 0.5, 0, 1),
    ],
  },
  {
    id: "chromatic",
    code: 12,
    label: "Chromatic Aberration",
    group: "Effects",
    hint: "Split colour fringes toward the edges",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 40, value: 8, display: "px" },
    ],
  },
  {
    id: "glow",
    code: 13,
    label: "Glow",
    group: "Effects",
    hint: "Bloom around the bright areas",
    params: [
      { key: "radius", label: "Radius", min: 1, max: 120, value: 30, display: "px", exp: 2 },
      pct("intensity", "Intensity", 0.8, 0, 2),
      pct("threshold", "Threshold", 0.4, 0, 0.95),
    ],
    blur: (p) => p.radius / 2,
  },
  {
    id: "halftone",
    code: 14,
    label: "Halftone",
    group: "Effects",
    hint: "Print-style ink dots",
    params: [
      { key: "size", label: "Dot size", min: 3, max: 48, value: 10, display: "px" },
      { key: "angle", label: "Angle", min: 0, max: 90, value: 30, display: "deg" },
    ],
  },
]

export const EFFECT_GROUPS: EffectGroup[] = ["Adjustments", "Filters", "Effects"]

export function getEffect(id: string): EffectDef | undefined {
  return EFFECTS.find((e) => e.id === id)
}

export function defaultFx(def: EffectDef): LayerFx {
  const params: Record<string, number> = {}
  for (const p of def.params) params[p.key] = p.value
  return { type: def.id, params }
}

export function formatParam(p: EffectParam, v: number): string {
  switch (p.display) {
    case "percent":
      return `${Math.round(v * 100)}`
    case "deg":
      return `${Math.round(v)}°`
    case "px":
      return v < 10 ? v.toFixed(1) : `${Math.round(v)}`
    default:
      return p.max - p.min > 8 ? `${Math.round(v)}` : v.toFixed(2)
  }
}
