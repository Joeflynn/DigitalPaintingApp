import { GPUBrush, GPUSizeError } from "./gpu-brush"
import {
  type BrushPreset,
  getBrush,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from "./brushes"
import { hexToHsv, hexToRgb, hsvToHex, rgbToHsv, type HSV } from "./color"
import { loadAutosave, saveAutosave, type SavedDoc } from "./storage"
import { Stroke } from "./stroke"
import {
  clamp,
  cloneCanvas,
  cropCanvas,
  ctxOf,
  makeCanvas,
  uid,
  type Rect,
} from "./util"

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
}

export type PaintTool = "brush" | "eraser" | "smudge"
export type ToolId = PaintTool | "fill" | "eyedropper" | "move" | "hand"

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

export interface EngineState {
  ready: boolean
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
}

type Action =
  | {
      kind: "stroke"
      pointerId: number
      stroke: Stroke
      layerId: string
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
  }

  private listeners = new Set<() => void>()
  private canvases = new Map<string, HTMLCanvasElement>()
  private gpu: GPUBrush | null = null
  /** A finished stroke whose wet paint is still flowing before it is committed. */
  private settling: { stroke: Stroke; layerId: string; frames: number } | null =
    null
  private scratchB = makeCanvas(1, 1)
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
        this.notify("Graphics device lost. Reload to resume painting.")
      })
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
    for (const meta of doc.layers) {
      const c = makeCanvas(doc.width, doc.height)
      const blob = doc.blobs[meta.id]
      if (blob) {
        const bmp = await createImageBitmap(blob)
        ctxOf(c).drawImage(bmp, 0, 0)
        bmp.close()
        this.blobCache.set(meta.id, { rev: meta.rev, blob })
      }
      this.canvases.set(meta.id, c)
      revCounter = Math.max(revCounter, meta.rev)
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
      canUndo: false,
      canRedo: false,
    })
    this.fit()
  }

  private allocate(w: number, h: number) {
    this.scratchB = makeCanvas(w, h)
  }

  newDocument(w: number, h: number, background = "#f6f3ec") {
    this.cancelAction()
    this.allocate(w, h)
    this.canvases.clear()
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

  private bumpRev(id: string) {
    this.setState({
      layers: this.state.layers.map((l) =>
        l.id === id ? { ...l, rev: nextRev() } : l
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
    }
  }

  private restore(s: StructSnap) {
    this.canvases = new Map(s.canvases)
    this.setState({ layers: s.layers, activeLayerId: s.activeLayerId })
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

  private applyPatch(layerId: string, r: Rect, patch: HTMLCanvasElement) {
    const c = this.canvases.get(layerId)
    if (!c) return
    const ctx = ctxOf(c)
    ctx.clearRect(r.x, r.y, r.w, r.h)
    ctx.drawImage(patch, r.x, r.y)
    this.bumpRev(layerId)
  }

  // ---- layer operations ----------------------------------------------------

  setActiveLayer(id: string) {
    this.finishSettle()
    if (this.action) return
    this.setState({ activeLayerId: id })
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
    this.structural(() => {
      const merged = cloneCanvas(this.canvases.get(lower.id)!)
      const ctx = ctxOf(merged)
      ctx.globalAlpha = upper.opacity
      ctx.globalCompositeOperation = upper.clip ? "source-atop" : upper.blend
      ctx.drawImage(this.canvases.get(upper.id)!, 0, 0)
      this.canvases.set(lower.id, merged)
      this.canvases.delete(upper.id)
      this.setState({
        layers: layers
          .filter((l) => l.id !== upper.id)
          .map((l) => (l.id === lower.id ? { ...l, rev: nextRev() } : l)),
        activeLayerId: lower.id,
      })
    })
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

  /** Replaces a layer's pixels with a new canvas, undoably. */
  private replaceCanvas(
    id: string,
    build: (src: HTMLCanvasElement) => HTMLCanvasElement
  ) {
    const src = this.canvases.get(id)
    if (!src) return
    this.structural(() => {
      this.canvases.set(id, build(src))
      this.bumpRev(id)
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
    this.setState({ tool })
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

  /** Draws every visible layer into ctx using whatever transform is set. */
  private drawLayers(ctx: CanvasRenderingContext2D) {
    const { layers } = this.state
    const a = this.action
    const live = this.liveStroke()
    for (let i = 0; i < layers.length; i++) {
      const m = layers[i]
      if (!m.visible) continue
      let src: HTMLCanvasElement | undefined = this.canvases.get(m.id)
      if (!src) continue
      let ox = 0
      let oy = 0
      if (live && this.gpu && live.layerId === m.id && live.stroke.dirty) {
        // The GPU canvas shows this whole layer with the stroke applied.
        src = this.gpu.canvas
      } else if (a?.kind === "move" && a.layerId === m.id) {
        ox = a.dx
        oy = a.dy
      }
      if (m.clip) {
        const base = this.baseOf(i)
        const baseCanvas = base && this.canvases.get(base.id)
        if (!base || !base.visible || !baseCanvas) continue
        const B = ctxOf(this.scratchB)
        B.globalAlpha = 1
        B.globalCompositeOperation = "copy"
        B.drawImage(src, ox, oy)
        B.globalCompositeOperation = "destination-in"
        B.drawImage(baseCanvas, 0, 0)
        src = this.scratchB
        ox = 0
        oy = 0
      }
      ctx.globalAlpha = m.opacity
      ctx.globalCompositeOperation = m.blend
      ctx.drawImage(src, ox, oy)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
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
    this.drawLayers(ctx)
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

    if (this.settling && --this.settling.frames <= 0) this.finishSettle()
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
    const show =
      isPaintTool(tool) &&
      this.pointerInside &&
      !this.spaceDown &&
      a?.kind !== "pan"
    if (!show) {
      el.style.opacity = "0"
      return
    }
    const size = Math.max(
      4,
      this.state.toolSettings[tool].size * this.view.scale
    )
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
      if (tool === "move") {
        this.action = {
          kind: "move",
          pointerId: id,
          layerId: layer.id,
          x0: x,
          y0: y,
          dx: 0,
          dy: 0,
        }
      } else {
        this.simPressure = 0.75
        this.beginPaint(tool, layer, id, x, y, this.pressure(e))
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
    p: number
  ) {
    const settings = this.state.toolSettings[tool]
    let brush: BrushPreset = {
      ...getBrush(settings.brushId),
      ...settings.dynamics,
    }
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
    if (tool === "brush") this.rememberColor()
    const rgb = hexToRgb(hsvToHex(this.state.color)) ?? [0, 0, 0]
    try {
      gpu.begin({
        width: this.state.docW,
        height: this.state.docH,
        source: this.canvases.get(layer.id),
        brush,
        color: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255],
        size: settings.size,
        opacity: settings.opacity,
        seed: Math.random() * 1000,
        mode:
          tool === "eraser" ? "erase" : tool === "smudge" ? "smudge" : "paint",
        alphaLock: layer.alphaLock,
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
    const stroke = new Stroke((...dab) => gpu.dab(...dab), brush, {
      size: settings.size,
      streamline: settings.streamline,
      mirrorX: this.state.symmetry ? this.state.docW / 2 : null,
    })
    stroke.add(x, y, p)
    this.action = { kind: "stroke", pointerId, stroke, layerId: layer.id }
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
          a.stroke.add(x, y, this.pressure(ev))
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
          this.settling = { stroke: a.stroke, layerId: a.layerId, frames }
        } else {
          this.commitStroke(a.stroke, a.layerId)
        }
        break
      }
      case "move":
        if (a.dx !== 0 || a.dy !== 0) {
          const { dx, dy } = a
          this.replaceCanvas(a.layerId, (src) => {
            const c = makeCanvas(src.width, src.height)
            ctxOf(c).drawImage(src, dx, dy)
            return c
          })
        }
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
    this.commitStroke(s.stroke, s.layerId)
    this.requestRender()
  }

  /**
   * Abandons the in-flight action without committing it. A stroke that has
   * already been released and is only settling is committed, not lost.
   */
  private cancelAction() {
    this.finishSettle()
    if (!this.action) return
    this.action = null
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

  /** Copies the stroke's footprint from the GPU canvas into the layer. */
  private commitStroke(stroke: Stroke, layerId: string) {
    const gpu = this.gpu
    const canvas = this.canvases.get(layerId)
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
    const after = cropCanvas(canvas, r)
    this.bumpRev(layerId)
    this.pushUndo({
      undo: () => this.applyPatch(layerId, r, before),
      redo: () => this.applyPatch(layerId, r, after),
    })
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
    this.drawLayers(ctx)
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
      return out
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
    this.drawLayers(ctx)
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
