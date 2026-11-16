import { GPUBrush, GPUSizeError } from "./gpu-brush"
import {
  type BrushPreset,
  getBrush,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from "./brushes"
import { defaultFx, getEffect, type LayerFx } from "./effects"
import { GPUAnts } from "./gpu-ants"
import { GPUEffects } from "./gpu-effects"
import {
  floodSelect,
  growDab,
  isEmpty,
  maskToCanvas,
  SELECT_TOOLS,
  unionRect,
  type SelectMode,
  type SelectTool,
} from "./selection"
import { hexToHsv, hexToRgb, hsvToHex, rgbToHsv, type HSV } from "./color"
import { loadAutosave, saveAutosave, type SavedDoc } from "./storage"
import { Stroke, type SampleExtra } from "./stroke"
import {
  clamp,
  cloneCanvas,
  cropCanvas,
  ctxOf,
  makeCanvas,
  maskedBlend,
  uid,
  type Rect,
} from "./util"

export type { SelectMode, SelectTool }

export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

export const BLEND_MODES: { id: BlendMode; label: string; short: string }[] = [
  { id: "source-over", label: "Normal", short: "N" },
  { id: "multiply", label: "Multiply", short: "M" },
  { id: "darken", label: "Darken", short: "Dk" },
  { id: "color-burn", label: "Color Burn", short: "Cb" },
  { id: "screen", label: "Screen", short: "S" },
  { id: "lighten", label: "Lighten", short: "Li" },
  { id: "color-dodge", label: "Color Dodge", short: "Cd" },
  { id: "overlay", label: "Overlay", short: "O" },
  { id: "soft-light", label: "Soft Light", short: "Sl" },
  { id: "hard-light", label: "Hard Light", short: "Hl" },
  { id: "difference", label: "Difference", short: "D" },
  { id: "hue", label: "Hue", short: "H" },
  { id: "saturation", label: "Saturation", short: "Sa" },
  { id: "color", label: "Color", short: "C" },
  { id: "luminosity", label: "Luminosity", short: "Lu" },
]

export interface LayerMeta {
  id: string
  name: string
  visible: boolean
  opacity: number
  blend: BlendMode
  /** Paint only where the layer already has pixels. */
  alphaLock: boolean
  /** Clip this layer to the alpha of the layer below. */
  clip: boolean
  /** Changes whenever the layer's pixels change (drives thumbnails). */
  rev: number
  /**
   * Set on adjustment layers: they hold no pixels and instead apply this
   * effect to everything beneath them (or, when clipped, to the layer below).
   */
  fx?: LayerFx
  /** The layer has a mask: where the mask is empty the layer is hidden. */
  mask?: boolean
  /** The mask is kept but temporarily ignored. */
  maskOff?: boolean
  /** Changes whenever the mask's pixels change. */
  maskRev?: number
}

/** Which of a layer's two canvases an edit goes to. */
type Target = "pixels" | "mask"

export type SelectModify = "feather" | "grow" | "shrink" | "smooth"

export interface SelectOptions {
  selMode: SelectMode
  /** Soft edge, in px, given to rectangle and lasso selections. */
  selFeather: number
  wandTolerance: number
  wandContiguous: boolean
  /** Wand and selection brush read the whole picture, not just the layer. */
  sampleAll: boolean
  selBrushSize: number
  /** Selection brush snaps to edges by following contrast. */
  selBrushEdge: boolean
  selBrushContrast: number
}

export type PaintTool = "brush" | "eraser" | "smudge"
export type ToolId =
  | PaintTool
  | SelectTool
  | "fill"
  | "eyedropper"
  | "move"
  | "hand"

export function isSelectTool(t: ToolId): t is SelectTool {
  return (SELECT_TOOLS as string[]).includes(t)
}

export function isPaintTool(t: ToolId): t is PaintTool {
  return t === "brush" || t === "eraser" || t === "smudge"
}

export interface ToolSettings {
  dynamics?: Partial<BrushPreset>
  brushId: string
  size: number
  opacity: number
  streamline: number
}

export interface EngineState extends SelectOptions {
  ready: boolean
  hasSelection: boolean
  canReselect: boolean
  /** The selection tool the tool rail's selection button stands for. */
  selectTool: SelectTool
  /** Painting goes to the active layer's mask rather than its pixels. */
  editMask: boolean
  docW: number
  docH: number
  background: string
  showBackground: boolean
  layers: LayerMeta[]
  activeLayerId: string
  tool: ToolId
  toolSettings: Record<PaintTool, ToolSettings>
  color: HSV
  prevColor: HSV
  recentColors: string[]
  symmetry: boolean
  fillTolerance: number
  canUndo: boolean
  canRedo: boolean
  zoom: number
  rotation: number
  notice: { id: number; text: string } | null
}

interface UndoEntry {
  undo(): void
  redo(): void
}

interface StructSnap {
  layers: LayerMeta[]
  activeLayerId: string
  canvases: Map<string, HTMLCanvasElement>
  masks: Map<string, HTMLCanvasElement>
  selection: HTMLCanvasElement | null
  editMask: boolean
}

type Action =
  | {
      kind: "stroke"
      pointerId: number
      stroke: Stroke
      layerId: string
      target: Target
    }
  | {
      kind: "marquee"
      pointerId: number
      mode: SelectMode
      x0: number
      y0: number
      x1: number
      y1: number
      sx: number
      sy: number
    }
  | { kind: "lasso"; pointerId: number; mode: SelectMode; pts: number[] }
  | {
      kind: "selbrush"
      pointerId: number
      mode: SelectMode
      /** The selection as it was before this stroke. */
      base: HTMLCanvasElement | null
      /** The picture the brush reads edges from, when edge-aware. */
      px: Uint8ClampedArray | null
      mask: Uint8Array
      stroke: HTMLCanvasElement
      preview: HTMLCanvasElement
      lx: number
      ly: number
    }
  | { kind: "pan"; pointerId: number; lx: number; ly: number }
  | { kind: "rotate"; pointerId: number; last: number }
  | { kind: "pick"; pointerId: number }
  | {
      kind: "move"
      pointerId: number
      layerId: string
      x0: number
      y0: number
      dx: number
      dy: number
      /** Selected pixels lifted off the layer, and what they left behind. */
      float?: { cut: HTMLCanvasElement; rest: HTMLCanvasElement }
    }

interface Gesture {
  cx: number
  cy: number
  dist: number
  angle: number
  view: { tx: number; ty: number; scale: number; rot: number }
  t0: number
  moved: boolean
  maxTouches: number
}

const MAX_UNDO = 50
const MIN_ZOOM = 0.03
const MAX_ZOOM = 48

let revCounter = 1
const nextRev = () => ++revCounter

function defaultSettings(
  brushId: string,
  size?: number,
  opacity?: number
): ToolSettings {
  const b = getBrush(brushId)
  return {
    brushId,
    size: size ?? b.size,
    opacity: opacity ?? b.opacity,
    streamline: b.streamline,
  }
}

export class PaintEngine {
  private state: EngineState = {
    ready: false,
    docW: 2000,
    docH: 1400,
    background: "#f6f3ec",
    showBackground: true,
    layers: [],
    activeLayerId: "",
    tool: "brush",
    toolSettings: {
      brush: defaultSettings("studio-pen"),
      eraser: defaultSettings("hard-round"),
      smudge: defaultSettings("soft-airbrush", 70, 0.7),
    },
    color: { h: 18, s: 0.78, v: 0.2 },
    prevColor: { h: 12, s: 0.72, v: 0.86 },
    recentColors: [],
    symmetry: false,
    fillTolerance: 40,
    canUndo: false,
    canRedo: false,
    zoom: 1,
    rotation: 0,
    notice: null,
    hasSelection: false,
    canReselect: false,
    selectTool: "select-rect",
    editMask: false,
    selMode: "replace",
    selFeather: 0,
    wandTolerance: 32,
    wandContiguous: true,
    sampleAll: true,
    selBrushSize: 60,
    selBrushEdge: true,
    selBrushContrast: 30,
  }

  private listeners = new Set<() => void>()
  private canvases = new Map<string, HTMLCanvasElement>()
  private gpu: GPUBrush | null = null
  private fx: GPUEffects | null = null
  private ants: GPUAnts | null = null
  private masks = new Map<string, HTMLCanvasElement>()
  /** Coverage of the current selection in its alpha channel, or null. */
  private selection: HTMLCanvasElement | null = null
  private lastSelection: HTMLCanvasElement | null = null
  private selRev = 0
  private antTimer = 0
  /** Polygonal lasso in progress; it spans many clicks, so it is not an Action. */
  private poly: {
    pts: number[]
    mode: SelectMode
    hx: number
    hy: number
    t: number
    sx: number
    sy: number
  } | null = null
  /** Document-sized working canvases, made on first use. */
  private scratches = new Map<string, HTMLCanvasElement>()
  /** A finished stroke whose wet paint is still flowing before it is committed. */
  private settling: {
    stroke: Stroke
    layerId: string
    target: Target
    frames: number
  } | null = null
  private scratchB = makeCanvas(1, 1)
  /** Holds a base layer and its clipped layers while effects run on them. */
  private scratchG = makeCanvas(1, 1)
  /** The flattened document, used whenever adjustment layers are showing. */
  private comp = makeCanvas(1, 1)
  private compKey: string | null = null
  private fxEdit: {
    id: string
    at: number
    after: LayerFx
    entry: UndoEntry
  } | null = null
  private checker: CanvasPattern | null = null

  private display: HTMLCanvasElement | null = null
  private cursorEl: HTMLElement | null = null
  private vw = 1
  private vh = 1
  private dpr = 1
  private insets = { left: 0, right: 0 }
  private view = { tx: 0, ty: 0, scale: 1, rot: 0 }
  private needsFit = true
  private raf = 0

  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []

  private action: Action | null = null
  private gesture: Gesture | null = null
  private touches = new Map<number, { x: number; y: number }>()
  private spaceDown = false
  private rotateKey = false
  private simPressure = 0.75
  private lastScreen = { x: 0, y: 0 }
  private pointerInside = false

  private layerCounter = 0
  private noticeId = 0
  private saveTimer = 0
  private blobCache = new Map<string, { rev: number; blob: Blob }>()

  // ---- store ---------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getState = () => this.state

  private setState(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  notify(text: string) {
    this.setState({ notice: { id: ++this.noticeId, text } })
  }

  // ---- document ------------------------------------------------------------

  async init() {
    try {
      this.gpu = await GPUBrush.create(() => {
        this.settling = null
        this.action = null
        this.gpu = null
        this.fx = null
        this.ants = null
        this.requestRender()
        this.notify("Graphics device lost. Reload to resume painting.")
      })
      this.fx = new GPUEffects(this.gpu.device)
      this.ants = new GPUAnts(this.gpu.device)
    } catch {
      this.notify("Painting requires a browser with WebGPU enabled.")
    }
    const saved: SavedDoc | null = await loadAutosave().catch(() => null)
    if (saved && saved.layers.length > 0) {
      try {
        await this.loadSaved(saved)
        return
      } catch {
        // fall through to a fresh document
      }
    }
    this.newDocument(2000, 1400)
  }

  private async loadSaved(doc: SavedDoc) {
    this.allocate(doc.width, doc.height)
    this.canvases.clear()
    this.masks.clear()
    this.resetSelection()
    for (const meta of doc.layers) {
      const c = meta.fx ? makeCanvas(1, 1) : makeCanvas(doc.width, doc.height)
      const blob = doc.blobs[meta.id]
      if (blob) {
        const bmp = await createImageBitmap(blob)
        ctxOf(c).drawImage(bmp, 0, 0)
        bmp.close()
        this.blobCache.set(meta.id, { rev: meta.rev, blob })
      }
      this.canvases.set(meta.id, c)
      const maskBlob = meta.mask ? doc.blobs[`${meta.id}#mask`] : undefined
      if (meta.mask) {
        const mc = makeCanvas(doc.width, doc.height)
        if (maskBlob) {
          const bmp = await createImageBitmap(maskBlob)
          ctxOf(mc).drawImage(bmp, 0, 0)
          bmp.close()
          this.blobCache.set(`${meta.id}#mask`, {
            rev: meta.maskRev ?? 0,
            blob: maskBlob,
          })
        }
        this.masks.set(meta.id, mc)
      }
      revCounter = Math.max(revCounter, meta.rev, meta.maskRev ?? 0)
    }
    this.layerCounter = doc.layers.length
    this.undoStack = []
    this.redoStack = []
    this.needsFit = true
    this.setState({
      ready: true,
      docW: doc.width,
      docH: doc.height,
      background: doc.background,
      showBackground: doc.showBackground,
      layers: doc.layers,
      activeLayerId: doc.activeLayerId,
      hasSelection: false,
      canReselect: false,
      editMask: false,
      canUndo: false,
      canRedo: false,
    })
    this.fit()
  }

  private allocate(w: number, h: number) {
    this.scratchB = makeCanvas(w, h)
    this.scratchG = makeCanvas(w, h)
    this.comp = makeCanvas(w, h)
    this.compKey = null
    this.scratches.clear()
  }

  private scratch(key: string): HTMLCanvasElement {
    let c = this.scratches.get(key)
    if (!c) {
      c = makeCanvas(this.state.docW, this.state.docH)
      this.scratches.set(key, c)
    }
    return c
  }

  private resetSelection() {
    this.selection = null
    this.lastSelection = null
    this.poly = null
    this.selRev++
  }

  newDocument(w: number, h: number, background = "#f6f3ec") {
    this.cancelAction()
    this.allocate(w, h)
    this.canvases.clear()
    this.masks.clear()
    this.resetSelection()
    this.blobCache.clear()
    this.layerCounter = 0
    const layer = this.makeLayer()
    this.canvases.set(layer.id, makeCanvas(w, h))
    this.undoStack = []
    this.redoStack = []
    this.needsFit = true
    this.setState({
      ready: true,
      docW: w,
      docH: h,
      background,
      showBackground: true,
      layers: [layer],
      activeLayerId: layer.id,
      hasSelection: false,
      canReselect: false,
      editMask: false,
      canUndo: false,
      canRedo: false,
    })
    this.fit()
    this.scheduleSave()
  }

  private makeLayer(name?: string): LayerMeta {
    this.layerCounter += 1
    return {
      id: uid("layer"),
      name: name ?? `Layer ${this.layerCounter}`,
      visible: true,
      opacity: 1,
      blend: "source-over",
      alphaLock: false,
      clip: false,
      rev: nextRev(),
    }
  }

  getLayerCanvas(id: string): HTMLCanvasElement | undefined {
    return this.canvases.get(id)
  }

  private activeLayer(): LayerMeta | undefined {
    return this.state.layers.find((l) => l.id === this.state.activeLayerId)
  }

  getMaskCanvas(id: string): HTMLCanvasElement | undefined {
    return this.masks.get(id)
  }

  private bumpRev(id: string, target: Target = "pixels") {
    this.setState({
      layers: this.state.layers.map((l) =>
        l.id !== id
          ? l
          : target === "mask"
            ? { ...l, maskRev: nextRev() }
            : { ...l, rev: nextRev() }
      ),
    })
  }

  // ---- undo ----------------------------------------------------------------

  private pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
    this.setState({ canUndo: true, canRedo: false })
    this.scheduleSave()
  }

  undo() {
    this.finishSettle()
    if (this.action) return
    const e = this.undoStack.pop()
    if (!e) return
    e.undo()
    this.redoStack.push(e)
    this.afterHistory()
  }

  redo() {
    this.finishSettle()
    if (this.action) return
    const e = this.redoStack.pop()
    if (!e) return
    e.redo()
    this.undoStack.push(e)
    this.afterHistory()
  }

  private afterHistory() {
    this.setState({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    })
    this.requestRender()
    this.scheduleSave()
  }

  private snap(): StructSnap {
    return {
      layers: this.state.layers,
      activeLayerId: this.state.activeLayerId,
      canvases: new Map(this.canvases),
      masks: new Map(this.masks),
      selection: this.selection,
      editMask: this.state.editMask,
    }
  }

  private restore(s: StructSnap) {
    this.canvases = new Map(s.canvases)
    this.masks = new Map(s.masks)
    this.poly = null
    this.selection = s.selection
    this.selRev++
    this.setState({
      layers: s.layers,
      activeLayerId: s.activeLayerId,
      hasSelection: !!s.selection,
      editMask: s.editMask,
    })
  }

  /** Runs a structural change and records before/after for undo. */
  private structural(fn: () => void) {
    this.cancelAction()
    const before = this.snap()
    fn()
    const after = this.snap()
    this.pushUndo({
      undo: () => this.restore(before),
      redo: () => this.restore(after),
    })
    this.requestRender()
  }

  private applyPatch(
    layerId: string,
    r: Rect,
    patch: HTMLCanvasElement,
    target: Target
  ) {
    const c = (target === "mask" ? this.masks : this.canvases).get(layerId)
    if (!c) return
    const ctx = ctxOf(c)
    ctx.clearRect(r.x, r.y, r.w, r.h)
    ctx.drawImage(patch, r.x, r.y)
    this.bumpRev(layerId, target)
  }

  // ---- layer operations ----------------------------------------------------

  setActiveLayer(id: string) {
    this.finishSettle()
    if (this.action) return
    this.setState({ activeLayerId: id, editMask: false })
  }

  addLayer() {
    this.structural(() => {
      const { layers, activeLayerId, docW, docH } = this.state
      const layer = this.makeLayer()
      this.canvases.set(layer.id, makeCanvas(docW, docH))
      const idx = layers.findIndex((l) => l.id === activeLayerId)
      const next = layers.slice()
      next.splice(idx + 1, 0, layer)
      this.setState({ layers: next, activeLayerId: layer.id })
    })
  }

  addImageLayer(img: CanvasImageSource, iw: number, ih: number, name: string) {
    this.structural(() => {
      const { layers, activeLayerId, docW, docH } = this.state
      const layer = this.makeLayer(name)
      const c = makeCanvas(docW, docH)
      const s = Math.min(1, docW / iw, docH / ih)
      const w = iw * s
      const h = ih * s
      ctxOf(c).drawImage(img, (docW - w) / 2, (docH - h) / 2, w, h)
      this.canvases.set(layer.id, c)
      const idx = layers.findIndex((l) => l.id === activeLayerId)
      const next = layers.slice()
      next.splice(idx + 1, 0, layer)
      this.setState({ layers: next, activeLayerId: layer.id })
    })
  }

  /** Adds an adjustment layer running the given effect above the active layer. */
  addAdjustment(type: string) {
    const def = getEffect(type)
    if (!def) return
    if (!this.fx) {
      this.notify("Effects require a browser with WebGPU enabled.")
      return
    }
    this.structural(() => {
      const { layers, activeLayerId } = this.state
      this.layerCounter -= 1
      const layer: LayerMeta = { ...this.makeLayer(def.label), fx: defaultFx(def) }
      this.canvases.set(layer.id, makeCanvas(1, 1))
      const idx = layers.findIndex((l) => l.id === activeLayerId)
      const next = layers.slice()
      next.splice(idx + 1, 0, layer)
      this.setState({ layers: next, activeLayerId: layer.id })
    })
  }

  /**
   * Changes an adjustment layer's effect settings. Rapid changes (a slider
   * drag) collapse into a single undo step.
   */
  setFxParams(id: string, params: Record<string, number>) {
    this.cancelAction()
    const before = this.state.layers.find((l) => l.id === id)?.fx
    if (!before) return
    const next: LayerFx = { ...before, params: { ...before.params, ...params } }
    const set = (fx: LayerFx) => {
      this.setState({
        layers: this.state.layers.map((l) => (l.id === id ? { ...l, fx } : l)),
      })
    }
    set(next)
    const now = performance.now()
    const e = this.fxEdit
    if (
      e &&
      e.id === id &&
      this.undoStack[this.undoStack.length - 1] === e.entry &&
      now - e.at < 1200
    ) {
      e.after = next
      e.at = now
      this.scheduleSave()
    } else {
      const edit = { id, at: now, after: next, entry: null as unknown as UndoEntry }
      edit.entry = { undo: () => set(before), redo: () => set(edit.after) }
      this.fxEdit = edit
      this.pushUndo(edit.entry)
    }
    this.requestRender()
  }

  duplicateLayer(id: string) {
    const src = this.canvases.get(id)
    const meta = this.state.layers.find((l) => l.id === id)
    if (!src || !meta) return
    this.structural(() => {
      const copy: LayerMeta = {
        ...meta,
        id: uid("layer"),
        name: `${meta.name} copy`,
        rev: nextRev(),
      }
      this.canvases.set(copy.id, cloneCanvas(src))
      const mask = this.masks.get(id)
      if (mask) {
        this.masks.set(copy.id, cloneCanvas(mask))
        copy.maskRev = nextRev()
      }
      const next = this.state.layers.slice()
      next.splice(next.indexOf(meta) + 1, 0, copy)
      this.setState({ layers: next, activeLayerId: copy.id })
    })
  }

  deleteLayer(id: string) {
    const { layers } = this.state
    if (layers.length <= 1) {
      this.clearLayer(id)
      return
    }
    this.structural(() => {
      const idx = layers.findIndex((l) => l.id === id)
      const next = layers.filter((l) => l.id !== id)
      this.canvases.delete(id)
      this.masks.delete(id)
      let active = this.state.activeLayerId
      if (active === id) active = next[Math.max(0, idx - 1)].id
      this.setState({ layers: next, activeLayerId: active })
    })
  }

  mergeDown(id: string) {
    const { layers } = this.state
    const idx = layers.findIndex((l) => l.id === id)
    if (idx <= 0) {
      this.notify("No layer below to merge into")
      return
    }
    const upper = layers[idx]
    const lower = layers[idx - 1]
    if (lower.fx) {
      this.notify("Can't merge into an adjustment layer")
      return
    }
    if (upper.fx && !this.fx) return
    this.structural(() => {
      // Masks are baked in first: the merged layer has none.
      const merged = this.bakedPixels(lower)
      const upperMask = upper.mask && !upper.maskOff && this.masks.get(upper.id)
      if (upper.fx) {
        // Bake the effect into the pixels of the layer below.
        const out = this.fx?.apply(merged, upper.fx, upper.opacity)
        if (out) {
          const baked = cloneCanvas(out)
          if (upperMask) {
            const { docW, docH } = this.state
            const m = ctxOf(merged)
            m.globalCompositeOperation = "copy"
            m.drawImage(
              maskedBlend(
                makeCanvas(docW, docH),
                makeCanvas(docW, docH),
                this.bakedPixels(lower),
                baked,
                upperMask
              ),
              0,
              0
            )
            m.globalCompositeOperation = "source-over"
          } else {
            const m = ctxOf(merged)
            m.globalCompositeOperation = "copy"
            m.drawImage(baked, 0, 0)
            m.globalCompositeOperation = "source-over"
          }
        }
      } else {
        const ctx = ctxOf(merged)
        ctx.globalAlpha = upper.opacity
        ctx.globalCompositeOperation = upper.clip ? "source-atop" : upper.blend
        ctx.drawImage(this.bakedPixels(upper), 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = "source-over"
      }
      this.canvases.set(lower.id, merged)
      this.canvases.delete(upper.id)
      this.masks.delete(upper.id)
      this.masks.delete(lower.id)
      this.setState({
        layers: layers
          .filter((l) => l.id !== upper.id)
          .map((l) =>
            l.id === lower.id
              ? { ...l, rev: nextRev(), mask: false, maskOff: false }
              : l
          ),
        activeLayerId: lower.id,
        editMask: false,
      })
    })
  }

  /** A copy of a layer's pixels with its mask, if any, applied. */
  private bakedPixels(m: LayerMeta): HTMLCanvasElement {
    const c = cloneCanvas(this.canvases.get(m.id)!)
    const mask = m.mask && !m.maskOff && this.masks.get(m.id)
    if (mask) {
      const ctx = ctxOf(c)
      ctx.globalCompositeOperation = "destination-in"
      ctx.drawImage(mask, 0, 0)
      ctx.globalCompositeOperation = "source-over"
    }
    return c
  }

  moveLayer(id: string, dir: 1 | -1) {
    const { layers } = this.state
    const idx = layers.findIndex((l) => l.id === id)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= layers.length) return
    this.structural(() => {
      const next = layers.slice()
      const [l] = next.splice(idx, 1)
      next.splice(to, 0, l)
      this.setState({ layers: next })
    })
  }

  setLayerProps(
    id: string,
    patch: Partial<Omit<LayerMeta, "id" | "rev">>,
    undoable = true
  ) {
    const apply = () =>
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id ? { ...l, ...patch } : l
        ),
      })
    if (undoable) this.structural(apply)
    else {
      apply()
      this.requestRender()
      this.scheduleSave()
    }
  }

  /** Replaces a layer's pixels (or its mask) with a new canvas, undoably. */
  private replaceCanvas(
    id: string,
    build: (src: HTMLCanvasElement) => HTMLCanvasElement,
    target: Target = "pixels"
  ) {
    const map = target === "mask" ? this.masks : this.canvases
    const src = map.get(id)
    if (!src) return
    if (
      target === "pixels" &&
      this.state.layers.find((l) => l.id === id)?.fx
    ) {
      this.notify("Adjustment layers have no pixels to edit")
      return
    }
    this.structural(() => {
      (target === "mask" ? this.masks : this.canvases).set(id, build(src))
      this.bumpRev(id, target)
    })
  }

  clearLayer(id: string) {
    this.replaceCanvas(id, (src) => makeCanvas(src.width, src.height))
  }

  flipLayer(id: string, axis: "h" | "v") {
    this.replaceCanvas(id, (src) => {
      const c = makeCanvas(src.width, src.height)
      const ctx = ctxOf(c)
      if (axis === "h") ctx.setTransform(-1, 0, 0, 1, src.width, 0)
      else ctx.setTransform(1, 0, 0, -1, 0, src.height)
      ctx.drawImage(src, 0, 0)
      return c
    })
  }

  setBackground(color: string) {
    this.setState({ background: color })
    this.requestRender()
    this.scheduleSave()
  }

  setShowBackground(show: boolean) {
    this.setState({ showBackground: show })
    this.requestRender()
    this.scheduleSave()
  }

  // ---- tools & colour ------------------------------------------------------

  setTool(tool: ToolId) {
    if (this.poly) {
      this.poly = null
      this.requestRender()
    }
    this.setState(
      isSelectTool(tool) ? { tool, selectTool: tool } : { tool }
    )
    this.updateCursor()
  }

  /** The paint tool whose brush settings the UI should show. */
  settingsTool(): PaintTool {
    return isPaintTool(this.state.tool) ? this.state.tool : "brush"
  }

  setToolSettings(tool: PaintTool, patch: Partial<ToolSettings>) {
    const cur = this.state.toolSettings[tool]
    const next = { ...cur, ...patch }
    next.size = clamp(next.size, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE)
    next.opacity = clamp(next.opacity, 0.01, 1)
    next.streamline = clamp(next.streamline, 0, 1)
    this.setState({
      toolSettings: { ...this.state.toolSettings, [tool]: next },
    })
    // Raster stamps decode in the background; have them ready for the stroke.
    void this.gpu?.preload(this.activeBrush(tool))
    this.updateCursor()
  }

  selectBrush(tool: PaintTool, brushId: string) {
    const keepOpacity =
      tool === "smudge" ? this.state.toolSettings.smudge.opacity : undefined
    this.setToolSettings(tool, {
      ...defaultSettings(brushId, undefined, keepOpacity),
      dynamics: {},
    })
  }

  nudgeSize(dir: 1 | -1) {
    if (this.state.tool === "select-brush") {
      const size = this.state.selBrushSize
      this.setSelectOptions({
        selBrushSize: size + dir * Math.max(1, Math.round(size * 0.12)),
      })
      return
    }
    const tool = this.settingsTool()
    const size = this.state.toolSettings[tool].size
    const step = Math.max(1, Math.round(size * 0.12))
    this.setToolSettings(tool, { size: size + dir * step })
  }

  setColor(color: HSV) {
    this.setState({ color })
  }

  setColorHex(hex: string) {
    const hsv = hexToHsv(hex, this.state.color.h)
    if (hsv) this.setState({ color: hsv })
  }

  swapColors() {
    this.setState({ color: this.state.prevColor, prevColor: this.state.color })
  }

  private rememberColor() {
    const hex = hsvToHex(this.state.color)
    const recent = this.state.recentColors
    if (recent[0] === hex) return
    this.setState({
      recentColors: [hex, ...recent.filter((c) => c !== hex)].slice(0, 16),
    })
  }

  setSymmetry(on: boolean) {
    this.setState({ symmetry: on })
    this.requestRender()
  }

  setFillTolerance(v: number) {
    this.setState({ fillTolerance: clamp(Math.round(v), 0, 255) })
  }

  // ---- view ----------------------------------------------------------------

  attach(canvas: HTMLCanvasElement, cursorEl: HTMLElement | null): () => void {
    this.display = canvas
    this.cursorEl = cursorEl
    const opts: AddEventListenerOptions = { passive: false }
    canvas.addEventListener("pointerdown", this.onDown, opts)
    canvas.addEventListener("pointermove", this.onMove, opts)
    canvas.addEventListener("pointerup", this.onUp, opts)
    canvas.addEventListener("pointercancel", this.onCancel, opts)
    canvas.addEventListener("pointerleave", this.onLeave)
    canvas.addEventListener("wheel", this.onWheel, opts)
    canvas.addEventListener("contextmenu", this.onContext)
    this.requestRender()
    return () => {
      canvas.removeEventListener("pointerdown", this.onDown)
      canvas.removeEventListener("pointermove", this.onMove)
      canvas.removeEventListener("pointerup", this.onUp)
      canvas.removeEventListener("pointercancel", this.onCancel)
      canvas.removeEventListener("pointerleave", this.onLeave)
      canvas.removeEventListener("wheel", this.onWheel)
      canvas.removeEventListener("contextmenu", this.onContext)
      if (this.display === canvas) this.display = null
    }
  }

  resize(w: number, h: number, dpr: number) {
    if (!this.display || w < 1 || h < 1) return
    const first = this.vw <= 1
    // keep the canvas centred where it was when the window changes size
    this.view.tx += (w - this.vw) / 2
    this.view.ty += (h - this.vh) / 2
    this.vw = w
    this.vh = h
    this.dpr = dpr
    this.display.width = Math.round(w * dpr)
    this.display.height = Math.round(h * dpr)
    if (first || this.needsFit) this.fit()
    this.requestRender()
  }

  setInsets(left: number, right: number) {
    this.insets = { left, right }
  }

  fit() {
    const { docW, docH } = this.state
    if (this.vw <= 1) {
      this.needsFit = true
      return
    }
    this.needsFit = false
    const availW = Math.max(
      100,
      this.vw - this.insets.left - this.insets.right - 48
    )
    const availH = Math.max(100, this.vh - 48)
    const scale = Math.min(availW / docW, availH / docH)
    const cx =
      this.insets.left + (this.vw - this.insets.left - this.insets.right) / 2
    const cy = this.vh / 2
    this.view = {
      scale,
      rot: 0,
      tx: cx - (docW * scale) / 2,
      ty: cy - (docH * scale) / 2,
    }
    this.viewChanged()
  }

  private viewChanged() {
    const zoom = this.view.scale
    const rotation = this.view.rot
    if (zoom !== this.state.zoom || rotation !== this.state.rotation) {
      this.setState({ zoom, rotation })
    }
    this.updateCursor()
    this.requestRender()
  }

  screenToDoc(sx: number, sy: number): [number, number] {
    const { tx, ty, scale, rot } = this.view
    const dx = (sx - tx) / scale
    const dy = (sy - ty) / scale
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    return [dx * c + dy * s, -dx * s + dy * c]
  }

  /** Re-anchors the view so document point (x, y) sits at screen (sx, sy). */
  private anchor(x: number, y: number, sx: number, sy: number) {
    const { scale, rot } = this.view
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    this.view.tx = sx - scale * (x * c - y * s)
    this.view.ty = sy - scale * (x * s + y * c)
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [x, y] = this.screenToDoc(sx, sy)
    this.view.scale = clamp(this.view.scale * factor, MIN_ZOOM, MAX_ZOOM)
    this.anchor(x, y, sx, sy)
    this.viewChanged()
  }

  zoomBy(factor: number) {
    const cx =
      this.insets.left + (this.vw - this.insets.left - this.insets.right) / 2
    this.zoomAt(cx, this.vh / 2, factor)
  }

  rotateBy(radians: number, sx = this.vw / 2, sy = this.vh / 2) {
    const [x, y] = this.screenToDoc(sx, sy)
    this.view.rot += radians
    this.anchor(x, y, sx, sy)
    this.viewChanged()
  }

  resetRotation() {
    this.rotateBy(-this.view.rot)
  }

  setSpace(down: boolean) {
    this.spaceDown = down
    this.updateCursor()
  }

  setRotateKey(down: boolean) {
    this.rotateKey = down
  }

  // ---- rendering -----------------------------------------------------------

  requestRender() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.render()
    })
  }

  private baseOf(index: number): LayerMeta | null {
    const { layers } = this.state
    for (let j = index - 1; j >= 0; j--) {
      if (!layers[j].clip) return layers[j]
    }
    return null
  }

  /** The paint layer that clipped layer `index` is masked by, if any. */
  private clipBase(index: number): LayerMeta | null {
    if (!this.state.layers[index].clip) return null
    const base = this.baseOf(index)
    return base && !base.fx ? base : null
  }

  /** True while the GPU brush is painting on this canvas of this layer. */
  private isLive(m: LayerMeta, target: Target): boolean {
    const live = this.liveStroke()
    return (
      !!live &&
      !!this.gpu &&
      live.layerId === m.id &&
      live.target === target &&
      !!live.stroke.dirty
    )
  }

  /**
   * The GPU canvas shows the whole canvas being painted with the stroke
   * applied; with a selection, the stroke only shows inside it.
   */
  private liveCanvas(before: HTMLCanvasElement): HTMLCanvasElement {
    const gpu = this.gpu!
    const sel = this.selection
    if (!sel) return gpu.canvas
    return maskedBlend(
      this.scratch("live"),
      this.scratch("tmp"),
      before,
      gpu.canvas,
      sel
    )
  }

  /** A layer's mask as it should apply right now, or null if it has none. */
  private maskOf(m: LayerMeta) {
    if (!m.mask || m.maskOff) return null
    const src = this.masks.get(m.id)
    if (!src) return null
    if (this.isLive(m, "mask")) {
      return { src: this.liveCanvas(src), ox: 0, oy: 0 }
    }
    const a = this.action
    if (a?.kind === "move" && a.layerId === m.id && !a.float) {
      return { src, ox: a.dx, oy: a.dy }
    }
    return { src, ox: 0, oy: 0 }
  }

  /** A layer's pixels as they should appear right now, mid-action included. */
  private sourceOf(m: LayerMeta) {
    const base = this.canvases.get(m.id)
    if (!base) return null
    let src: HTMLCanvasElement = base
    let ox = 0
    let oy = 0
    const a = this.action
    if (this.isLive(m, "pixels")) {
      src = this.liveCanvas(base)
    } else if (a?.kind === "move" && a.layerId === m.id) {
      if (a.float) {
        // Selected pixels ride along; the rest of the layer stays put.
        src = this.scratch("live")
        const L = ctxOf(src)
        L.globalAlpha = 1
        L.globalCompositeOperation = "copy"
        L.drawImage(a.float.rest, 0, 0)
        L.globalCompositeOperation = "source-over"
        L.drawImage(a.float.cut, a.dx, a.dy)
      } else {
        ox = a.dx
        oy = a.dy
      }
    }
    const mask = this.maskOf(m)
    if (mask) {
      const masked = this.scratch("masked")
      const M = ctxOf(masked)
      M.globalAlpha = 1
      M.globalCompositeOperation = "copy"
      M.drawImage(src, ox, oy)
      M.globalCompositeOperation = "destination-in"
      M.drawImage(mask.src, mask.ox, mask.oy)
      M.globalCompositeOperation = "source-over"
      return { src: masked, ox: 0, oy: 0 }
    }
    return { src, ox, oy }
  }

  /** Draws paint layer `i`, masked by its clipping base if it has one. */
  private drawLayer(ctx: CanvasRenderingContext2D, i: number) {
    const m = this.state.layers[i]
    const s = this.sourceOf(m)
    if (!s) return
    let { src, ox, oy } = s
    if (m.clip) {
      const base = this.baseOf(i)
      if (base && !base.fx) {
        if (!base.visible) return
        const B = ctxOf(this.scratchB)
        B.globalAlpha = 1
        B.globalCompositeOperation = "copy"
        B.drawImage(src, ox, oy)
        // Only now fetch the base: it may reuse the canvas `src` was in.
        const b = this.sourceOf(base)
        if (!b) return
        B.globalCompositeOperation = "destination-in"
        B.drawImage(b.src, b.ox, b.oy)
        src = this.scratchB
        ox = 0
        oy = 0
      }
    }
    ctx.globalAlpha = m.opacity
    ctx.globalCompositeOperation = m.blend
    ctx.drawImage(src, ox, oy)
  }

  /**
   * Draws every visible paint layer into ctx using whatever transform is set.
   * Adjustment layers are skipped; `compose()` is the path that honours them.
   */
  private drawLayers(ctx: CanvasRenderingContext2D) {
    const { layers } = this.state
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].visible && !layers[i].fx) this.drawLayer(ctx, i)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
  }

  /** True when a visible adjustment layer means the document must be flattened. */
  private fxActive(): boolean {
    return !!this.fx && this.state.layers.some((l) => l.fx && l.visible)
  }

  /**
   * Replaces a canvas's contents with an effect applied to them — everywhere,
   * or only where the adjustment layer's mask allows.
   */
  private applyFx(target: HTMLCanvasElement, m: LayerMeta) {
    const out = m.fx && this.fx?.apply(target, m.fx, m.opacity)
    if (!out) return
    const ctx = ctxOf(target)
    const mask = this.maskOf(m)
    ctx.globalAlpha = 1
    if (mask) {
      const masked = this.scratch("masked")
      const M = ctxOf(masked)
      M.globalAlpha = 1
      M.globalCompositeOperation = "copy"
      M.drawImage(out, 0, 0)
      M.globalCompositeOperation = "destination-in"
      M.drawImage(mask.src, mask.ox, mask.oy)
      M.globalCompositeOperation = "source-over"
      ctx.globalCompositeOperation = "destination-out"
      ctx.drawImage(mask.src, mask.ox, mask.oy)
      ctx.globalCompositeOperation = "lighter"
      ctx.drawImage(masked, 0, 0)
    } else {
      ctx.globalCompositeOperation = "copy"
      ctx.drawImage(out, 0, 0)
    }
    ctx.globalCompositeOperation = "source-over"
  }

  /**
   * Flattens the document — paper included, if shown — at full resolution,
   * running each adjustment layer over what lies beneath it. The result is
   * cached until something that affects it changes.
   */
  private compose(): HTMLCanvasElement {
    const { layers, docW, docH, background, showBackground } = this.state
    const busy = !!this.liveStroke() || this.action?.kind === "move"
    const key = busy
      ? null
      : JSON.stringify([
          docW,
          docH,
          showBackground && background,
          layers.map((l) => [
            l.id,
            l.rev,
            l.visible,
            l.opacity,
            l.blend,
            l.clip,
            l.fx,
            l.mask,
            l.maskOff,
            l.maskRev,
          ]),
        ])
    if (key && key === this.compKey) return this.comp
    this.compKey = key

    const A = ctxOf(this.comp)
    A.setTransform(1, 0, 0, 1, 0, 0)
    A.globalAlpha = 1
    A.globalCompositeOperation = "source-over"
    A.clearRect(0, 0, docW, docH)
    if (showBackground) {
      A.fillStyle = background
      A.fillRect(0, 0, docW, docH)
    }

    for (let i = 0; i < layers.length; i++) {
      const m = layers[i]
      if (!m.visible) continue
      if (m.fx) {
        // Clipped adjustments are handled with their base layer below.
        if (!this.clipBase(i)) this.applyFx(this.comp, m)
        continue
      }
      // The run of layers clipped to this one.
      let end = i
      if (!m.clip) {
        while (end + 1 < layers.length && layers[end + 1].clip) end++
      }
      const grouped = layers
        .slice(i + 1, end + 1)
        .some((l) => l.fx && l.visible)
      if (!grouped) {
        this.drawLayer(A, i)
        continue
      }
      // A clipped adjustment only affects its base (and the layers clipped
      // beneath it), so build that stack on its own before laying it down.
      const s = this.sourceOf(m)
      if (s) {
        const G = ctxOf(this.scratchG)
        G.globalAlpha = 1
        G.globalCompositeOperation = "copy"
        G.drawImage(s.src, s.ox, s.oy)
        for (let j = i + 1; j <= end; j++) {
          const f = layers[j]
          if (!f.visible) continue
          if (f.fx) this.applyFx(this.scratchG, f)
          else this.drawLayer(G, j)
        }
        A.globalAlpha = m.opacity
        A.globalCompositeOperation = m.blend
        A.drawImage(this.scratchG, 0, 0)
      }
      i = end
    }
    A.globalAlpha = 1
    A.globalCompositeOperation = "source-over"
    return this.comp
  }

  private getChecker(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.checker) return this.checker
    const tile = makeCanvas(24, 24)
    const t = ctxOf(tile)
    t.fillStyle = "#e9e9e6"
    t.fillRect(0, 0, 24, 24)
    t.fillStyle = "#cfcfca"
    t.fillRect(0, 0, 12, 12)
    t.fillRect(12, 12, 12, 12)
    this.checker = ctx.createPattern(tile, "repeat")
    return this.checker
  }

  /** The stroke currently owned by the GPU renderer, if any. */
  private liveStroke() {
    const a = this.action
    return a?.kind === "stroke" ? a : this.settling
  }

  private render() {
    const canvas = this.display
    if (!canvas || !this.state.ready) return
    const gpu = this.gpu
    if (gpu && this.liveStroke()) {
      gpu.frame()
      // Wet paint keeps moving on its own, so keep the frames coming.
      if (gpu.wet) this.requestRender()
    }
    const ctx = ctxOf(canvas)
    const { docW, docH, background, showBackground, symmetry } = this.state
    const { tx, ty, scale, rot } = this.view
    const d = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const c = Math.cos(rot) * scale * d
    const s = Math.sin(rot) * scale * d
    ctx.setTransform(c, s, -s, c, tx * d, ty * d)

    // paper with a soft drop shadow
    ctx.save()
    ctx.shadowColor = "rgba(0,0,0,0.55)"
    ctx.shadowBlur = 36 * d
    ctx.shadowOffsetY = 8 * d
    ctx.fillStyle = showBackground ? background : "#e9e9e6"
    ctx.fillRect(0, 0, docW, docH)
    ctx.restore()
    if (!showBackground) {
      const pattern = this.getChecker(ctx)
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, docW, docH)
      }
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, docW, docH)
    ctx.clip()
    ctx.imageSmoothingEnabled = scale * d < 4
    ctx.imageSmoothingQuality = scale * d < 0.6 ? "high" : "medium"
    if (this.fxActive()) ctx.drawImage(this.compose(), 0, 0)
    else this.drawLayers(ctx)
    ctx.restore()

    if (symmetry) {
      ctx.lineWidth = 1.5 / (scale * d)
      ctx.setLineDash([8 / scale, 6 / scale])
      ctx.strokeStyle = "rgba(56, 189, 148, 0.9)"
      ctx.beginPath()
      ctx.moveTo(docW / 2, 0)
      ctx.lineTo(docW / 2, docH)
      ctx.stroke()
      ctx.setLineDash([])
    }

    this.drawOverlay(ctx, canvas)

    if (this.settling && --this.settling.frames <= 0) this.finishSettle()
  }

  /** Marching ants for the selection, and the outline of one being drawn. */
  private drawOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const a = this.action
    const sel = this.selection
    if (sel && this.ants && a?.kind !== "move") {
      const ok = this.ants.draw(
        sel,
        this.selRev,
        canvas.width,
        canvas.height,
        this.view,
        this.dpr,
        (performance.now() / 900) % 1
      )
      if (ok) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(this.ants.canvas, 0, 0)
        ctx.restore()
      }
      if (!this.antTimer) {
        this.antTimer = window.setTimeout(() => {
          this.antTimer = 0
          this.requestRender()
        }, 110)
      }
    }

    let pts: number[] | null = null
    let closed = false
    if (a?.kind === "marquee") {
      pts = [a.x0, a.y0, a.x1, a.y0, a.x1, a.y1, a.x0, a.y1]
      closed = true
    } else if (a?.kind === "lasso") {
      pts = a.pts
    } else if (this.poly) {
      pts = [...this.poly.pts, this.poly.hx, this.poly.hy]
    }
    if (!pts || pts.length < 4) return
    const px = 1 / this.view.scale
    ctx.beginPath()
    ctx.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    if (closed) ctx.closePath()
    ctx.lineJoin = "round"
    ctx.lineWidth = 1.5 * px
    ctx.setLineDash([])
    ctx.strokeStyle = "#fff"
    ctx.stroke()
    ctx.setLineDash([5 * px, 5 * px])
    ctx.strokeStyle = "#000"
    ctx.stroke()
    ctx.setLineDash([])
    if (this.poly) {
      // The starting point: click it to close the shape.
      ctx.beginPath()
      ctx.arc(pts[0], pts[1], 4 * px, 0, Math.PI * 2)
      ctx.fillStyle = "#fff"
      ctx.fill()
      ctx.lineWidth = px
      ctx.stroke()
    }
  }

  private updateCursor() {
    const el = this.cursorEl
    const canvas = this.display
    if (!canvas) return
    const { tool } = this.state
    const a = this.action
    canvas.style.cursor =
      a?.kind === "pan"
        ? "grabbing"
        : this.spaceDown || tool === "hand"
          ? "grab"
          : tool === "move"
            ? "move"
            : "crosshair"
    if (!el) return
    const brushSize = isPaintTool(tool)
      ? this.state.toolSettings[tool].size
      : tool === "select-brush"
        ? this.state.selBrushSize
        : 0
    const show =
      brushSize > 0 &&
      this.pointerInside &&
      !this.spaceDown &&
      a?.kind !== "pan"
    if (!show) {
      el.style.opacity = "0"
      return
    }
    const size = Math.max(4, brushSize * this.view.scale)
    el.style.opacity = "1"
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    el.style.transform = `translate(${this.lastScreen.x - size / 2}px, ${this.lastScreen.y - size / 2}px)`
  }

  // ---- input ---------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.display!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private pressure(e: PointerEvent): number {
    if (e.pointerType === "pen") return Math.max(0.02, e.pressure)
    return this.simPressure
  }

  /** Tilt and timing for brushes that respond to them. */
  private sampleExtra(e: PointerEvent): SampleExtra {
    const tilt =
      e.pointerType === "pen" ? Math.hypot(e.tiltX, e.tiltY) / 60 : 0
    return { tilt: clamp(tilt, 0, 1), time: e.timeStamp }
  }

  /** The previous colour doubles as the secondary colour for brushes. */
  private secondaryRgb(): [number, number, number] {
    const rgb = hexToRgb(hsvToHex(this.state.prevColor)) ?? [0, 0, 0]
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
  }

  /** The brush a paint tool is using, with any unsaved edits applied. */
  activeBrush(tool: PaintTool): BrushPreset {
    const settings = this.state.toolSettings[tool]
    return { ...getBrush(settings.brushId), ...settings.dynamics }
  }

  private onContext = (e: Event) => e.preventDefault()

  private onLeave = () => {
    this.pointerInside = false
    this.updateCursor()
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [sx, sy] = this.local(e)
    if (e.shiftKey) {
      this.rotateBy((e.deltaY > 0 ? 1 : -1) * (Math.PI / 36), sx, sy)
      return
    }
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
    const k = e.ctrlKey ? 0.01 : 0.0018
    this.zoomAt(sx, sy, Math.exp(-delta * k))
  }

  private onDown = (e: PointerEvent) => {
    const canvas = this.display
    if (!canvas || !this.state.ready) return
    this.finishSettle()
    e.preventDefault()
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointers can't always be captured
    }
    const [sx, sy] = this.local(e)
    this.lastScreen = { x: sx, y: sy }
    this.pointerInside = e.pointerType !== "touch"

    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, { x: sx, y: sy })
      if (this.touches.size >= 2) {
        if (this.gesture) {
          this.gesture.maxTouches = Math.max(
            this.gesture.maxTouches,
            this.touches.size
          )
        } else {
          this.cancelAction()
          this.startGesture()
        }
        return
      }
    }
    if (this.action || this.gesture) return

    const { tool } = this.state
    const id = e.pointerId
    const [x, y] = this.screenToDoc(sx, sy)

    if (this.spaceDown || e.button === 1 || tool === "hand") {
      this.action = { kind: "pan", pointerId: id, lx: sx, ly: sy }
    } else if (this.rotateKey) {
      this.action = {
        kind: "rotate",
        pointerId: id,
        last: Math.atan2(sy - this.vh / 2, sx - this.vw / 2),
      }
    } else if (isSelectTool(tool) && e.button === 0) {
      this.beginSelect(tool, e, id, x, y, sx, sy)
    } else if (e.altKey || e.button === 2 || tool === "eyedropper") {
      this.action = { kind: "pick", pointerId: id }
      this.pick(x, y)
    } else if (tool === "fill") {
      this.fillAt(x, y)
    } else {
      const layer = this.activeLayer()
      if (!layer) return
      if (!layer.visible) {
        this.notify("The active layer is hidden")
        return
      }
      const onMask = this.state.editMask && !!layer.mask
      if (layer.fx && !(onMask || (tool === "move" && layer.mask))) {
        this.notify("Select a paint layer — adjustment layers hold no pixels")
        return
      }
      if (tool === "move") {
        const sel = this.selection
        const src = this.canvases.get(layer.id)
        let float: { cut: HTMLCanvasElement; rest: HTMLCanvasElement } | undefined
        if (sel && src && !layer.fx) {
          const part = (op: GlobalCompositeOperation) => {
            const c = cloneCanvas(src)
            const cx = ctxOf(c)
            cx.globalCompositeOperation = op
            cx.drawImage(sel, 0, 0)
            cx.globalCompositeOperation = "source-over"
            return c
          }
          float = { cut: part("destination-in"), rest: part("destination-out") }
        }
        this.action = {
          kind: "move",
          pointerId: id,
          layerId: layer.id,
          x0: x,
          y0: y,
          dx: 0,
          dy: 0,
          float,
        }
      } else if (isPaintTool(tool)) {
        this.simPressure = 0.75
        this.beginPaint(tool, layer, id, x, y, this.pressure(e), this.sampleExtra(e))
      }
    }
    this.updateCursor()
  }

  private beginPaint(
    tool: PaintTool,
    layer: LayerMeta,
    pointerId: number,
    x: number,
    y: number,
    p: number,
    extra: SampleExtra
  ) {
    const settings = this.state.toolSettings[tool]
    let brush = this.activeBrush(tool)
    if (tool === "smudge") {
      // Smudging moves paint that is already there, so the tip only needs a
      // steady contact; the tool's opacity acts as its strength.
      brush = {
        ...brush,
        flow: Math.max(brush.flow, 0.35),
        flowPressure: 0,
        spacing: Math.min(brush.spacing, 0.06),
      }
    }
    const gpu = this.gpu
    if (!gpu) {
      this.notify("Painting requires WebGPU. Enable it and reload.")
      return
    }
    // On a mask the brush reveals with light colours and hides with dark.
    const target: Target =
      this.state.editMask && layer.mask ? "mask" : "pixels"
    const onMask = target === "mask"
    const hide = onMask && (tool === "eraser" || this.colorIsDark())
    if (tool === "brush" && !onMask) this.rememberColor()
    const rgb = onMask
      ? [255, 255, 255]
      : (hexToRgb(hsvToHex(this.state.color)) ?? [0, 0, 0])
    try {
      gpu.begin({
        width: this.state.docW,
        height: this.state.docH,
        source: (onMask ? this.masks : this.canvases).get(layer.id),
        brush,
        color: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
        color2: onMask ? undefined : this.secondaryRgb(),
        size: settings.size,
        opacity: settings.opacity,
        seed: Math.random() * 1000,
        mode:
          tool === "smudge"
            ? "smudge"
            : tool === "eraser" || hide
              ? "erase"
              : "paint",
        alphaLock: !onMask && layer.alphaLock,
      })
    } catch (error) {
      console.error("Brush stroke initialization failed", error)
      this.notify(
        error instanceof GPUSizeError
          ? error.message
          : "The brush could not start. Your artwork is unchanged; details are in the browser console."
      )
      return
    }
    const stroke = new Stroke((dab) => gpu.dab(dab), brush, {
      size: settings.size,
      streamline: settings.streamline,
      mirrorX: this.state.symmetry ? this.state.docW / 2 : null,
    })
    stroke.add(x, y, p, extra)
    this.action = {
      kind: "stroke",
      pointerId,
      stroke,
      layerId: layer.id,
      target,
    }
    this.requestRender()
  }

  private onMove = (e: PointerEvent) => {
    if (!this.display) return
    const [sx, sy] = this.local(e)

    if (e.pointerType === "touch") {
      if (this.touches.has(e.pointerId))
        this.touches.set(e.pointerId, { x: sx, y: sy })
      if (this.gesture) {
        this.updateGesture()
        return
      }
    } else {
      this.pointerInside = true
    }

    const a = this.action
    const moved = Math.hypot(sx - this.lastScreen.x, sy - this.lastScreen.y)
    this.lastScreen = { x: sx, y: sy }

    if (!a || a.pointerId !== e.pointerId) {
      if (!a && this.poly) {
        const [x, y] = this.screenToDoc(sx, sy)
        this.poly.hx = x
        this.poly.hy = y
        this.requestRender()
      }
      this.updateCursor()
      return
    }
    e.preventDefault()

    switch (a.kind) {
      case "pan":
        this.view.tx += sx - a.lx
        this.view.ty += sy - a.ly
        a.lx = sx
        a.ly = sy
        this.viewChanged()
        break
      case "rotate": {
        const ang = Math.atan2(sy - this.vh / 2, sx - this.vw / 2)
        this.rotateBy(ang - a.last)
        a.last = ang
        break
      }
      case "pick": {
        const [x, y] = this.screenToDoc(sx, sy)
        this.pick(x, y)
        break
      }
      case "move": {
        const [x, y] = this.screenToDoc(sx, sy)
        a.dx = Math.round(x - a.x0)
        a.dy = Math.round(y - a.y0)
        this.requestRender()
        break
      }
      case "marquee": {
        const [x, y] = this.screenToDoc(sx, sy)
        a.x1 = x
        a.y1 = y
        this.requestRender()
        break
      }
      case "lasso": {
        const [x, y] = this.screenToDoc(sx, sy)
        a.pts.push(x, y)
        this.requestRender()
        break
      }
      case "selbrush": {
        const [x, y] = this.screenToDoc(sx, sy)
        this.selBrushTo(a, x, y)
        break
      }
      case "stroke": {
        // Mice and fingers have no pressure, so derive some from speed.
        const target = clamp(1.15 - moved / 42, 0.3, 1)
        this.simPressure += (target - this.simPressure) * 0.22
        const events =
          typeof e.getCoalescedEvents === "function"
            ? e.getCoalescedEvents()
            : []
        const list = events.length > 0 ? events : [e]
        for (const ev of list) {
          const [lx, ly] = this.local(ev)
          const [x, y] = this.screenToDoc(lx, ly)
          a.stroke.add(x, y, this.pressure(ev), this.sampleExtra(ev))
        }
        this.requestRender()
        break
      }
    }
    this.updateCursor()
  }

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId)
      if (this.gesture) {
        if (this.touches.size === 0) this.endGesture()
        return
      }
    }
    const a = this.action
    if (!a || a.pointerId !== e.pointerId) return
    this.action = null
    switch (a.kind) {
      case "stroke": {
        a.stroke.end()
        const frames = this.gpu?.settleFrames ?? 0
        if (frames > 0 && a.stroke.dirty) {
          this.settling = {
            stroke: a.stroke,
            layerId: a.layerId,
            target: a.target,
            frames,
          }
        } else {
          this.commitStroke(a.stroke, a.layerId, a.target)
        }
        break
      }
      case "move":
        if (a.dx !== 0 || a.dy !== 0) this.commitMove(a)
        break
      case "marquee": {
        const [sx, sy] = this.local(e)
        if (Math.hypot(sx - a.sx, sy - a.sy) < 3) this.selectClick(a.mode)
        else this.finishShape(this.rectShape(a.x0, a.y0, a.x1, a.y1), a.mode)
        break
      }
      case "lasso":
        if (a.pts.length < 6) this.selectClick(a.mode)
        else this.finishShape(this.pathShape(a.pts), a.mode)
        break
      case "selbrush":
        this.putSelection(a.base)
        // The brush marks whole pixels; soften the stair-steps a little.
        this.finishShape(this.blurMask(a.stroke, 0.7), a.mode, false)
        break
      default:
        break
    }
    this.requestRender()
    this.updateCursor()
  }

  private onCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId)
    if (this.gesture && this.touches.size === 0) this.gesture = null
    if (this.action?.pointerId === e.pointerId) this.cancelAction()
  }

  /** Commits a stroke that is still settling, cutting its drying time short. */
  private finishSettle() {
    const s = this.settling
    if (!s) return
    this.settling = null
    this.commitStroke(s.stroke, s.layerId, s.target)
    this.requestRender()
  }

  /**
   * Abandons the in-flight action without committing it. A stroke that has
   * already been released and is only settling is committed, not lost.
   */
  private cancelAction() {
    this.finishSettle()
    const a = this.action
    if (!a) return
    this.action = null
    if (a.kind === "selbrush") this.putSelection(a.base)
    this.requestRender()
  }

  private clampRect(r: Rect | null): Rect | null {
    if (!r) return null
    const { docW, docH } = this.state
    const x = clamp(r.x, 0, docW)
    const y = clamp(r.y, 0, docH)
    const w = clamp(r.x + r.w, 0, docW) - x
    const h = clamp(r.y + r.h, 0, docH) - y
    return w > 0 && h > 0 ? { x, y, w, h } : null
  }

  /**
   * Copies the stroke's footprint from the GPU canvas into the layer (or its
   * mask), keeping it inside the selection if there is one.
   */
  private commitStroke(stroke: Stroke, layerId: string, target: Target) {
    const gpu = this.gpu
    const canvas = (target === "mask" ? this.masks : this.canvases).get(layerId)
    const d = stroke.dirty
    if (!gpu || !canvas || !d) return
    // Resolve in this task so the GPU canvas is readable by drawImage below.
    gpu.frame(false)
    const m = gpu.margin
    const r = this.clampRect({
      x: d.x - m,
      y: d.y - m,
      w: d.w + m * 2,
      h: d.h + m * 2,
    })
    if (!r) return
    const ctx = ctxOf(canvas)
    const before = cropCanvas(canvas, r)
    ctx.clearRect(r.x, r.y, r.w, r.h)
    ctx.drawImage(gpu.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    const sel = this.selection
    if (sel) {
      const held = maskedBlend(
        makeCanvas(r.w, r.h),
        makeCanvas(r.w, r.h),
        before,
        cropCanvas(canvas, r),
        sel,
        r.x,
        r.y
      )
      ctx.clearRect(r.x, r.y, r.w, r.h)
      ctx.drawImage(held, r.x, r.y)
    }
    const after = cropCanvas(canvas, r)
    this.bumpRev(layerId, target)
    this.pushUndo({
      undo: () => this.applyPatch(layerId, r, before, target),
      redo: () => this.applyPatch(layerId, r, after, target),
    })
  }

  /** Finishes a move-tool drag: the layer and its mask, or the selected pixels. */
  private commitMove(a: Extract<Action, { kind: "move" }>) {
    const { dx, dy, layerId, float } = a
    const shifted = (src: HTMLCanvasElement) => {
      const c = makeCanvas(src.width, src.height)
      ctxOf(c).drawImage(src, dx, dy)
      return c
    }
    this.structural(() => {
      const meta = this.state.layers.find((l) => l.id === layerId)
      const src = this.canvases.get(layerId)
      if (!meta || !src) return
      if (float) {
        const c = cloneCanvas(float.rest)
        ctxOf(c).drawImage(float.cut, dx, dy)
        this.canvases.set(layerId, c)
        this.bumpRev(layerId)
        const sel = this.selection
        if (sel) {
          const moved = shifted(sel)
          this.putSelection(isEmpty(moved) ? null : moved)
        }
        return
      }
      if (!meta.fx) {
        this.canvases.set(layerId, shifted(src))
        this.bumpRev(layerId)
      }
      const mask = this.masks.get(layerId)
      if (mask) {
        this.masks.set(layerId, shifted(mask))
        this.bumpRev(layerId, "mask")
      }
    })
  }

  // ---- selection -----------------------------------------------------------

  private putSelection(c: HTMLCanvasElement | null) {
    this.selection = c
    if (c) this.lastSelection = c
    this.selRev++
    const canReselect = !!this.lastSelection
    if (
      this.state.hasSelection !== !!c ||
      this.state.canReselect !== canReselect
    ) {
      this.setState({ hasSelection: !!c, canReselect })
    }
    this.requestRender()
  }

  /** Replaces the selection, undoably. An empty selection becomes none. */
  private commitSelection(next: HTMLCanvasElement | null) {
    if (next && isEmpty(next)) next = null
    if (!next && !this.selection) return
    this.structural(() => this.putSelection(next))
  }

  private blank(): HTMLCanvasElement {
    return makeCanvas(this.state.docW, this.state.docH)
  }

  private full(): HTMLCanvasElement {
    const c = this.blank()
    const ctx = ctxOf(c)
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, c.width, c.height)
    return c
  }

  /** The selection that results from applying `shape` in the given mode. */
  private combine(shape: HTMLCanvasElement, mode: SelectMode) {
    const base = this.selection
    if (mode === "replace" || (!base && mode === "add")) return shape
    if (!base) return this.blank()
    const c = cloneCanvas(base)
    const ctx = ctxOf(c)
    ctx.globalCompositeOperation =
      mode === "add"
        ? "source-over"
        : mode === "subtract"
          ? "destination-out"
          : "destination-in"
    ctx.drawImage(shape, 0, 0)
    ctx.globalCompositeOperation = "source-over"
    return c
  }

  private blurMask(c: HTMLCanvasElement, sigma: number): HTMLCanvasElement {
    if (!this.fx || sigma <= 0) return c
    const out = this.fx.apply(
      c,
      { type: "blur", params: { radius: sigma * 2 } },
      1
    )
    return out ? cloneCanvas(out) : c
  }

  /** Blurs a mask by `sigma` then thresholds its coverage between lo and hi. */
  private remapMask(c: HTMLCanvasElement, sigma: number, lo: number, hi: number) {
    const out = this.fx?.apply(
      c,
      { type: "mask-remap", params: { lo, hi, sigma } },
      1
    )
    return out ? cloneCanvas(out) : c
  }

  private finishShape(shape: HTMLCanvasElement, mode: SelectMode, feather = true) {
    const f = this.state.selFeather
    if (feather && f > 0) shape = this.blurMask(shape, f)
    this.commitSelection(this.combine(shape, mode))
  }

  /** A click with a drag tool: clears the selection unless adding to it. */
  private selectClick(mode: SelectMode) {
    if (mode === "replace") this.commitSelection(null)
  }

  private rectShape(x0: number, y0: number, x1: number, y1: number) {
    const c = this.blank()
    const ctx = ctxOf(c)
    const l = Math.round(Math.min(x0, x1))
    const t = Math.round(Math.min(y0, y1))
    ctx.fillStyle = "#fff"
    ctx.fillRect(
      l,
      t,
      Math.round(Math.max(x0, x1)) - l,
      Math.round(Math.max(y0, y1)) - t
    )
    return c
  }

  private pathShape(pts: number[]) {
    const c = this.blank()
    const ctx = ctxOf(c)
    ctx.beginPath()
    ctx.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    ctx.closePath()
    ctx.fillStyle = "#fff"
    ctx.fill()
    return c
  }

  /** Shift adds, Alt subtracts, both intersect; otherwise the chosen mode. */
  private modeFor(e: PointerEvent): SelectMode {
    if (e.shiftKey && e.altKey) return "intersect"
    if (e.shiftKey) return "add"
    if (e.altKey) return "subtract"
    return this.state.selMode
  }

  private beginSelect(
    tool: SelectTool,
    e: PointerEvent,
    pointerId: number,
    x: number,
    y: number,
    sx: number,
    sy: number
  ) {
    const mode = this.modeFor(e)
    switch (tool) {
      case "select-rect":
        this.action = {
          kind: "marquee",
          pointerId,
          mode,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          sx,
          sy,
        }
        break
      case "select-lasso":
        this.action = { kind: "lasso", pointerId, mode, pts: [x, y] }
        break
      case "select-poly":
        this.polyClick(x, y, sx, sy, mode)
        break
      case "select-wand":
        this.wandAt(x, y, mode)
        break
      case "select-brush": {
        const { docW, docH } = this.state
        const a: Extract<Action, { kind: "selbrush" }> = {
          kind: "selbrush",
          pointerId,
          mode,
          base: this.selection,
          px: this.state.selBrushEdge ? this.readPixels().data : null,
          mask: new Uint8Array(docW * docH),
          stroke: this.blank(),
          preview: this.blank(),
          lx: x,
          ly: y,
        }
        this.action = a
        this.selBrushDabs(a, [x, y])
        break
      }
    }
    this.requestRender()
  }

  private polyClick(x: number, y: number, sx: number, sy: number, mode: SelectMode) {
    const now = performance.now()
    const p = this.poly
    if (!p) {
      this.poly = { pts: [x, y], mode, hx: x, hy: y, t: now, sx, sy }
      return
    }
    const { tx, ty, scale, rot } = this.view
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    const fx = tx + scale * (p.pts[0] * c - p.pts[1] * s)
    const fy = ty + scale * (p.pts[0] * s + p.pts[1] * c)
    const double = now - p.t < 320 && Math.hypot(sx - p.sx, sy - p.sy) < 6
    const atStart = p.pts.length >= 6 && Math.hypot(sx - fx, sy - fy) < 10
    if (double || atStart) {
      this.closePolygon()
      return
    }
    p.pts.push(x, y)
    p.t = now
    p.sx = sx
    p.sy = sy
  }

  /** Closes the polygonal lasso into a selection. */
  closePolygon() {
    const p = this.poly
    if (!p) return
    this.poly = null
    if (p.pts.length >= 6) this.finishShape(this.pathShape(p.pts), p.mode)
    this.requestRender()
  }

  /** The picture the wand and selection brush judge colours by. */
  private readPixels(): ImageData {
    const { docW, docH, background, showBackground, sampleAll } = this.state
    const c = makeCanvas(docW, docH)
    const ctx = c.getContext("2d", { willReadFrequently: true })!
    const layer = this.activeLayer()
    if (sampleAll || !layer || layer.fx) {
      if (showBackground) {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, docW, docH)
      }
      if (this.fxActive()) ctx.drawImage(this.compose(), 0, 0)
      else this.drawLayers(ctx)
    } else {
      const s = this.sourceOf(layer)
      if (s) ctx.drawImage(s.src, s.ox, s.oy)
    }
    return ctx.getImageData(0, 0, docW, docH)
  }

  private wandAt(fx: number, fy: number, mode: SelectMode) {
    const { docW: w, docH: h, wandTolerance, wandContiguous } = this.state
    const x = Math.floor(fx)
    const y = Math.floor(fy)
    if (x < 0 || y < 0 || x >= w || y >= h) {
      this.selectClick(mode)
      return
    }
    const mask = floodSelect(
      this.readPixels().data,
      w,
      h,
      x,
      y,
      wandTolerance,
      wandContiguous
    )
    const shape = this.blank()
    maskToCanvas(mask, w, { x: 0, y: 0, w, h }, ctxOf(shape))
    this.finishShape(this.blurMask(shape, 0.7), mode, false)
  }

  private selBrushTo(a: Extract<Action, { kind: "selbrush" }>, x: number, y: number) {
    const step = Math.max(1, this.state.selBrushSize * 0.18)
    const dist = Math.hypot(x - a.lx, y - a.ly)
    const n = Math.floor(dist / step)
    if (n === 0) return
    const pts: number[] = []
    for (let i = 1; i <= n; i++) {
      const t = (i * step) / dist
      pts.push(a.lx + (x - a.lx) * t, a.ly + (y - a.ly) * t)
    }
    a.lx = pts[pts.length - 2]
    a.ly = pts[pts.length - 1]
    this.selBrushDabs(a, pts)
  }

  private selBrushDabs(a: Extract<Action, { kind: "selbrush" }>, pts: number[]) {
    const { docW: w, docH: h, selBrushSize, selBrushContrast } = this.state
    let rect: Rect | null = null
    for (let i = 0; i < pts.length; i += 2) {
      rect = unionRect(
        rect,
        growDab(a.px, w, h, a.mask, pts[i], pts[i + 1], selBrushSize / 2, selBrushContrast)
      )
    }
    if (!rect) return
    maskToCanvas(a.mask, w, rect, ctxOf(a.stroke))
    // Show the selection as it will be once this stroke is applied.
    const P = ctxOf(a.preview)
    P.globalCompositeOperation = "copy"
    if (a.mode === "replace" || (!a.base && a.mode === "add")) {
      P.drawImage(a.stroke, 0, 0)
    } else if (!a.base) {
      P.clearRect(0, 0, w, h)
    } else {
      P.drawImage(a.base, 0, 0)
      P.globalCompositeOperation =
        a.mode === "add"
          ? "source-over"
          : a.mode === "subtract"
            ? "destination-out"
            : "destination-in"
      P.drawImage(a.stroke, 0, 0)
    }
    P.globalCompositeOperation = "source-over"
    this.selection = a.preview
    this.selRev++
    if (!this.state.hasSelection) this.setState({ hasSelection: true })
    this.requestRender()
  }

  setSelectOptions(patch: Partial<SelectOptions>) {
    const next = { ...patch }
    if (next.selFeather !== undefined) next.selFeather = clamp(next.selFeather, 0, 250)
    if (next.wandTolerance !== undefined)
      next.wandTolerance = clamp(Math.round(next.wandTolerance), 0, 255)
    if (next.selBrushSize !== undefined)
      next.selBrushSize = clamp(Math.round(next.selBrushSize), 4, 600)
    if (next.selBrushContrast !== undefined)
      next.selBrushContrast = clamp(Math.round(next.selBrushContrast), 1, 100)
    this.setState(next)
    this.updateCursor()
  }

  selectAll() {
    this.commitSelection(this.full())
  }

  deselect() {
    this.poly = null
    this.commitSelection(null)
    this.requestRender()
  }

  reselect() {
    if (!this.selection && this.lastSelection) {
      this.commitSelection(this.lastSelection)
    }
  }

  invertSelection() {
    const c = this.full()
    const sel = this.selection
    if (sel) {
      const ctx = ctxOf(c)
      ctx.globalCompositeOperation = "destination-out"
      ctx.drawImage(sel, 0, 0)
    }
    this.commitSelection(c)
  }

  /** Selects wherever the active layer has paint. */
  selectLayerPixels() {
    const layer = this.activeLayer()
    if (!layer || layer.fx) {
      this.notify("Adjustment layers hold no pixels to select")
      return
    }
    const c = this.full()
    const ctx = ctxOf(c)
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(this.bakedPixels(layer), 0, 0)
    this.commitSelection(this.combine(c, this.state.selMode))
  }

  modifySelection(kind: SelectModify, px: number) {
    const sel = this.selection
    if (!sel || px <= 0) return
    if (!this.fx) {
      this.notify("Changing a selection's edge requires WebGPU.")
      return
    }
    let next: HTMLCanvasElement
    if (kind === "feather") {
      next = this.blurMask(sel, px)
    } else if (kind === "smooth") {
      const w = 0.2 / px
      next = this.remapMask(sel, px, 0.5 - w, 0.5 + w)
    } else {
      // A Gaussian edge crosses these coverages `px` either side of centre.
      const sigma = Math.max(0.5, px * 0.6)
      const w = 0.05 / sigma
      const t = kind === "grow" ? 0.048 : 0.952
      next = this.remapMask(sel, sigma, Math.max(0.004, t - w), Math.min(0.996, t + w))
    }
    this.commitSelection(next)
  }

  /** Where edits go: the active layer's pixels, or its mask when editing that. */
  private editTarget(): { layer: LayerMeta; target: Target } | null {
    const layer = this.activeLayer()
    if (!layer) return null
    if (this.state.editMask && layer.mask) return { layer, target: "mask" }
    if (layer.fx) {
      this.notify("Select a paint layer — adjustment layers hold no pixels")
      return null
    }
    return { layer, target: "pixels" }
  }

  private colorIsDark(): boolean {
    const rgb = hexToRgb(hsvToHex(this.state.color)) ?? [0, 0, 0]
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128
  }

  /** Erases the selected area (the whole layer if nothing is selected). */
  clearSelection() {
    const t = this.editTarget()
    if (!t) return
    const sel = this.selection
    this.replaceCanvas(
      t.layer.id,
      (src) => {
        if (!sel) return makeCanvas(src.width, src.height)
        const c = cloneCanvas(src)
        const ctx = ctxOf(c)
        ctx.globalCompositeOperation = "destination-out"
        ctx.drawImage(sel, 0, 0)
        return c
      },
      t.target
    )
  }

  /**
   * Fills the selected area with the current colour. On a mask, a light
   * colour reveals the area and a dark one hides it.
   */
  fillSelection() {
    const t = this.editTarget()
    if (!t) return
    const sel = this.selection
    const onMask = t.target === "mask"
    const hide = onMask && this.colorIsDark()
    const hex = onMask ? "#ffffff" : hsvToHex(this.state.color)
    if (!onMask) this.rememberColor()
    this.replaceCanvas(
      t.layer.id,
      (src) => {
        const paint = makeCanvas(src.width, src.height)
        const p = ctxOf(paint)
        p.fillStyle = hex
        p.fillRect(0, 0, paint.width, paint.height)
        if (sel) {
          p.globalCompositeOperation = "destination-in"
          p.drawImage(sel, 0, 0)
        }
        const c = cloneCanvas(src)
        const ctx = ctxOf(c)
        if (hide) ctx.globalCompositeOperation = "destination-out"
        ctx.drawImage(paint, 0, 0)
        ctx.globalCompositeOperation = "source-over"
        return c
      },
      t.target
    )
  }

  /** Lifts the selected pixels onto a new layer, leaving or removing them. */
  selectionToLayer(cut: boolean) {
    const layer = this.activeLayer()
    if (!layer || layer.fx) {
      this.notify("Select a paint layer — adjustment layers hold no pixels")
      return
    }
    const sel = this.selection
    if (!sel) {
      if (!cut) this.duplicateLayer(layer.id)
      return
    }
    this.structural(() => {
      const piece = this.bakedPixels(layer)
      const p = ctxOf(piece)
      p.globalCompositeOperation = "destination-in"
      p.drawImage(sel, 0, 0)
      p.globalCompositeOperation = "source-over"
      let layers = this.state.layers
      if (cut) {
        const rest = cloneCanvas(this.canvases.get(layer.id)!)
        const r = ctxOf(rest)
        r.globalCompositeOperation = "destination-out"
        r.drawImage(sel, 0, 0)
        r.globalCompositeOperation = "source-over"
        this.canvases.set(layer.id, rest)
        layers = layers.map((l) =>
          l.id === layer.id ? { ...l, rev: nextRev() } : l
        )
      }
      this.layerCounter -= 1
      const made = this.makeLayer(`${layer.name} ${cut ? "cut" : "copy"}`)
      this.canvases.set(made.id, piece)
      const next = layers.slice()
      next.splice(next.findIndex((l) => l.id === layer.id) + 1, 0, made)
      this.setState({ layers: next, activeLayerId: made.id, editMask: false })
    })
  }

  // ---- layer masks ---------------------------------------------------------

  /**
   * Gives a layer a mask. By default it reveals the selection if there is
   * one, and the whole layer otherwise.
   */
  addMask(
    id: string,
    from: "auto" | "reveal" | "hide" | "selection" | "inverse" = "auto"
  ) {
    const meta = this.state.layers.find((l) => l.id === id)
    if (!meta || meta.mask) return
    const sel = this.selection
    const kind = from === "auto" ? (sel ? "selection" : "reveal") : from
    this.structural(() => {
      let c: HTMLCanvasElement
      if (kind === "hide") {
        c = this.blank()
      } else if (kind === "selection" && sel) {
        c = cloneCanvas(sel)
      } else {
        c = this.full()
        if (kind === "inverse" && sel) {
          const ctx = ctxOf(c)
          ctx.globalCompositeOperation = "destination-out"
          ctx.drawImage(sel, 0, 0)
          ctx.globalCompositeOperation = "source-over"
        }
      }
      this.masks.set(id, c)
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id
            ? { ...l, mask: true, maskOff: false, maskRev: nextRev() }
            : l
        ),
        activeLayerId: id,
        editMask: true,
      })
      // The selection has become the mask.
      if (sel && (kind === "selection" || kind === "inverse")) {
        this.putSelection(null)
      }
    })
  }

  removeMask(id: string) {
    if (!this.masks.has(id)) return
    this.structural(() => {
      this.masks.delete(id)
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id ? { ...l, mask: false, maskOff: false } : l
        ),
        editMask: false,
      })
    })
  }

  /** Bakes the mask into the layer's pixels and removes it. */
  applyMask(id: string) {
    const meta = this.state.layers.find((l) => l.id === id)
    if (!meta || !this.masks.has(id)) return
    if (meta.fx) {
      this.notify("An adjustment layer's mask can't be applied — merge it down instead")
      return
    }
    this.structural(() => {
      this.canvases.set(id, this.bakedPixels({ ...meta, maskOff: false }))
      this.masks.delete(id)
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id
            ? { ...l, mask: false, maskOff: false, rev: nextRev() }
            : l
        ),
        editMask: false,
      })
    })
  }

  invertMask(id: string) {
    this.replaceCanvas(
      id,
      (src) => {
        const c = this.full()
        const ctx = ctxOf(c)
        ctx.globalCompositeOperation = "destination-out"
        ctx.drawImage(src, 0, 0)
        ctx.globalCompositeOperation = "source-over"
        return c
      },
      "mask"
    )
  }

  /** Loads a layer's mask as the selection. */
  selectFromMask(id: string) {
    const mask = this.masks.get(id)
    if (mask) this.commitSelection(this.combine(cloneCanvas(mask), this.state.selMode))
  }

  setEditMask(on: boolean) {
    this.finishSettle()
    if (this.action) return
    this.setState({ editMask: on })
  }

  // ---- keys ----------------------------------------------------------------

  /** Escape: abandons a selection shape in progress. */
  escape(): boolean {
    if (this.poly) {
      this.poly = null
      this.requestRender()
      return true
    }
    const k = this.action?.kind
    if (k === "marquee" || k === "lasso" || k === "selbrush") {
      this.cancelAction()
      return true
    }
    return false
  }

  /** Backspace: steps the polygon back a point, else erases the selection. */
  backspace() {
    const p = this.poly
    if (p) {
      p.pts.length -= 2
      if (p.pts.length === 0) this.poly = null
      this.requestRender()
    } else if (this.selection) {
      this.clearSelection()
    }
  }

  // ---- touch gestures ------------------------------------------------------

  private gestureGeometry() {
    const [a, b] = [...this.touches.values()]
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    }
  }

  private startGesture() {
    this.gesture = {
      ...this.gestureGeometry(),
      view: { ...this.view },
      t0: performance.now(),
      moved: false,
      maxTouches: this.touches.size,
    }
  }

  private updateGesture() {
    const g = this.gesture
    if (!g || this.touches.size < 2) return
    const now = this.gestureGeometry()
    const ratio = now.dist / g.dist
    if (
      Math.hypot(now.cx - g.cx, now.cy - g.cy) > 10 ||
      Math.abs(ratio - 1) > 0.06 ||
      Math.abs(now.angle - g.angle) > 0.08
    ) {
      g.moved = true
    }
    if (!g.moved) return
    // document point that was under the starting centroid
    this.view = { ...g.view }
    const [x, y] = this.screenToDoc(g.cx, g.cy)
    this.view.scale = clamp(g.view.scale * ratio, MIN_ZOOM, MAX_ZOOM)
    this.view.rot = g.view.rot + (now.angle - g.angle)
    this.anchor(x, y, now.cx, now.cy)
    this.viewChanged()
  }

  private endGesture() {
    const g = this.gesture
    this.gesture = null
    if (!g) return
    if (!g.moved && performance.now() - g.t0 < 350) {
      if (g.maxTouches === 2) this.undo()
      else if (g.maxTouches === 3) this.redo()
    }
  }

  // ---- eyedropper & fill ---------------------------------------------------

  private pickCanvas = makeCanvas(1, 1)

  private pick(x: number, y: number) {
    const { docW, docH, background, showBackground } = this.state
    if (x < 0 || y < 0 || x >= docW || y >= docH) return
    const ctx = this.pickCanvas.getContext("2d", { willReadFrequently: true })!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, 1, 1)
    if (showBackground) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, 1, 1)
    }
    ctx.setTransform(1, 0, 0, 1, -Math.floor(x), -Math.floor(y))
    if (this.fxActive()) ctx.drawImage(this.compose(), 0, 0)
    else this.drawLayers(ctx)
    const px = ctx.getImageData(0, 0, 1, 1).data
    if (px[3] === 0) return
    this.setState({ color: rgbToHsv(px[0], px[1], px[2], this.state.color.h) })
  }

  private fillAt(fx: number, fy: number) {
    const layer = this.activeLayer()
    const { docW: w, docH: h } = this.state
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    if (!layer || x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return
    if (!layer.visible) {
      this.notify("The active layer is hidden")
      return
    }
    if (this.state.editMask && layer.mask) {
      // On a mask the bucket simply reveals or hides the selected area.
      this.fillSelection()
      return
    }
    if (layer.fx) {
      this.notify("Select a paint layer — adjustment layers hold no pixels")
      return
    }
    const sel = this.selection
    const rgb = hexToRgb(hsvToHex(this.state.color))
    if (!rgb) return
    this.rememberColor()
    const tol = this.state.fillTolerance
    const alphaLock = layer.alphaLock

    this.replaceCanvas(layer.id, (src) => {
      const cpu = makeCanvas(w, h)
      const cctx = cpu.getContext("2d", { willReadFrequently: true })!
      cctx.drawImage(src, 0, 0)
      const img = cctx.getImageData(0, 0, w, h)
      const data = img.data
      const mask = new Uint8Array(w * h)
      const s = (y0 * w + x0) * 4
      const sr = data[s]
      const sg = data[s + 1]
      const sb = data[s + 2]
      const sa = data[s + 3]
      const match = (p: number) => {
        const i = p * 4
        return (
          Math.abs(data[i + 3] - sa) <= tol &&
          // colour only matters where there is something to see
          (data[i + 3] === 0 && sa === 0
            ? true
            : Math.abs(data[i] - sr) <= tol &&
              Math.abs(data[i + 1] - sg) <= tol &&
              Math.abs(data[i + 2] - sb) <= tol)
        )
      }

      // scanline flood fill
      const stack: number[] = [y0 * w + x0]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (mask[p] || !match(p)) continue
        const y = (p / w) | 0
        const row = y * w
        let xl = p - row
        let xr = xl
        while (xl > 0 && !mask[row + xl - 1] && match(row + xl - 1)) xl--
        while (xr < w - 1 && !mask[row + xr + 1] && match(row + xr + 1)) xr++
        for (let x = xl; x <= xr; x++) {
          mask[row + x] = 1
          if (y > 0 && !mask[row - w + x]) stack.push(row - w + x)
          if (y < h - 1 && !mask[row + w + x]) stack.push(row + w + x)
        }
      }

      const [fr, fg, fb] = rgb
      for (let p = 0; p < mask.length; p++) {
        const i = p * 4
        if (mask[p]) {
          data[i] = fr
          data[i + 1] = fg
          data[i + 2] = fb
          if (!alphaLock) data[i + 3] = 255
          continue
        }
        if (alphaLock) continue
        // Slide the fill underneath anti-aliased edges so no halo is left.
        const x = p % w
        const near =
          (x > 0 && mask[p - 1]) ||
          (x < w - 1 && mask[p + 1]) ||
          (p >= w && mask[p - w]) ||
          (p < mask.length - w && mask[p + w])
        if (near) {
          const a = data[i + 3] / 255
          data[i] = Math.round(data[i] * a + fr * (1 - a))
          data[i + 1] = Math.round(data[i + 1] * a + fg * (1 - a))
          data[i + 2] = Math.round(data[i + 2] * a + fb * (1 - a))
          data[i + 3] = 255
        }
      }
      cctx.putImageData(img, 0, 0)
      const out = makeCanvas(w, h)
      ctxOf(out).drawImage(cpu, 0, 0)
      // Keep the fill inside the selection.
      return sel
        ? maskedBlend(makeCanvas(w, h), makeCanvas(w, h), src, out, sel)
        : out
    })
  }

  // ---- export & autosave ---------------------------------------------------

  exportPNG(): Promise<Blob | null> {
    this.cancelAction()
    const { docW, docH, background, showBackground } = this.state
    const out = makeCanvas(docW, docH)
    const ctx = ctxOf(out)
    if (showBackground) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, docW, docH)
    }
    if (this.fxActive()) ctx.drawImage(this.compose(), 0, 0)
    else this.drawLayers(ctx)
    return new Promise((resolve) => out.toBlob(resolve, "image/png"))
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => void this.save(), 1500)
  }

  private async save() {
    if (this.action || this.settling) {
      this.scheduleSave()
      return
    }
    const s = this.state
    const blobs: Record<string, Blob> = {}
    for (const meta of s.layers) {
      if (meta.fx) continue
      const cached = this.blobCache.get(meta.id)
      if (cached && cached.rev === meta.rev) {
        blobs[meta.id] = cached.blob
        continue
      }
      const canvas = this.canvases.get(meta.id)
      if (!canvas) continue
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )
      if (!blob) continue
      blobs[meta.id] = blob
      this.blobCache.set(meta.id, { rev: meta.rev, blob })
    }
    for (const meta of s.layers) {
      const mask = meta.mask ? this.masks.get(meta.id) : undefined
      if (!mask) continue
      const key = `${meta.id}#mask`
      const rev = meta.maskRev ?? 0
      const cached = this.blobCache.get(key)
      if (cached && cached.rev === rev) {
        blobs[key] = cached.blob
        continue
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        mask.toBlob(resolve, "image/png")
      )
      if (!blob) continue
      blobs[key] = blob
      this.blobCache.set(key, { rev, blob })
    }
    for (const id of [...this.blobCache.keys()]) {
      if (!(id in blobs)) this.blobCache.delete(id)
    }
    try {
      await saveAutosave({
        version: 1,
        width: s.docW,
        height: s.docH,
        background: s.background,
        showBackground: s.showBackground,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        blobs,
      })
    } catch {
      // storage may be unavailable (private mode, quota) — painting still works
    }
  }
}

export const engine = new PaintEngine()
