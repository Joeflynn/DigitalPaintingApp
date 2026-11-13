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
  over: Partial<StrokeSetup> = {}
): HTMLCanvasElement {
  const size = Math.min(70, Math.max(10, brush.size))
  gpu.begin({
    width: W,
    height: H,
    source: bandedLayer(),
    brush,
    color: [0.86, 0.26, 0.18],
    size,
    opacity: brush.opacity,
    seed: 42,
    mode: "paint",
    ...over,
  })
  const stroke = new Stroke((...dab) => gpu.dab(...dab), brush, {
    size,
    streamline: 0,
    seed: 42,
  })
  sampleStroke(stroke, 50, W - 50, brush.drip > 0 ? 55 : H / 2, 22, 160)
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
} catch (error) {
  results.push(`ERROR ${String(error)}`)
}
document.querySelector("#result")!.textContent = results.join("\n")
