export type EffectGroup = "Adjustments" | "Filters" | "Effects" | "Glitch" | "Stylize"

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

export interface EffectPreset {
  name: string
  params: Record<string, number>
}

export interface EffectDef {
  id: string
  /** Index of the matching `case` in effects.wgsl */
  code: number
  label: string
  group: EffectGroup
  hint: string
  params: EffectParam[]
  /** Named settings offered as one-tap chips; missing keys use the default. */
  presets?: EffectPreset[]
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

const px = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  exp?: number
): EffectParam => ({ key, label, min, max, value, display: "px", exp })

const deg = (key: string, label: string, value = 0, max = 360): EffectParam => ({
  key,
  label,
  min: 0,
  max,
  value,
  display: "deg",
})

const num = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number
): EffectParam => ({ key, label, min, max, value, display: "number" })

/** Reshuffles where the random damage of a glitch effect lands. */
const seed = (value = 7): EffectParam => num("seed", "Seed", value, 0, 100)

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
    presets: [
      { name: "Fine", params: { size: 5 } },
      { name: "Chunky", params: { size: 24 } },
      { name: "Censored", params: { size: 64 } },
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
    presets: [
      { name: "Newsprint", params: { size: 5, angle: 45 } },
      { name: "Comic", params: { size: 10, angle: 30 } },
      { name: "Pop art", params: { size: 26, angle: 15 } },
    ],
  },
  {
    id: "rgb-shift",
    code: 16,
    label: "RGB Shift",
    group: "Glitch",
    hint: "Slide the colour channels apart",
    params: [
      px("amount", "Amount", 12, 0, 80, 2),
      deg("angle", "Angle", 0, 180),
      pct("anaglyph", "3D", 0, 0, 1),
    ],
    presets: [
      { name: "Subtle", params: { amount: 4 } },
      { name: "Double vision", params: { amount: 30 } },
      { name: "Diagonal", params: { amount: 16, angle: 45 } },
      { name: "3D glasses", params: { amount: 14, anaglyph: 1 } },
    ],
  },
  {
    id: "vhs",
    code: 18,
    label: "VHS",
    group: "Glitch",
    hint: "Colour bleed, wobble and tape noise",
    params: [
      px("bleed", "Bleed", 10, 0, 40),
      px("wobble", "Wobble", 3, 0, 30, 2),
      pct("noise", "Noise", 0.25, 0, 1),
      pct("tracking", "Tracking", 0.4, 0, 1),
      seed(),
    ],
    presets: [
      { name: "Rental tape", params: {} },
      { name: "Clean dub", params: { bleed: 6, wobble: 1, noise: 0.1, tracking: 0 } },
      { name: "Tracking error", params: { bleed: 14, wobble: 6, noise: 0.35, tracking: 1, seed: 31 } },
      { name: "Worn out", params: { bleed: 30, wobble: 14, noise: 0.7, tracking: 0.7, seed: 58 } },
    ],
  },
  {
    id: "crt",
    code: 17,
    label: "CRT Screen",
    group: "Glitch",
    hint: "Scanlines, phosphor grille and a curved tube",
    params: [
      px("lines", "Lines", 4, 2, 16),
      pct("intensity", "Scanlines", 0.5, 0, 1),
      pct("grille", "Grille", 0.35, 0, 1),
      pct("curve", "Curve", 0.35, 0, 1),
    ],
    presets: [
      { name: "Arcade", params: { lines: 4, intensity: 0.6, grille: 0.5, curve: 0.5 } },
      { name: "Flat panel", params: { lines: 3, intensity: 0.35, grille: 0.2, curve: 0 } },
      { name: "Security cam", params: { lines: 6, intensity: 0.8, grille: 0, curve: 0.2 } },
      { name: "Old telly", params: { lines: 9, intensity: 0.7, grille: 0.6, curve: 0.9 } },
    ],
  },
  {
    id: "slices",
    code: 19,
    label: "Slice Shift",
    group: "Glitch",
    hint: "Knock random strips sideways",
    params: [
      px("amount", "Shift", 60, 0, 400, 2),
      px("height", "Height", 24, 2, 200, 2),
      pct("density", "Density", 0.35, 0, 1),
      px("split", "Split", 6, 0, 40),
      seed(),
    ],
    presets: [
      { name: "Signal loss", params: {} },
      { name: "Jitter", params: { amount: 10, height: 2, density: 1, split: 2 } },
      { name: "Shredder", params: { amount: 200, height: 6, density: 0.8, split: 0, seed: 42 } },
      { name: "Tear", params: { amount: 320, height: 130, density: 0.3, split: 18, seed: 19 } },
    ],
  },
  {
    id: "blocks",
    code: 20,
    label: "Data Corrupt",
    group: "Glitch",
    hint: "Misplaced, colour-damaged blocks",
    params: [
      px("size", "Block", 48, 8, 256, 2),
      px("amount", "Shift", 80, 0, 300, 2),
      pct("density", "Density", 0.3, 0, 1),
      pct("damage", "Damage", 0.5, 0, 1),
      seed(),
    ],
    presets: [
      { name: "Bad download", params: {} },
      { name: "Hiccup", params: { size: 96, amount: 30, density: 0.12, damage: 0.2, seed: 3 } },
      { name: "Datamosh", params: { size: 20, amount: 140, density: 0.55, damage: 0.15, seed: 64 } },
      { name: "Meltdown", params: { size: 32, amount: 260, density: 0.85, damage: 1, seed: 88 } },
    ],
  },
  {
    id: "wave",
    code: 21,
    label: "Wave",
    group: "Glitch",
    hint: "Ripple or jolt the image in bands",
    params: [
      px("amount", "Amount", 20, 0, 200, 2),
      px("length", "Length", 120, 4, 800, 2),
      deg("angle", "Angle", 0, 180),
      pct("jagged", "Jagged", 0, 0, 1),
    ],
    presets: [
      { name: "Heat haze", params: { amount: 5, length: 36 } },
      { name: "Flag", params: { amount: 45, length: 420 } },
      { name: "Sway", params: { amount: 25, length: 220, angle: 90 } },
      { name: "Earthquake", params: { amount: 34, length: 36, jagged: 1 } },
    ],
  },
  {
    id: "drift",
    code: 22,
    label: "Pixel Drift",
    group: "Glitch",
    hint: "Drag bright pixels into long streaks",
    params: [
      px("length", "Length", 160, 0, 600, 2),
      pct("threshold", "Threshold", 0.55, 0, 1),
      deg("angle", "Angle", 90),
      pct("ragged", "Ragged", 0.7, 0, 1),
    ],
    presets: [
      { name: "Melt", params: {} },
      { name: "Rain", params: { length: 80, threshold: 0.4, ragged: 1 } },
      { name: "Light trails", params: { length: 320, threshold: 0.75, angle: 0, ragged: 0.3 } },
      { name: "Rise", params: { length: 220, threshold: 0.6, angle: 270, ragged: 0.6 } },
    ],
  },
  {
    id: "duotone",
    code: 23,
    label: "Duotone",
    group: "Stylize",
    hint: "Remap shadows and highlights to two colours",
    params: [
      deg("shadow", "Shadows", 265),
      deg("highlight", "Highlights", 320),
      pct("saturation", "Colour", 0.85, 0, 1),
      pct("contrast", "Contrast", 0.1),
    ],
    presets: [
      { name: "Vaporwave", params: {} },
      { name: "Cyanotype", params: { shadow: 215, highlight: 195, saturation: 0.7, contrast: 0.15 } },
      { name: "Sunset", params: { shadow: 285, highlight: 35, saturation: 0.9 } },
      { name: "Matrix", params: { shadow: 135, highlight: 110, saturation: 0.9, contrast: 0.3 } },
      { name: "Blood moon", params: { shadow: 350, highlight: 22, saturation: 0.95, contrast: 0.3 } },
    ],
  },
  {
    id: "spectrum",
    code: 24,
    label: "Spectrum Map",
    group: "Stylize",
    hint: "Turn brightness into a rainbow of hues",
    params: [
      num("cycles", "Cycles", -0.69, -3, 3),
      deg("offset", "Offset", 250),
      pct("saturation", "Colour", 1, 0, 1),
      pct("shade", "Shade", 0.3, 0, 1),
    ],
    presets: [
      { name: "Thermal", params: {} },
      { name: "Night vision", params: { cycles: 0, offset: 120, saturation: 0.9, shade: 1 } },
      { name: "Acid", params: { cycles: 2.5, offset: 0, shade: 0 } },
      { name: "Oil slick", params: { cycles: -1.5, offset: 180, saturation: 0.7, shade: 0.6 } },
    ],
  },
  {
    id: "solarize",
    code: 28,
    label: "Solarize",
    group: "Stylize",
    hint: "Flip the tones above a threshold",
    params: [pct("threshold", "Threshold", 0.5, 0, 1), pct("softness", "Softness", 0.1, 0, 1)],
    presets: [
      { name: "Darkroom", params: {} },
      { name: "Burnt", params: { threshold: 0.3, softness: 0 } },
      { name: "Chrome", params: { threshold: 0.7, softness: 0.5 } },
    ],
  },
  {
    id: "dither",
    code: 25,
    label: "Dither",
    group: "Stylize",
    hint: "Retro ordered dithering in a few tones",
    params: [
      px("size", "Pixel", 3, 1, 16),
      num("levels", "Levels", 2, 2, 8),
      pct("color", "Colour", 0, 0, 1),
      deg("hue", "Tint hue", 75),
      pct("tint", "Tint", 0, 0, 1),
    ],
    presets: [
      { name: "1-bit", params: {} },
      { name: "Pocket green", params: { size: 4, levels: 4, tint: 1 } },
      { name: "Amber monitor", params: { size: 2, levels: 3, hue: 35, tint: 1 } },
      { name: "8-bit colour", params: { size: 4, levels: 3, color: 1 } },
    ],
  },
  {
    id: "ascii",
    code: 29,
    label: "ASCII",
    group: "Stylize",
    hint: "Rebuild the picture from text characters",
    params: [
      px("size", "Size", 12, 6, 48),
      pct("color", "Colour", 0, 0, 1),
      deg("hue", "Tint hue", 120),
    ],
    presets: [
      { name: "Terminal", params: { size: 10 } },
      { name: "Amber", params: { hue: 35 } },
      { name: "Full colour", params: { color: 1 } },
      { name: "Big type", params: { size: 28, color: 0.5, hue: 200 } },
    ],
  },
  {
    id: "neon",
    code: 26,
    label: "Neon Edges",
    group: "Stylize",
    hint: "Glowing outlines on a dark ground",
    params: [
      px("width", "Width", 1.5, 0.5, 6),
      pct("intensity", "Intensity", 1.5, 0, 4),
      deg("hue", "Hue", 185),
      pct("source", "Own colour", 0.5, 0, 1),
      pct("background", "Backdrop", 0, 0, 1),
    ],
    presets: [
      { name: "Grid runner", params: { intensity: 2, source: 0 } },
      { name: "Blacklight", params: { width: 2, intensity: 2, hue: 290, source: 0.7 } },
      { name: "Glow sketch", params: { width: 1, intensity: 3, source: 1 } },
      { name: "Overlay", params: { hue: 320, source: 0.3, background: 1 } },
    ],
  },
  {
    id: "kaleidoscope",
    code: 27,
    label: "Kaleidoscope",
    group: "Stylize",
    hint: "Mirror the image around its centre",
    params: [
      num("segments", "Segments", 6, 2, 24),
      deg("rotation", "Rotation"),
      num("zoom", "Zoom", 1, 0.25, 4),
    ],
    presets: [
      { name: "Mirror", params: { segments: 2 } },
      { name: "Snowflake", params: { segments: 6 } },
      { name: "Mandala", params: { segments: 16, zoom: 1.6 } },
      { name: "Tunnel", params: { segments: 10, rotation: 45, zoom: 0.5 } },
    ],
  },
]

