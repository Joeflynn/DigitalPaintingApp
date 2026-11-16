// Visual and sanity checks for the WebGPU brush renderer.
// Open /tests/brush-lab.html under the Vite dev server.
import { BRUSHES, getBrush, type BrushPreset } from "../src/paint/brushes"
import { GPUBrush, type StrokeSetup } from "../src/paint/gpu-brush"
import { sampleStroke, Stroke } from "../src/paint/stroke"

const W = 900
const H = 170
const results: string[] = []
const check = (ok: boolean, name: string) =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}`)

/** A layer with a few bands of existing paint, to show pickup and smudging. */
function bandedLayer(): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const ctx = c.getContext("2d")!
  const bands = ["#2b5fb8", "#f6c445", "#b3261e"]
  bands.forEach((color, i) => {
    ctx.fillStyle = color
    ctx.fillRect(250 + i * 170, 20, 70, H - 40)
  })
  return c
}

function render(
  gpu: GPUBrush,
  brush: BrushPreset,
  over: Partial<StrokeSetup> = {},
  /** Constant pen pressure; omitted for the usual light-heavy-light sweep. */
  pressure?: number
): HTMLCanvasElement {
  const size = Math.min(70, Math.max(10, brush.size))
  gpu.begin({
    width: W,
    height: H,
    source: bandedLayer(),
    brush,
    color: [0.86, 0.26, 0.18],
    color2: [0.2, 0.45, 0.85],
    size,
    opacity: brush.opacity,
    seed: 42,
    mode: "paint",
    ...over,
  })
  const stroke = new Stroke((dab) => gpu.dab(dab), brush, {
    size,
    streamline: 0,
    seed: 42,
  })
  if (pressure === undefined) {
    sampleStroke(stroke, 50, W - 50, brush.drip > 0 ? 55 : H / 2, 22, 160)
  } else {
    for (let i = 0; i <= 160; i++) stroke.add(50 + (i / 160) * (W - 100), H / 2, pressure)
    stroke.end()
  }
  for (let i = 0; i < gpu.settleFrames; i++) gpu.frame()
  gpu.frame(false)
  const out = document.createElement("canvas")
  out.width = W
  out.height = H
  out.getContext("2d", { willReadFrequently: true })!.drawImage(gpu.canvas, 0, 0)
  return out
}

const pixels = (c: HTMLCanvasElement) =>
  c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data

function sum(data: Uint8ClampedArray, channel: number): number {
  let total = 0
  for (let i = channel; i < data.length; i += 4) total += data[i]
  return total
}

const samples = document.querySelector("#samples")!
function show(title: string, canvas: HTMLCanvasElement) {
  const figure = document.createElement("figure")
  const label = document.createElement("figcaption")
  label.textContent = title
  figure.append(canvas, label)
  samples.append(figure)
}

try {
  const gpu = await GPUBrush.create(() => {})
  const blank = sum(pixels(bandedLayer()), 3)

  for (const brush of BRUSHES) {
    const canvas = render(gpu, brush)
    show(brush.name, canvas)
    check(sum(pixels(canvas), 3) > blank, `${brush.name} leaves paint`)
  }

  const pen = getBrush("studio-pen")
  const a = pixels(render(gpu, pen))
  const b = pixels(render(gpu, pen))
  check(
    a.every((v, i) => v === b[i]),
    "the same seed renders the same stroke"
  )

  const erased = render(gpu, getBrush("hard-round"), { mode: "erase" })
  show("Hard Round as eraser", erased)
  check(sum(pixels(erased), 3) < blank, "erasing removes paint")

  const smudged = render(gpu, getBrush("soft-airbrush"), {
    mode: "smudge",
    opacity: 0.8,
  })
  show("Soft Airbrush as smudge", smudged)
  const sp = pixels(smudged)
  // Between the blue and yellow bands the layer starts out transparent.
  check(sp[(85 * W + 330) * 4 + 3] > 0, "smudging drags paint into gaps")

  const locked = render(gpu, getBrush("hard-round"), { alphaLock: true })
  show("Hard Round with alpha lock", locked)
  check(
    Math.abs(sum(pixels(locked), 3) - blank) < blank * 0.002,
    "alpha lock keeps coverage unchanged"
  )

  const oil = pixels(render(gpu, getBrush("loaded-oil")))
  const flat = pixels(render(gpu, { ...getBrush("loaded-oil"), pickup: 0 }))
  check(
    sum(oil, 2) > sum(flat, 2) * 1.01,
    "pickup carries blue paint along the stroke"
  )

  // ---- brush studio features ----------------------------------------------
  const round = { ...getBrush("hard-round"), sizePressure: 0 }
  const plain = sum(pixels(render(gpu, round)), 3)

  const dual = render(gpu, { ...round, dual: "splatter", dualBlend: "multiply" })
  show("Dual stamp: round × splatter", dual)
  check(sum(pixels(dual), 3) < plain * 0.97, "a dual stamp cuts into the tip")

  const weave = render(gpu, { ...round, texture: "canvas", grain: 1, textureBlend: "multiply", grainScale: 2 })
  show("Canvas texture, multiply", weave)
  check(sum(pixels(weave), 3) < plain * 0.97, "a canvas texture breaks up the mark")

  const dashes = render(gpu, { ...round, strokeTex: "dashes", strokeDepth: 1 })
  show("Stroke texture: dashes", dashes)
  check(sum(pixels(dashes), 3) < plain * 0.9, "a stroke texture runs along the path")

  // A raster stamp: a ring drawn on a canvas, as the studio would import it.
  const ring = document.createElement("canvas")
  ring.width = ring.height = 256
  const rc = ring.getContext("2d")!
  rc.fillStyle = "#000"
  rc.fillRect(0, 0, 256, 256)
  rc.strokeStyle = "#fff"
  rc.lineWidth = 34
  rc.beginPath()
  rc.arc(128, 128, 90, 0, Math.PI * 2)
  rc.stroke()
  const stamp = { ...round, tip: "image" as const, tipImage: ring.toDataURL(), spacing: 1.1, size: 70 }
  await gpu.preload(stamp)
  const stamped = render(gpu, stamp)
  show("Raster stamp: ring", stamped)
  const st = pixels(stamped)
  check(sum(st, 3) > blank, "a raster stamp leaves paint")
  // The first ring is centred on the start of the stroke; its middle is hollow.
  check(st[(85 * W + 50) * 4 + 3] === 0, "a raster stamp keeps its shape")

  // The band region of the layer starts out with no green beyond the bands'.
  const hueOf = (c: HTMLCanvasElement) => {
    const d = pixels(c)
    let g = 0
    for (let x = 60; x < 240; x++) g += d[(85 * W + x) * 4 + 1]
    return g
  }
  const jitter = render(gpu, { ...round, hueJitter: 1, spacing: 0.6 })
  show("Per-stamp hue jitter", jitter)
  check(hueOf(jitter) > hueOf(render(gpu, { ...round, spacing: 0.6 })) * 1.2, "hue jitter recolours stamps")

  const blender = {
    ...getBrush("loaded-oil"),
    links: [{ input: "pressure" as const, target: "load" as const, amount: 1, curve: 1 }],
  }
  const light = render(gpu, blender, {}, 0.03)
  const heavy = render(gpu, blender, {}, 1)
  show("Pressure → paint load: light touch", light)
  show("Pressure → paint load: heavy", heavy)
  // Over bare canvas before the first band, only a loaded brush leaves colour.
  const bare = (c: HTMLCanvasElement) => {
    const d = pixels(c)
    let a = 0
    for (let x = 80; x < 230; x++) a += d[(85 * W + x) * 4 + 3]
    return a
  }
  check(bare(heavy) > bare(light) * 3 + 1000, "light pressure blends, heavy pressure paints")
  // Just past the blue band the layer starts out transparent.
  const dragged = (c: HTMLCanvasElement) => {
    const d = pixels(c)
    let a = 0
    for (let y = 65; y < 105; y++) for (let x = 324; x < 345; x++) a += d[(y * W + x) * 4 + 3]
    return a
  }
  check(dragged(light) > 2000, "a light touch drags paint out of the bands")

  const wc = getBrush("watercolor")
  const glaze = pixels(render(gpu, wc))
  const opaque = pixels(render(gpu, { ...wc, paintBlend: "normal" }))
  // Middle of the yellow band: a glaze darkens it, opaque paint covers it.
  const at = (85 * W + 455) * 4
  check(glaze[at + 1] < 196 && glaze[at] > opaque[at] - 80, "a glaze tints what is beneath it")

  const feathered = render(gpu, { ...wc, feather: 1, bleed: 1, dryTime: 1 })
  show("Watercolour, full feathering", feathered)
  check(
    sum(pixels(feathered), 3) > sum(pixels(render(gpu, { ...wc, feather: 0, bleed: 0 })), 3),
    "feathering carries a wash outwards"
  )
} catch (error) {
  results.push(`ERROR ${String(error)}`)
}
document.querySelector("#result")!.textContent = results.join("\n")
