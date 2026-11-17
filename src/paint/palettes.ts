import { useSyncExternalStore } from "react"

import { rgbToHex, rgbToHsv } from "./color"
import { uid } from "./util"

/**
 * Palettes the user has collected (so far, by extracting them from imported
 * images), plus the offer to extract one that follows an import.
 */

export interface Palette {
  id: string
  name: string
  colors: string[]
}

export type ColorTab = "basic" | "palettes" | "values"

interface PaletteState {
  custom: Palette[]
  /** An image just imported, whose colours can be turned into a palette. */
  offer: { id: number; name: string; file: Blob } | null
  /** Which view the expanded colour panel shows. */
  tab: ColorTab
}

const KEY = "pigment.palettes.v1"

function load(): Palette[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Palette[]
    if (Array.isArray(raw)) return raw.filter((p) => p && Array.isArray(p.colors))
  } catch {
    // none saved
  }
  return []
}

let state: PaletteState = { custom: load(), offer: null, tab: "basic" }
const subscribers = new Set<() => void>()
let offers = 0

function commit(next: PaletteState) {
  if (next.custom !== state.custom) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.custom))
    } catch {
      // not remembered
    }
  }
  state = next
  subscribers.forEach((fn) => fn())
}

/**
 * Picks `count` colours that summarise an image, by median cut: the pixels
 * are repeatedly split along their widest colour channel and each group is
 * averaged. Returned dark to light within similar hues.
 */
export async function extractPalette(file: Blob, count = 8): Promise<string[]> {
  const image = await createImageBitmap(file)
  const k = Math.min(1, 96 / Math.max(image.width, image.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(image.width * k))
  canvas.height = Math.max(1, Math.round(image.height * k))
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  type Px = [number, number, number]
  const pixels: Px[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]])
  }
  if (pixels.length === 0) return []

  const spread = (box: Px[]) => {
    let best = 0
    let range = -1
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255
      let hi = 0
      for (const p of box) {
        lo = Math.min(lo, p[ch])
        hi = Math.max(hi, p[ch])
      }
      if (hi - lo > range) {
        range = hi - lo
        best = ch
      }
    }
    return { channel: best, range }
  }

  const boxes: Px[][] = [pixels]
  while (boxes.length < count) {
    // Split whichever group covers the most colour, weighted by its size.
    let pick = -1
    let score = 0
    boxes.forEach((box, i) => {
      const s = spread(box).range * Math.sqrt(box.length)
      if (box.length > 1 && s > score) {
        score = s
        pick = i
      }
    })
    if (pick < 0) break
    const box = boxes[pick]
    const { channel } = spread(box)
    box.sort((a, b) => a[channel] - b[channel])
    const mid = box.length >> 1
    boxes.splice(pick, 1, box.slice(0, mid), box.slice(mid))
  }

  const colors = boxes.map((box) => {
    const sum = [0, 0, 0]
    for (const p of box) for (let ch = 0; ch < 3; ch++) sum[ch] += p[ch]
    return sum.map((v) => Math.round(v / box.length)) as Px
  })
  colors.sort((a, b) => {
    const A = rgbToHsv(...a)
    const B = rgbToHsv(...b)
    return A.v - B.v || A.h - B.h
  })
  return [...new Set(colors.map((c) => rgbToHex(...c)))]
}

export const palettes = {
  subscribe(fn: () => void) {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  },
  get: () => state,
  setTab(tab: ColorTab) {
    commit({ ...state, tab })
  },
  /** Offers to extract a palette from an image that was just imported. */
  offerFor(name: string, file: Blob) {
    commit({ ...state, offer: { id: ++offers, name, file } })
  },
  dismissOffer() {
    if (state.offer) commit({ ...state, offer: null })
  },
  /** Extracts and saves a palette from the offered image. */
  async acceptOffer(): Promise<Palette | null> {
    const offer = state.offer
    if (!offer) return null
    commit({ ...state, offer: null })
    const colors = await extractPalette(offer.file).catch(() => [])
    if (colors.length === 0) return null
    const palette = { id: uid("palette"), name: offer.name, colors }
    commit({ ...state, custom: [palette, ...state.custom], tab: "palettes" })
    return palette
  },
  remove(id: string) {
    commit({ ...state, custom: state.custom.filter((p) => p.id !== id) })
  },
}

export function usePalettes() {
  return useSyncExternalStore(palettes.subscribe, palettes.get)
}

/** Imports image files onto the canvas and offers a palette from the last. */
export async function importImages(
  files: Iterable<File>,
  place: (file: File, name: string, index: number) => Promise<boolean>
) {
  let i = 0
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue
    const name = file.name.replace(/\.[^.]+$/, "") || "Image"
    if (await place(file, name, i++)) palettes.offerFor(name, file)
  }
}