/** A ready-made stack of adjustment layers, listed bottom to top. */
export interface Look {
  id: string
  label: string
  hint: string
  layers: { type: string; params?: Record<string, number>; opacity?: number }[]
}

export const LOOKS: Look[] = [
  {
    id: "vhs-rental",
    label: "Rental Tape",
    hint: "VHS bleed and wobble on a soft CRT",
    layers: [
      { type: "vhs" },
      { type: "crt", params: { lines: 3, intensity: 0.3, grille: 0, curve: 0.15 } },
    ],
  },
  {
    id: "vaporwave",
    label: "Vaporwave",
    hint: "Pink and violet duotone with split channels",
    layers: [
      { type: "duotone" },
      { type: "rgb-shift", params: { amount: 10 } },
      { type: "crt", params: { lines: 4, intensity: 0.4, grille: 0.2, curve: 0 } },
    ],
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    hint: "Saturated, torn and glowing",
    layers: [
      { type: "hue-saturation", params: { saturation: 0.4 } },
      { type: "slices", params: { amount: 40, height: 12, density: 0.15, split: 8 } },
      { type: "rgb-shift", params: { amount: 8 } },
      { type: "glow", params: { radius: 30, intensity: 0.7, threshold: 0.45 } },
    ],
  },
  {
    id: "broken-signal",
    label: "Broken Signal",
    hint: "Corrupt blocks, torn strips and static",
    layers: [
      { type: "blocks" },
      { type: "slices", params: { amount: 90, height: 10, density: 0.3, split: 10, seed: 23 } },
      { type: "noise", params: { amount: 0.25, color: 0.6 } },
    ],
  },
  {
    id: "thermal-cam",
    label: "Thermal Cam",
    hint: "Heat-map colours on a low-res sensor",
    layers: [
      { type: "pixelate", params: { size: 6 } },
      { type: "spectrum" },
      { type: "crt", params: { lines: 6, intensity: 0.4, grille: 0, curve: 0.1 } },
    ],
  },
  {
    id: "night-vision",
    label: "Night Vision",
    hint: "Grainy green goggles",
    layers: [
      { type: "spectrum", params: { cycles: 0, offset: 120, saturation: 0.9, shade: 1 } },
      { type: "noise", params: { amount: 0.3, color: 0 } },
      { type: "vignette", params: { amount: 0.8, size: 0.3, softness: 0.5 } },
    ],
  },
  {
    id: "terminal",
    label: "Hacker Terminal",
    hint: "Green text on a glowing tube",
    layers: [
      { type: "ascii", params: { size: 10 } },
      { type: "glow", params: { radius: 14, intensity: 0.9, threshold: 0.2 } },
      { type: "crt", params: { lines: 5, intensity: 0.35, grille: 0, curve: 0.5 } },
    ],
  },
  {
    id: "handheld",
    label: "Pocket Console",
    hint: "Four shades of pea-green pixels",
    layers: [
      { type: "brightness-contrast", params: { brightness: 0.05, contrast: 0.2 } },
      { type: "dither", params: { size: 5, levels: 4, tint: 1 } },
    ],
  },
  {
    id: "surveillance",
    label: "Surveillance",
    hint: "Black-and-white camera with a bad cable",
    layers: [
      { type: "monochrome" },
      { type: "vhs", params: { bleed: 0, wobble: 2, noise: 0.45, tracking: 0.8, seed: 44 } },
      { type: "crt", params: { lines: 6, intensity: 0.8, grille: 0, curve: 0.2 } },
    ],
  },
  {
    id: "acid-melt",
    label: "Acid Melt",
    hint: "Dripping streaks in shifting rainbow hues",
    layers: [
      { type: "drift" },
      { type: "spectrum", params: { cycles: 2.5, offset: 0, shade: 0 }, opacity: 0.65 },
      { type: "wave", params: { amount: 12, length: 180 } },
    ],
  },
  {
    id: "photocopy",
    label: "Photocopy",
    hint: "Harsh one-bit zine print",
    layers: [
      { type: "brightness-contrast", params: { brightness: 0, contrast: 0.55 } },
      { type: "dither", params: { size: 2, levels: 2 } },
      { type: "noise", params: { amount: 0.12, color: 0 } },
    ],
  },
  {
    id: "dream-mirror",
    label: "Dream Mirror",
    hint: "A soft, glowing kaleidoscope",
    layers: [
      { type: "kaleidoscope", params: { segments: 8 } },
      { type: "chromatic", params: { amount: 10 } },
      { type: "glow", params: { radius: 40, intensity: 0.8, threshold: 0.35 } },
    ],
  },
]

