import { defaultFx, getEffect, LOOKS, type LayerFx } from "./effects"
import { GPUEffects } from "./gpu-effects"
import { previewRenderer } from "./preview-gpu"

/** Thumbnail size in device pixels (shown at 36 × 28 CSS px). */
const W = 108
const H = 84

let sample: HTMLCanvasElement | null = null
let effects: Promise<GPUEffects> | null = null
const cache = new Map<string, Promise<string | null>>()

/**
 * A small scene with the things effects act on: a soft gradient sky (the
 * design's thumbnail colours), a bright sun, hard-edged hills, fine stripes
 * and a dark band, so blurs, glitches and colour shifts all read.
 */
function sampleImage(): HTMLCanvasElement {
  if (sample) return sample
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const g = c.getContext("2d")!
  const sky = g.createLinearGradient(0, 0, W * 0.8, H * 0.9)
  sky.addColorStop(0, "rgb(237,227,204)")
  sky.addColorStop(0.5, "rgb(140,168,199)")
  sky.addColorStop(1, "rgb(92,118,168)")
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  g.fillStyle = "#f2a541"
  g.beginPath()
  g.arc(W * 0.7, H * 0.34, H * 0.17, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = "#e85c40"
  g.beginPath()
  g.moveTo(0, H * 0.78)
  g.lineTo(W * 0.28, H * 0.5)
  g.lineTo(W * 0.52, H * 0.74)
  g.lineTo(W * 0.74, H * 0.58)
  g.lineTo(W, H * 0.8)
  g.lineTo(W, H)
  g.lineTo(0, H)
  g.fill()
  g.fillStyle = "#264653"
  g.fillRect(0, H * 0.86, W, H * 0.14)
  g.fillStyle = "rgba(255,255,255,0.55)"
  for (let x = 6; x < W * 0.4; x += 5) g.fillRect(x, H * 0.14, 2, H * 0.22)
  sample = c
  return c
}

function gpuEffects(): Promise<GPUEffects> {
  effects ??= previewRenderer(() => {
    effects = null
    cache.clear()
  }).then((gpu) => new GPUEffects(gpu.device))
  return effects
}

function copy(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = src.width
  c.height = src.height
  c.getContext("2d")!.drawImage(src, 0, 0)
  return c
}

async function render(stack: LayerFx[]): Promise<string | null> {
  const fx = await gpuEffects()
  let image = copy(sampleImage())
  for (const layer of stack) {
    const out = fx.apply(image, layer, 1)
    if (!out) return null
    // The effect canvas is only readable during this task: take a copy now.
    image = copy(out)
  }
  return image.toDataURL()
}

/**
 * A data URL of the sample scene with an effect (`kind: "fx"`) or a look
 * applied at its default settings, or null where WebGPU is unavailable.
 */
export function effectPreview(kind: "fx" | "look", id: string): Promise<string | null> {
  const key = `${kind}:${id}`
  let hit = cache.get(key)
  if (!hit) {
    let stack: LayerFx[] = []
    if (kind === "fx") {
      const def = getEffect(id)
      if (def) stack = [defaultFx(def)]
    } else {
      const look = LOOKS.find((l) => l.id === id)
      stack = (look?.layers ?? []).flatMap((l) => {
        const def = getEffect(l.type)
        return def ? [{ ...defaultFx(def), params: { ...defaultFx(def).params, ...l.params } }] : []
      })
    }
    hit = stack.length ? render(stack).catch(() => null) : Promise.resolve(null)
    cache.set(key, hit)
  }
  return hit
}

/** The plain sample scene, shown while a preview renders or without WebGPU. */
export function sampleUrl(): string {
  return sampleImage().toDataURL()
}