/**
 * Internal: blurs a mask and pushes its coverage through a threshold. Used
 * to grow, shrink and smooth selections; never offered as a layer effect.
 */
export const MASK_REMAP: EffectDef = {
  id: "mask-remap",
  code: 15,
  label: "Mask remap",
  group: "Filters",
  hint: "",
  params: [
    { key: "lo", label: "Low", min: 0, max: 1, value: 0.45, display: "number" },
    { key: "hi", label: "High", min: 0, max: 1, value: 0.55, display: "number" },
    { key: "sigma", label: "Sigma", min: 0, max: 200, value: 1, display: "px" },
  ],
  blur: (p) => p.sigma,
}

export const EFFECT_GROUPS: EffectGroup[] = [
  "Glitch",
  "Stylize",
  "Adjustments",
  "Filters",
  "Effects",
]

export function getEffect(id: string): EffectDef | undefined {
  if (id === MASK_REMAP.id) return MASK_REMAP
  return EFFECTS.find((e) => e.id === id)
}

export function defaultFx(def: EffectDef): LayerFx {
  const params: Record<string, number> = {}
  for (const p of def.params) params[p.key] = p.value
  return { type: def.id, params }
}

/** A preset's full parameter set: the effect's defaults with its overrides. */
export function presetParams(def: EffectDef, preset: EffectPreset): Record<string, number> {
  return { ...defaultFx(def).params, ...preset.params }
}

/** Random settings across each slider's range, for happy accidents. */
export function randomParams(def: EffectDef): Record<string, number> {
  const params: Record<string, number> = {}
  for (const p of def.params) {
    params[p.key] = p.min + (p.max - p.min) * Math.pow(Math.random(), p.exp ?? 1)
  }
  return params
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
