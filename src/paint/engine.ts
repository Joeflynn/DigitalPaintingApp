import { GPUBrush, GPUSizeError } from "./gpu-brush"
import {
  type BrushPreset,
  dryBrush,
  maskBrush,
  getBrush,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
} from "./brushes"
import {
  DistortRenderer,
  liquifyDab,
  makeSession,
  nearestControl,
  offsetSession,
  updateMesh,
  type DistortMode,
  type DistortSession,
  type LiquifyTool,
} from "./distort"
import { defaultFx, getEffect, LOOKS, type LayerFx } from "./effects"
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
import {
  createProject,
  currentProjectId,
  deleteProjects,
  duplicateProject,
  listProjects,
  loadProject,
  rememberProject,
  saveProject,
  type SavedDoc,
} from "./storage"
import { Stroke, type DabTransform, type SampleExtra } from "./stroke"
import {
  clearImageAssets,
  isImageObject,
  setImageAsset,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_TEXT_STYLE,
  dragHandle,
  fitText,
  fontsUsed,
  handlesOf,
  hitHandle,
  hitObject,
  isLine,
  makeShape,
  makeText,
  normalizeShape,
  rasterize,
  type Handle,
  type ShapeKind,
  type ShapeStyle,
  type TextStyle,
  type VecPatch,
  type VectorObject,
} from "./vector"
import {
  clamp,
  alphaBounds,
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
  /**
   * Set on vector layers: the editable shapes and text, bottom first. The
   * layer's pixels are just a rasterised copy of these.
   */
  vector?: VectorObject[]
  /**
   * Set on groups: a folder that holds no pixels of its own. Its layers sit
   * directly beneath it in the stack and name it as their `parent`. A group
   * passes through: adjustment layers inside it act on everything below the
   * group, and the group's mask and opacity decide where and how strongly
   * its contents show.
   */
  group?: boolean
  /** Id of the group this layer is in. */
  parent?: string
  /** The group's contents are folded away in the layers panel. */
  collapsed?: boolean
  /** Set on a group made by the effect brush: the effect it was made from. */
  brushFx?: string
}

/** True for layers with no pixels of their own: adjustments and groups. */
export function noPixels(l: LayerMeta): boolean {
  return !!l.fx || !!l.group
}

/** The first and last index of a layer together with everything inside it. */
export function layerBlock(layers: LayerMeta[], id: string): [number, number] | null {
  const end = layers.findIndex((l) => l.id === id)
  if (end < 0) return null
  let start = end
  if (layers[end].group) {
    const inside = new Set([id])
    while (start > 0) {
      const below = layers[start - 1]
      if (!below.parent || !inside.has(below.parent)) break
      start--
      if (below.group) inside.add(below.id)
    }
  }
  return [start, end]
}

/** How many groups a layer is nested in. */
export function layerDepth(layers: LayerMeta[], layer: LayerMeta): number {
  let depth = 0
  let parent = layer.parent
  while (parent && depth < 32) {
    depth++
    const id: string = parent
    parent = layers.find((l) => l.id === id)?.parent
  }
  return depth
}

/**
 * The stack with a layer (and, for a group, its contents) moved one step up
 * or down, or null if it is already at that end. Stepping onto an open group
 * moves into it, and stepping past the edge of a group moves out of it.
 */
export function moveBlock(layers: LayerMeta[], id: string, dir: 1 | -1): LayerMeta[] | null {
  const block = layerBlock(layers, id)
  if (!block) return null
  const [s, e] = block
  const me = layers[e]
  const reparent = (parent: string | undefined) =>
    layers.map((l, i) => (i === e ? { ...l, parent } : l))
  const shift = (list: LayerMeta[], to: number) => {
    const next = list.slice()
    const moved = next.splice(s, e - s + 1)
    next.splice(to, 0, ...moved)
    return next
  }
  if (dir === 1) {
    const above = layers[e + 1]
    if (!above) return null
    // Out of the top of its group, to sit just above it.
    if (above.id === me.parent) return shift(reparent(above.parent), s + 1)
    if (above.parent === me.parent && !above.group) return shift(layers, s + 1)
    // A group sits above: its header if it is empty, else its lowest layer.
    let g: LayerMeta | undefined = above
    while (g && g.parent !== me.parent) {
      const pid: string | undefined = g.parent
      g = layers.find((l) => l.id === pid)
    }
    if (!g) return null
    if (!g.collapsed) return reparent(g.id)
    return shift(layers, layers.indexOf(g) - (e - s))
  }
  const below = layers[s - 1]
  if (!below || below.parent !== me.parent) {
    // Out of the bottom of its group, to sit just beneath it.
    if (!me.parent) return null
    return reparent(layers.find((l) => l.id === me.parent)?.parent)
  }
  if (!below.group) return shift(layers, s - 1)
  // Into the top of the group beneath: its layers sit under its header.
  if (!below.collapsed) return shift(reparent(below.id), s - 1)
  return shift(layers, layerBlock(layers, below.id)![0])
}

/** Where a dragged layer lands relative to the row it is dropped on. */
export type DropPlace = "above" | "below" | "inside"

/** The given ids that exist, minus any inside another given group (they move with it). */
export function outermostLayers(layers: LayerMeta[], ids: Iterable<string>): string[] {
  const chosen = new Set(ids)
  const byId = new Map(layers.map((l) => [l.id, l]))
  return [...chosen].filter((id) => {
    if (!byId.has(id)) return false
    let p = byId.get(id)?.parent
    for (let n = 0; p && n < 32; n++) {
      if (chosen.has(p)) return false
      p = byId.get(p)?.parent
    }
    return true
  })
}

function withParent(l: LayerMeta, parent: string | undefined): LayerMeta {
  const copy = { ...l }
  if (parent) copy.parent = parent
  else delete copy.parent
  return copy
}

/** Takes the blocks of the given layers out of the stack, keeping their order. */
function liftBlocks(layers: LayerMeta[], ids: Iterable<string>) {
  const roots = new Set(outermostLayers(layers, ids))
  const taken = new Set<number>()
  for (const id of roots) {
    const [s, e] = layerBlock(layers, id)!
    for (let i = s; i <= e; i++) taken.add(i)
  }
  return {
    roots,
    taken,
    rest: layers.filter((_, i) => !taken.has(i)),
    moved: layers.filter((_, i) => taken.has(i)),
  }
}

function sameStack(a: LayerMeta[], b: LayerMeta[]) {
  return a.length === b.length && a.every((l, i) => l.id === b[i].id && l.parent === b[i].parent)
}

/**
 * The stack with the given layers (each with its contents) moved next to,
 * or into, a target layer; a null target means the bottom of the stack.
 * Null if nothing would change or the target is among the moved layers.
 */
export function moveBlocks(
  layers: LayerMeta[],
  ids: Iterable<string>,
  targetId: string | null,
  place: DropPlace
): LayerMeta[] | null {
  const { rest, moved, roots } = liftBlocks(layers, ids)
  if (!moved.length) return null
  let at = 0
  let parent: string | undefined
  if (targetId !== null) {
    const target = rest.find((l) => l.id === targetId)
    if (!target || (place === "inside" && !target.group)) return null
    const ti = rest.indexOf(target)
    parent = place === "inside" ? target.id : target.parent
    at = place === "above" ? ti + 1 : place === "inside" ? ti : layerBlock(rest, target.id)![0]
  }
  const next = rest.slice()
  next.splice(at, 0, ...moved.map((l) => (roots.has(l.id) ? withParent(l, parent) : l)))
  return sameStack(next, layers) ? null : next
}

/**
 * The stack with the given layers gathered into `group`, which takes the
 * place (and the parent) of the topmost of them.
 */
export function groupBlocks(
  layers: LayerMeta[],
  ids: Iterable<string>,
  group: LayerMeta
): LayerMeta[] | null {
  const { rest, moved, roots, taken } = liftBlocks(layers, ids)
  if (!moved.length) return null
  const top = moved[moved.length - 1]
  const topIdx = layers.indexOf(top)
  let at = 0
  for (let i = 0; i < topIdx; i++) if (!taken.has(i)) at++
  const next = rest.slice()
  next.splice(
    at,
    0,
    ...moved.map((l) => (roots.has(l.id) ? withParent(l, group.id) : l)),
    withParent(group, top.parent)
  )
  return next
}

/** What the effect brush paints with: one effect, or a look made of several. */
export interface FxChoice {
  kind: "fx" | "look"
  id: string
}

export function fxChoiceLabel(c: FxChoice): string {
  return (c.kind === "look" ? LOOKS.find((l) => l.id === c.id)?.label : getEffect(c.id)?.label) ?? "Effect"
}

/** A layer split at the selection for distorting just the selected part. */
interface DistortSelection {
  cut: HTMLCanvasElement
  rest: HTMLCanvasElement
  maskCut: HTMLCanvasElement | null
  maskRest: HTMLCanvasElement | null
  /** Liquify: the selection that limits where the result shows. */
  clip: HTMLCanvasElement | null
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

export type PaintTool = "brush" | "eraser" | "smudge" | "fx"
export type FillMode = "bucket" | "linear" | "radial"
export type ToolId =
  | PaintTool
  | SelectTool
  | "fill"
  | "eyedropper"
  | "shape"
  | "text"
  | "distort"
  | "move"
  | "hand"

export function isSelectTool(t: ToolId): t is SelectTool {
  return (SELECT_TOOLS as string[]).includes(t)
}

export function isPaintTool(t: ToolId): t is PaintTool {
  return t === "brush" || t === "eraser" || t === "smudge" || t === "fx"
}

/** Tools that create or edit vector objects. */
export function isVectorTool(t: ToolId): boolean {
  return t === "shape" || t === "text" || t === "move"
}

/** The vector object selected on the active layer, if any. */
export function selectedObject(s: EngineState): VectorObject | null {
  if (!s.vecSel) return null
  const layer = s.layers.find((l) => l.id === s.activeLayerId)
  return layer?.vector?.find((o) => o.id === s.vecSel) ?? null
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
  /** The gallery project being painted, or null when none is open. */
  projectId: string | null
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
  /** The effect a new effect-brush group is made from. */
  fxChoice: FxChoice
  /** The effect brush hides the effect instead of revealing it. */
  fxHide: boolean
  color: HSV
  prevColor: HSV
  recentColors: string[]
  fillTolerance: number
  /** The fill tool floods an area, or drags out a gradient. */
  fillMode: FillMode
  /** Where a gradient ends up: the previous colour, or transparent. */
  gradientEnd: "previous" | "transparent"
  canUndo: boolean
  canRedo: boolean
  zoom: number
  rotation: number
  notice: { id: number; text: string } | null
  /** Id of the selected vector object on the active layer. */
  vecSel: string | null
  /** The selected text object is being typed into. */
  textEditing: boolean
  /** Which paint of a vector object the colour panel drives. */
  vecPaint: "fill" | "stroke"
  /** Style given to new shapes, and to new text. */
  shapeStyle: ShapeStyle
  textStyle: TextStyle
  distortMode: DistortMode
  /** Warp: control cells per side (1 = just the four corners). */
  warpGrid: number
  liqTool: LiquifyTool
  liqSize: number
  liqStrength: number
  /** Show the mesh over the layer while distorting. */
  distortGrid: boolean
  /** The active layer is set up to be distorted. */
  distortActive: boolean
  /** The distortion has changes that are not yet applied. */
  distortDirty: boolean
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
      kind: "gradient"
      pointerId: number
      layerId: string
      target: Target
      x0: number
      y0: number
      x1: number
      y1: number
    }
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
  | {
      kind: "vec"
      pointerId: number
      mode: "draw" | "move" | "resize" | "rotate"
      layerId: string
      objId: string
      /** The object as it was when the drag began. */
      orig: VectorObject
      handle?: Handle
      x0: number
      y0: number
      sx: number
      sy: number
      before: StructSnap
      moved: boolean
      /** Releasing without dragging starts editing this text. */
      edit: boolean
    }
  | {
      kind: "distort"
      pointerId: number
      /** The control point being dragged, and its offset from the pointer. */
      idx: number
      ox: number
      oy: number
    }
  | { kind: "liquify"; pointerId: number; lx: number; ly: number }

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

/** The view a frame was drawn with: document → screen is rotate, scale, then offset. */
export interface FrameInfo {
  tx: number
  ty: number
  scale: number
  rot: number
  dpr: number
  docW: number
  docH: number
}

export class PaintEngine {
  private state: EngineState = {
    ready: false,
    projectId: null,
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
      fx: defaultSettings("soft-airbrush", 160, 1),
    },
    fxChoice: { kind: "fx", id: "pixelate" },
    fxHide: false,
    color: { h: 18, s: 0.78, v: 0.2 },
    prevColor: { h: 12, s: 0.72, v: 0.86 },
    recentColors: [],
    fillTolerance: 40,
    fillMode: "bucket",
    gradientEnd: "previous",
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
    vecSel: null,
    textEditing: false,
    vecPaint: "fill",
    shapeStyle: DEFAULT_SHAPE_STYLE,
    textStyle: DEFAULT_TEXT_STYLE,
    distortMode: "warp",
    warpGrid: 3,
    liqTool: "push",
    liqSize: 260,
    liqStrength: 0.6,
    distortGrid: true,
    distortActive: false,
    distortDirty: false,
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
  /** What each vector layer's canvas currently shows. */
  private drawn = new WeakMap<
    HTMLCanvasElement,
    { objs: VectorObject[]; hide: string | null }
  >()
  private vecEdit: {
    key: string
    at: number
    after: StructSnap
    entry: UndoEntry
  } | null = null
  /** The text object being typed into, and the document before that began. */
  private textEdit: {
    layerId: string
    objId: string
    before: StructSnap
    /** The text when editing began; null for a brand-new object. */
    initial: string | null
  } | null = null
  private textEl: HTMLTextAreaElement | null = null
  private lastVecDown = { id: "", t: 0 }
  /** The distortion in progress on a layer, and its live result. */
  private distort:
    | (DistortSession & {
        layerId: string
        out: HTMLCanvasElement | null
        outMask: HTMLCanvasElement | null
        /** The layer has been handed to the renderer. */
        uploaded: boolean
        /**
         * With a selection, only it is distorted. Warp and perspective lift
         * the selected pixels (`cut`) and transform them over the rest;
         * liquify pushes the whole layer but keeps only what lands inside
         * the selection (`clip`).
         */
        sel: DistortSelection | null
      })
    | null = null
  private distortGL: DistortRenderer | null = null
  private fontsAsked = new Set<string>()

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
  /** Tool to return to after a one-shot eyedropper pick. */
  private pickReturn: ToolId | null = null
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
  private overlays = new Set<(ctx: CanvasRenderingContext2D, frame: FrameInfo) => void>()
  private symmetrySource: ((docW: number, docH: number) => DabTransform[]) | null = null
  /** Tail of the chain of saves, so they never overlap. */
  private saving: Promise<void> = Promise.resolve()
  /** Original files behind image fills, by id, kept so they can be saved. */
  private imageBlobs = new Map<string, Blob>()
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
    const projects = await listProjects().catch(() => [])
    const last = currentProjectId()
    const first = projects.find((p) => p.id === last) ?? projects[0]
    if (first && (await this.openProject(first.id))) {
      // A project adopted from the old single autosave has no thumbnail yet.
      if (!first.thumb) this.scheduleSave()
      return
    }
    if (projects.length > 0) this.closeProject()
    else await this.createProject(2000, 1400)
  }

  // ---- projects --------------------------------------------------------------

  /** Finishes whatever is in progress and writes the open project to storage. */
  flush(): Promise<void> {
    this.cancelAction()
    this.commitText()
    window.clearTimeout(this.saveTimer)
    this.saving = this.saving.then(() => this.save())
    return this.saving
  }

  /** Saves the open project and switches to another. False if it can't be read. */
  async openProject(id: string): Promise<boolean> {
    await this.flush()
    const doc = await loadProject(id).catch(() => null)
    if (!doc || doc.layers.length === 0) {
      this.notify("That painting couldn't be opened")
      return false
    }
    this.distort = null
    this.blobCache.clear()
    this.state = { ...this.state, projectId: id }
    try {
      await this.loadSaved(doc)
    } catch {
      this.closeProject()
      this.notify("That painting couldn't be opened")
      return false
    }
    rememberProject(id)
    return true
  }

  /** Starts a new project with a blank canvas and opens it. */
  async createProject(w: number, h: number, name = "Untitled painting"): Promise<string> {
    await this.flush()
    const id = uid("project")
    const now = Date.now()
    try {
      await createProject({ id, name, width: w, height: h, created: now, updated: now, thumb: null })
    } catch {
      // storage unavailable — the canvas still works, it just won't be kept
    }
    this.state = { ...this.state, projectId: id }
    rememberProject(id)
    this.newDocument(w, h)
    await this.flush()
    return id
  }

  /** Leaves no project open: the canvas is a blank scratch that isn't saved. */
  private closeProject() {
    window.clearTimeout(this.saveTimer)
    this.state = { ...this.state, projectId: null }
    rememberProject(null)
    this.newDocument(2000, 1400)
  }

  async deleteProjects(ids: string[]) {
    if (this.state.projectId && ids.includes(this.state.projectId)) {
      this.cancelAction()
      this.commitText()
      await this.saving
      this.closeProject()
    }
    await deleteProjects(ids)
  }

  async duplicateProject(id: string) {
    if (id === this.state.projectId) await this.flush()
    await duplicateProject(id, uid("project"))
  }

  private async loadSaved(doc: SavedDoc) {
    this.allocate(doc.width, doc.height)
    this.canvases.clear()
    this.masks.clear()
    this.resetSelection()
    this.imageBlobs.clear()
    clearImageAssets()
    for (const meta of doc.layers) {
      for (const o of meta.vector ?? []) {
        const blob = o.type === "shape" && o.image ? doc.blobs[`img:${o.image}`] : undefined
        if (!blob || o.type !== "shape" || !o.image || this.imageBlobs.has(o.image)) continue
        setImageAsset(o.image, await createImageBitmap(blob))
        this.imageBlobs.set(o.image, blob)
      }
    }
    for (const meta of doc.layers) {
      const c = noPixels(meta) ? makeCanvas(1, 1) : makeCanvas(doc.width, doc.height)
      const blob = meta.vector ? undefined : doc.blobs[meta.id]
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
    // A layer whose group has gone missing would never be drawn.
    const groups = new Set(doc.layers.filter((l) => l.group).map((l) => l.id))
    for (const l of doc.layers) if (l.parent && !groups.has(l.parent)) delete l.parent
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
      vecSel: null,
      textEditing: false,
    })
    this.syncVector()
    this.fit()
    if (this.state.tool === "distort") this.beginDistort(true)
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
    this.commitText()
    this.distort = null
    this.allocate(w, h)
    this.canvases.clear()
    this.masks.clear()
    this.resetSelection()
    this.blobCache.clear()
    this.imageBlobs.clear()
    clearImageAssets()
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
      vecSel: null,
    })
    this.fit()
    if (this.state.tool === "distort") this.beginDistort(true)
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

  private layerById(id: string | undefined): LayerMeta | undefined {
    return id ? this.state.layers.find((l) => l.id === id) : undefined
  }

  /** True if the layer and every group it is in are visible. */
  private shown(m: LayerMeta): boolean {
    let l: LayerMeta | undefined = m
    for (let n = 0; l && n < 32; n++) {
      if (!l.visible) return false
      l = this.layerById(l.parent)
    }
    return true
  }

  /**
   * The stack with new layers added above a layer (the active one by
   * default), in the same group; if that layer is a group they go inside it,
   * at the top.
   */
  private place(made: LayerMeta[], anchorId = this.state.activeLayerId): LayerMeta[] {
    const { layers } = this.state
    const idx = layers.findIndex((l) => l.id === anchorId)
    const anchor = layers[idx]
    const parent = anchor?.group ? anchor.id : anchor?.parent
    for (const l of made) {
      if (parent) l.parent = parent
      else delete l.parent
    }
    const next = layers.slice()
    next.splice(anchor?.group ? idx : idx + 1, 0, ...made)
    return next
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
    this.commitText()
    this.applyDistort()
    if (this.action) return
    const e = this.undoStack.pop()
    if (!e) return
    e.undo()
    this.redoStack.push(e)
    this.afterHistory()
  }

  redo() {
    this.finishSettle()
    this.commitText()
    this.applyDistort()
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
    if (this.state.tool === "distort") this.beginDistort(true)
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
    this.textEdit = null
    this.distort = null
    const active = s.layers.find((l) => l.id === s.activeLayerId)
    const sel = this.state.vecSel
    this.setState({
      layers: s.layers,
      activeLayerId: s.activeLayerId,
      hasSelection: !!s.selection,
      editMask: s.editMask,
      textEditing: false,
      vecSel: sel && active?.vector?.some((o) => o.id === sel) ? sel : null,
    })
    this.syncVector()
  }

  /** Runs a structural change and records before/after for undo. */
  private structural(fn: () => void) {
    this.cancelAction()
    this.commitText()
    this.applyDistort()
    this.distort = null
    const before = this.snap()
    fn()
    this.syncVector()
    if (this.state.tool === "distort") this.beginDistort(true)
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
    this.commitText()
    if (this.action) return
    if (id === this.state.activeLayerId) {
      this.setState({ editMask: false })
      return
    }
    this.applyDistort()
    this.setState({ activeLayerId: id, editMask: false, vecSel: null })
    if (this.state.tool === "distort") this.beginDistort()
    this.requestRender()
  }

  addLayer() {
    this.structural(() => {
      const { docW, docH } = this.state
      const layer = this.makeLayer()
      this.canvases.set(layer.id, makeCanvas(docW, docH))
      this.setState({ layers: this.place([layer]), activeLayerId: layer.id, editMask: false })
    })
  }

  addImageLayer(img: CanvasImageSource, iw: number, ih: number, name: string) {
    this.structural(() => {
      const { docW, docH } = this.state
      const layer = this.makeLayer(name)
      const c = makeCanvas(docW, docH)
      const s = Math.min(1, docW / iw, docH / ih)
      const w = iw * s
      const h = ih * s
      ctxOf(c).drawImage(img, (docW - w) / 2, (docH - h) / 2, w, h)
      this.canvases.set(layer.id, c)
      this.setState({ layers: this.place([layer]), activeLayerId: layer.id, editMask: false })
    })
  }

  /** Adds an adjustment layer running the given effect above the active layer. */
  addAdjustment(type: string) {
    this.addAdjustments([{ type }])
  }

  /**
   * Stacks one adjustment layer per item (first at the bottom) above the
   * active layer, as a single undo step. Used for multi-effect looks.
   */
  addAdjustments(
    items: { type: string; params?: Record<string, number>; opacity?: number }[]
  ) {
    if (!this.fx) {
      this.notify("Effects require a browser with WebGPU enabled.")
      return
    }
    const made = this.makeFxLayers(items)
    if (!made.length) return
    this.structural(() => {
      for (const layer of made) this.canvases.set(layer.id, makeCanvas(1, 1))
      this.setState({
        layers: this.place(made),
        activeLayerId: made[made.length - 1].id,
        editMask: false,
      })
    })
  }

  private makeFxLayers(
    items: { type: string; params?: Record<string, number>; opacity?: number }[]
  ): LayerMeta[] {
    const made: LayerMeta[] = []
    for (const item of items) {
      const def = getEffect(item.type)
      if (!def) continue
      const fx = defaultFx(def)
      Object.assign(fx.params, item.params)
      made.push({
        ...this.makeLayer(def.label),
        fx,
        opacity: item.opacity ?? 1,
      })
      this.layerCounter -= 1
    }
    return made
  }

  // ---- groups ----------------------------------------------------------------

  /** Adds an empty group above the active layer. */
  addGroup() {
    this.structural(() => {
      const group: LayerMeta = { ...this.makeLayer("Group"), group: true }
      this.layerCounter -= 1
      this.canvases.set(group.id, makeCanvas(1, 1))
      this.setState({ layers: this.place([group]), activeLayerId: group.id, editMask: false })
    })
  }

  /** Wraps a layer (or a group) in a new group. */
  groupLayer(id: string) {
    this.groupLayers([id])
  }

  /**
   * Gathers layers (groups come with their contents) into a new group where
   * the topmost of them was, and makes the group active.
   */
  groupLayers(ids: Iterable<string>) {
    const group: LayerMeta = { ...this.makeLayer("Group"), group: true }
    this.layerCounter -= 1
    const next = groupBlocks(this.state.layers, ids, group)
    if (!next) return
    this.structural(() => {
      this.canvases.set(group.id, makeCanvas(1, 1))
      this.setState({ layers: next, activeLayerId: group.id, editMask: false })
    })
  }

  /** Moves layers above, below or into a target layer (null: the bottom of the stack). */
  moveLayersTo(ids: Iterable<string>, targetId: string | null, place: DropPlace) {
    const next = moveBlocks(this.state.layers, ids, targetId, place)
    if (!next) return
    this.structural(() => this.setState({ layers: next }))
  }

  /** Dissolves a group, leaving its layers where they are. */
  ungroup(id: string) {
    const group = this.layerById(id)
    if (!group?.group) return
    this.structural(() => {
      const { layers, activeLayerId } = this.state
      const idx = layers.indexOf(group)
      const next = layers
        .filter((l) => l.id !== id)
        .map((l) => {
          if (l.parent !== id) return l
          const rest = { ...l }
          delete rest.parent
          return group.parent ? { ...rest, parent: group.parent } : rest
        })
      if (next.length === 0) return
      this.canvases.delete(id)
      this.masks.delete(id)
      this.setState({
        layers: next,
        activeLayerId: activeLayerId === id ? next[Math.max(0, idx - 1)].id : activeLayerId,
        editMask: false,
      })
    })
  }

  // ---- effect brush ----------------------------------------------------------

  /** The masked group the effect brush would paint on: the active layer's, if any. */
  effectGroup(): LayerMeta | null {
    let l = this.activeLayer()
    for (let n = 0; l && n < 32; n++) {
      if (l.group && l.mask) return l
      l = this.layerById(l.parent)
    }
    return null
  }

  /** Picks the effect the effect brush paints, and sets up a group for it. */
  setFxChoice(choice: FxChoice) {
    this.setState({ fxChoice: choice })
    this.addEffectGroup(choice)
  }

  setFxHide(hide: boolean) {
    this.setState({ fxHide: hide })
  }

  /**
   * Adds a group holding the chosen effect's adjustment layers, hidden
   * everywhere by its mask until the effect brush paints it in. It goes above
   * the effect group being painted, or else above the active layer.
   */
  addEffectGroup(choice = this.state.fxChoice): boolean {
    if (!this.fx) {
      this.notify("Effects require a browser with WebGPU enabled.")
      return false
    }
    const look = choice.kind === "look" ? LOOKS.find((l) => l.id === choice.id) : undefined
    const made = this.makeFxLayers(look ? look.layers : [{ type: choice.id }])
    if (!made.length) return false
    this.structural(() => {
      const group: LayerMeta = {
        ...this.makeLayer(`${fxChoiceLabel(choice)} brush`),
        group: true,
        mask: true,
        maskRev: nextRev(),
        brushFx: `${choice.kind}:${choice.id}`,
      }
      this.layerCounter -= 1
      for (const l of [...made, group]) this.canvases.set(l.id, makeCanvas(1, 1))
      this.masks.set(group.id, this.blank())
      const current = this.effectGroup()
      let next: LayerMeta[]
      if (current) {
        // Beside the group being painted, not inside it.
        if (current.parent) group.parent = current.parent
        next = this.state.layers.slice()
        next.splice(next.indexOf(current) + 1, 0, group)
      } else {
        next = this.place([group])
      }
      for (const l of made) l.parent = group.id
      next.splice(next.indexOf(group), 0, ...made)
      this.setState({ layers: next, activeLayerId: group.id, editMask: true })
    })
    return true
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
    const block = layerBlock(this.state.layers, id)
    if (!block) return
    this.structural(() => {
      const { layers } = this.state
      const [s, e] = block
      // A group is copied with everything inside it.
      const ids = new Map<string, string>()
      for (let i = s; i <= e; i++) ids.set(layers[i].id, uid("layer"))
      const copies = layers.slice(s, e + 1).map((meta, i): LayerMeta => {
        const copy: LayerMeta = { ...meta, id: ids.get(meta.id)!, rev: nextRev() }
        if (s + i === e) copy.name = `${meta.name} copy`
        else copy.parent = ids.get(meta.parent ?? "") ?? meta.parent
        const src = this.canvases.get(meta.id)
        if (src) this.canvases.set(copy.id, cloneCanvas(src))
        const mask = this.masks.get(meta.id)
        if (mask) {
          this.masks.set(copy.id, cloneCanvas(mask))
          copy.maskRev = nextRev()
        }
        return copy
      })
      const next = layers.slice()
      next.splice(e + 1, 0, ...copies)
      this.setState({ layers: next, activeLayerId: copies[copies.length - 1].id })
    })
  }

  deleteLayer(id: string) {
    const { layers } = this.state
    const block = layerBlock(layers, id)
    if (!block) return
    const [s, e] = block
    const next = layers.filter((_, i) => i < s || i > e)
    if (next.every((l) => l.group)) {
      // A painting always keeps a layer to paint on.
      if (layers[e].group) this.notify("A painting needs at least one layer")
      else this.clearLayer(id)
      return
    }
    this.structural(() => {
      for (let i = s; i <= e; i++) {
        this.canvases.delete(layers[i].id)
        this.masks.delete(layers[i].id)
      }
      let active = this.state.activeLayerId
      if (!next.some((l) => l.id === active)) active = next[Math.max(0, s - 1)].id
      this.setState({ layers: next, activeLayerId: active, editMask: false })
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
    if (upper.group) {
      this.notify("Groups can't be merged down")
      return
    }
    if (lower.group || lower.parent !== upper.parent) {
      this.notify("No layer directly below to merge into")
      return
    }
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
              ? {
                  ...l,
                  rev: nextRev(),
                  mask: false,
                  maskOff: false,
                  vector: undefined,
                }
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
    const next = moveBlock(this.state.layers, id, dir)
    if (!next) return
    this.structural(() => this.setState({ layers: next }))
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
    const meta = this.state.layers.find((l) => l.id === id)
    if (target === "pixels" && meta && noPixels(meta)) {
      this.notify(meta.group ? "Groups have no pixels to edit" : "Adjustment layers have no pixels to edit")
      return
    }
    if (target === "pixels" && meta && !this.pixelLayer(meta, "Rasterise this vector layer to edit its pixels")) {
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
    this.pickReturn = null
    this.commitText()
    if (this.poly) this.poly = null
    if (tool !== "distort" && this.state.tool === "distort") {
      // Leaving the tool keeps the distortion.
      this.applyDistort()
      this.distort = null
      this.setState({ distortActive: false })
    }
    const entering = tool === "distort" && this.state.tool !== "distort"
    this.setState({
      tool,
      ...(isSelectTool(tool) ? { selectTool: tool } : null),
      // A selected object stays selected only for the move tool.
      ...(tool === "move" ? null : { vecSel: null }),
    })
    this.styleFromColor()
    if (entering) this.beginDistort()
    this.requestRender()
    this.updateCursor()
  }

  /**
   * Eyedropper for a single pick: the next click on the canvas takes a colour
   * and the previous tool comes back. Pressing it again cancels.
   */
  pickOnce() {
    const { tool } = this.state
    if (tool === "eyedropper") {
      const back = this.pickReturn ?? "brush"
      this.pickReturn = null
      this.setTool(back)
      return
    }
    this.setTool("eyedropper")
    this.pickReturn = tool
  }

  /** New shapes and text start out in the current colour. */
  private styleFromColor() {
    const { tool, vecPaint, shapeStyle, textStyle } = this.state
    const hex = hsvToHex(this.state.color)
    if (tool === "text" && textStyle[vecPaint] !== null) {
      this.setState({ textStyle: { ...textStyle, [vecPaint]: hex } })
    } else if (tool === "shape" && shapeStyle[vecPaint] !== null) {
      this.setState({ shapeStyle: { ...shapeStyle, [vecPaint]: hex } })
    }
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
    if (this.state.tool === "distort") {
      const size = this.state.liqSize
      this.setDistortOptions({ liqSize: size + dir * Math.max(2, size * 0.12) })
      return
    }
    const tool = this.settingsTool()
    const size = this.state.toolSettings[tool].size
    const step = Math.max(1, Math.round(size * 0.12))
    this.setToolSettings(tool, { size: size + dir * step })
  }

  setColor(color: HSV) {
    this.setState({ color })
    this.colorToVector()
  }

  setColorHex(hex: string) {
    const hsv = hexToHsv(hex, this.state.color.h)
    if (!hsv) return
    this.setState({ color: hsv })
    this.colorToVector()
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

  /**
   * Adds something drawn over the picture on screen only (guides, references).
   * It is called in document space after the layers; exports never include it.
   */
  addOverlay(draw: (ctx: CanvasRenderingContext2D, frame: FrameInfo) => void) {
    this.overlays.add(draw)
    return () => {
      this.overlays.delete(draw)
    }
  }

  /** Where each new stroke asks for its symmetry copies. */
  setSymmetrySource(source: ((docW: number, docH: number) => DabTransform[]) | null) {
    this.symmetrySource = source
  }

  setFillTolerance(v: number) {
    this.setState({ fillTolerance: clamp(Math.round(v), 0, 255) })
  }

  setFillOptions(patch: Partial<Pick<EngineState, "fillMode" | "gradientEnd">>) {
    this.setState(patch)
    this.updateCursor()
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
    canvas.addEventListener("mousedown", this.onMouseDown)
    canvas.addEventListener("auxclick", this.onMouseDown)
    canvas.addEventListener("contextmenu", this.onContext)
    this.requestRender()
    return () => {
      canvas.removeEventListener("pointerdown", this.onDown)
      canvas.removeEventListener("pointermove", this.onMove)
      canvas.removeEventListener("pointerup", this.onUp)
      canvas.removeEventListener("pointercancel", this.onCancel)
      canvas.removeEventListener("pointerleave", this.onLeave)
      canvas.removeEventListener("wheel", this.onWheel)
      canvas.removeEventListener("mousedown", this.onMouseDown)
      canvas.removeEventListener("auxclick", this.onMouseDown)
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

  /** The layer a clipped layer `index` hangs from: the first unclipped one beneath it in its group. */
  private baseOf(index: number): LayerMeta | null {
    const { layers } = this.state
    const parent = layers[index].parent
    for (let j = index - 1; j >= 0; j--) {
      if (layers[j].parent !== parent) return null
      if (!layers[j].clip || layers[j].group) return layers[j]
    }
    return null
  }

  /** The paint layer that clipped layer `index` is masked by, if any. */
  private clipBase(index: number): LayerMeta | null {
    if (!this.state.layers[index].clip) return null
    const base = this.baseOf(index)
    return base && !noPixels(base) ? base : null
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
    const d = this.distort
    if (d?.outMask && d.layerId === m.id && this.state.distortDirty) {
      return { src: d.outMask, ox: 0, oy: 0 }
    }
    const g = this.action
    if (g?.kind === "gradient" && g.layerId === m.id && g.target === "mask") {
      return { src: this.gradientOver(src, g, false, this.scratch("liveMask")), ox: 0, oy: 0 }
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
    const d = this.distort
    if (d?.out && d.layerId === m.id && this.state.distortDirty) {
      src = d.out
    } else if (a?.kind === "gradient" && a.layerId === m.id && a.target === "pixels") {
      src = this.gradientOver(base, a, m.alphaLock, this.scratch("live"))
    } else if (this.isLive(m, "pixels")) {
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
      if (base && !noPixels(base)) {
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
   * Adjustment layers and group masks are skipped; `compose()` is the path
   * that honours them.
   */
  private drawLayers(ctx: CanvasRenderingContext2D) {
    const { layers } = this.state
    for (let i = 0; i < layers.length; i++) {
      if (!noPixels(layers[i]) && this.shown(layers[i])) this.drawLayer(ctx, i)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = "source-over"
  }

  /**
   * True when the document must be flattened to be shown: a visible
   * adjustment layer, or a group whose mask or opacity is in play.
   */
  private fxActive(): boolean {
    return this.state.layers.some(
      (l) =>
        ((l.fx && !!this.fx) || (l.group && ((l.mask && !l.maskOff) || l.opacity < 1))) &&
        this.shown(l)
    )
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
    const busy =
      !!this.liveStroke() ||
      this.action?.kind === "move" ||
      this.state.distortDirty
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
            l.group,
            l.parent,
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

    this.composeInto(this.comp, undefined, 0)
    return this.comp
  }

  /** Draws the layers of one group (or the top level) over what `target` holds. */
  private composeInto(target: HTMLCanvasElement, parent: string | undefined, depth: number) {
    const { layers } = this.state
    const kids: number[] = []
    layers.forEach((l, i) => {
      if (l.parent === parent) kids.push(i)
    })
    const A = ctxOf(target)
    for (let k = 0; k < kids.length; k++) {
      const i = kids[k]
      const m = layers[i]
      if (!m.visible) continue
      if (m.group) {
        this.composeGroup(target, m, depth)
        continue
      }
      if (m.fx) {
        // Clipped adjustments are handled with their base layer below.
        if (!this.clipBase(i)) this.applyFx(target, m)
        continue
      }
      // The run of layers clipped to this one.
      let end = k
      if (!m.clip) {
        while (end + 1 < kids.length && layers[kids[end + 1]].clip && !layers[kids[end + 1]].group) end++
      }
      const run = kids.slice(k + 1, end + 1)
      if (!run.some((j) => layers[j].fx && layers[j].visible)) {
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
        for (const j of run) {
          const f = layers[j]
          if (!f.visible) continue
          if (f.fx) this.applyFx(this.scratchG, f)
          else this.drawLayer(G, j)
        }
        A.globalAlpha = m.opacity
        A.globalCompositeOperation = m.blend
        A.drawImage(this.scratchG, 0, 0)
      }
      k = end
    }
    A.globalAlpha = 1
    A.globalCompositeOperation = "source-over"
  }

  /**
   * Draws a group over `target`. A group passes through, so its layers are
   * drawn straight onto a copy of what is beneath; the copy then replaces the
   * original only as far as the group's mask and opacity allow.
   */
  private composeGroup(target: HTMLCanvasElement, m: LayerMeta, depth: number) {
    const masked = !!m.mask && !m.maskOff && this.masks.has(m.id)
    if (!masked && m.opacity >= 1) {
      this.composeInto(target, m.id, depth + 1)
      return
    }
    const { docW, docH } = this.state
    const group = this.scratch(`group${depth}`)
    const G = ctxOf(group)
    G.globalAlpha = 1
    G.globalCompositeOperation = "copy"
    G.drawImage(target, 0, 0)
    G.globalCompositeOperation = "source-over"
    this.composeInto(group, m.id, depth + 1)
    // Only now fetch the mask: a live one may share a canvas with the layers.
    const mask = this.maskOf(m)
    const T = ctxOf(target)
    G.globalAlpha = m.opacity
    G.globalCompositeOperation = "destination-in"
    T.globalAlpha = m.opacity
    T.globalCompositeOperation = "destination-out"
    if (mask) {
      G.drawImage(mask.src, mask.ox, mask.oy)
      T.drawImage(mask.src, mask.ox, mask.oy)
    } else {
      G.fillStyle = "#000"
      G.fillRect(0, 0, docW, docH)
      T.fillStyle = "#000"
      T.fillRect(0, 0, docW, docH)
    }
    G.globalAlpha = 1
    G.globalCompositeOperation = "source-over"
    T.globalAlpha = 1
    T.globalCompositeOperation = "lighter"
    T.drawImage(group, 0, 0)
    T.globalCompositeOperation = "source-over"
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
    // Twirl, pinch and the like keep working for as long as the brush is held.
    if (this.action?.kind === "liquify") {
      this.liquifyAt(this.action.lx, this.action.ly, 0, 0)
      if (this.state.liqTool !== "push") this.requestRender()
    }
    const ctx = ctxOf(canvas)
    const { docW, docH, background, showBackground } = this.state
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

    if (this.overlays.size > 0) {
      const frame: FrameInfo = { tx, ty, scale, rot, dpr: d, docW, docH }
      for (const draw of this.overlays) {
        ctx.save()
        draw(ctx, frame)
        ctx.restore()
      }
    }

    this.drawOverlay(ctx, canvas)
    this.drawVecOverlay(ctx)
    this.drawDistortOverlay(ctx)
    this.drawGradientOverlay(ctx)
    this.placeTextEditor()

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
            ? this.activeLayer()?.vector
              ? "default"
              : "move"
            : tool === "text"
              ? "text"
              : "crosshair"
    if (!el) return
    const brushSize = isPaintTool(tool)
      ? this.state.toolSettings[tool].size
      : tool === "select-brush"
        ? this.state.selBrushSize
        : tool === "distort" &&
            this.state.distortActive &&
            this.state.distortMode === "liquify"
          ? this.state.liqSize
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

  /** When the last wheel event looked like a touchpad, so one gesture stays one kind. */
  private touchpadUntil = 0

  /**
   * Mouse wheel zooms; a touchpad's two-finger scroll pans and its pinch
   * (which browsers report as a ctrl-wheel) zooms. Shift-wheel rotates.
   */
  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [sx, sy] = this.local(e)
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
      this.zoomAt(sx, sy, Math.exp(-delta * 0.01))
      return
    }
    // Touchpads scroll in fine pixel steps and often sideways; wheels click
    // in large, whole, vertical-only steps (or in lines).
    const now = performance.now()
    const fine =
      e.deltaMode === 0 &&
      (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 16)
    if (fine) this.touchpadUntil = now + 400
    if (now < this.touchpadUntil && !e.shiftKey) {
      this.view.tx -= e.deltaX
      this.view.ty -= e.deltaY
      this.viewChanged()
      return
    }
    if (e.shiftKey) {
      this.rotateBy(((e.deltaY || e.deltaX) > 0 ? 1 : -1) * (Math.PI / 36), sx, sy)
      return
    }
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
    this.zoomAt(sx, sy, Math.exp(-delta * 0.0018))
  }

  /** Stops the browser's middle-click autoscroll so the middle button can pan. */
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault()
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
    // A press outside text being edited finishes it rather than starting more.
    const wasTyping = !!this.textEdit
    this.commitText()

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
      // Selecting an area of pixels treats an image as pixels from then on.
      const active = this.activeLayer()
      if (active?.vector?.some(isImageObject)) this.pixelLayer(active, "")
      this.beginSelect(tool, e, id, x, y, sx, sy)
    } else if (e.altKey || e.button === 2 || tool === "eyedropper") {
      this.action = { kind: "pick", pointerId: id }
      this.pick(x, y)
    } else if (tool === "fill") {
      if (this.state.fillMode === "bucket") this.fillAt(x, y)
      else this.beginGradient(id, x, y)
    } else if (tool === "distort") {
      if (e.button === 0) this.beginDistortDrag(id, x, y)
    } else if (
      tool === "shape" ||
      tool === "text" ||
      (tool === "move" && this.activeLayer()?.vector)
    ) {
      if (e.button === 0) this.beginVector(tool, id, x, y, sx, sy, !wasTyping)
    } else if (tool === "fx") {
      this.simPressure = 0.75
      if (e.button === 0) this.beginEffectPaint(id, x, y, this.pressure(e), this.sampleExtra(e))
    } else {
      const layer = this.activeLayer()
      if (!layer) return
      if (!this.shown(layer)) {
        this.notify("The active layer is hidden")
        return
      }
      const onMask = this.state.editMask && !!layer.mask
      if (noPixels(layer) && !(onMask || (tool === "move" && layer.mask))) {
        this.notify(
          layer.group
            ? "Select a paint layer — groups hold no pixels"
            : "Select a paint layer — adjustment layers hold no pixels"
        )
        return
      }
      if (!onMask && !this.pixelLayer(layer, "Rasterise this vector layer to paint on it")) return
      if (tool === "move") {
        const sel = this.selection
        const src = this.canvases.get(layer.id)
        let float: { cut: HTMLCanvasElement; rest: HTMLCanvasElement } | undefined
        if (sel && src && !noPixels(layer)) {
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

  /**
   * Starts an effect-brush stroke: it paints the mask of the effect group the
   * active layer belongs to, making one from the chosen effect if there is none.
   */
  private beginEffectPaint(pointerId: number, x: number, y: number, p: number, extra: SampleExtra) {
    let group = this.effectGroup()
    if (!group) {
      if (!this.addEffectGroup()) return
      group = this.effectGroup()
    }
    if (!group) return
    if (!this.shown(group)) {
      this.notify("That effect group is hidden")
      return
    }
    if (group.maskOff) this.setLayerProps(group.id, { maskOff: false }, false)
    this.beginPaint("fx", group, pointerId, x, y, p, extra)
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
    // Smudging drags the paint already there with a dry version of the brush;
    // the tool's opacity acts as its strength.
    if (tool === "smudge") brush = dryBrush(brush)
    // The effect brush only ever paints a mask, so pigment plays no part.
    if (tool === "fx") brush = maskBrush(brush)
    const gpu = this.gpu
    if (!gpu) {
      this.notify("Painting requires WebGPU. Enable it and reload.")
      return
    }
    // On a mask the brush reveals with light colours and hides with dark.
    const target: Target =
      tool === "fx" || (this.state.editMask && layer.mask) ? "mask" : "pixels"
    const onMask = target === "mask"
    const hide =
      onMask &&
      (tool === "eraser" || (tool === "fx" ? this.state.fxHide : this.colorIsDark()))
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
      symmetry: this.symmetrySource?.(this.state.docW, this.state.docH) ?? [],
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
      case "gradient": {
        let [x, y] = this.screenToDoc(sx, sy)
        if (e.shiftKey) {
          // Shift snaps the direction to 45° steps.
          const ang = Math.round(Math.atan2(y - a.y0, x - a.x0) / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(x - a.x0, y - a.y0)
          x = a.x0 + Math.cos(ang) * len
          y = a.y0 + Math.sin(ang) * len
        }
        a.x1 = x
        a.y1 = y
        this.requestRender()
        break
      }
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
      case "distort": {
        const d = this.distort
        if (!d?.ctrl) break
        const [x, y] = this.screenToDoc(sx, sy)
        d.ctrl[a.idx * 2] = x + a.ox
        d.ctrl[a.idx * 2 + 1] = y + a.oy
        updateMesh(d)
        this.distortChanged()
        break
      }
      case "liquify": {
        const events =
          typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : []
        let moved = false
        for (const ev of events.length > 0 ? events : [e]) {
          const [lx, ly] = this.local(ev)
          const [x, y] = this.screenToDoc(lx, ly)
          // Take a fast move in short steps so the mesh stretches, not tears.
          const dx = x - a.lx
          const dy = y - a.ly
          const n = Math.max(
            1,
            Math.ceil(Math.hypot(dx, dy) / (this.state.liqSize * 0.08))
          )
          for (let i = 1; i <= n; i++) {
            if (
              this.liquifyAt(a.lx + (dx * i) / n, a.ly + (dy * i) / n, dx / n, dy / n, false)
            ) {
              moved = true
            }
          }
          a.lx = x
          a.ly = y
        }
        if (moved) this.distortChanged()
        break
      }
      case "vec": {
        if (!a.moved && Math.hypot(sx - a.sx, sy - a.sy) < 3) break
        a.moved = true
        const [x, y] = this.screenToDoc(sx, sy)
        this.dragVector(a, x, y, e.shiftKey)
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
      case "gradient":
        this.commitGradient(a)
        break
      case "pick":
        // The colour panel's eyedropper picks once, then hands back the tool.
        if (this.pickReturn && this.state.tool === "eyedropper") {
          const back = this.pickReturn
          this.pickReturn = null
          this.setTool(back)
        }
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
      case "vec":
        this.finishVector(a)
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
    if (a.kind === "vec") this.restore(a.before)
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
      if (!noPixels(meta)) {
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
    // A new selection changes what is being distorted: keep what was done
    // and start over on the new area.
    if (this.state.tool === "distort" && this.distort) this.applyDistort()
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
    if (sampleAll || !layer || noPixels(layer)) {
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
    if (!layer || noPixels(layer)) {
      this.notify("That layer holds no pixels to select")
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
    if (noPixels(layer)) {
      this.notify("Select a paint layer — that layer holds no pixels")
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
    if (!layer || noPixels(layer)) {
      this.notify("Select a paint layer — that layer holds no pixels")
      return
    }
    const sel = this.selection
    if (!sel) {
      if (!cut) this.duplicateLayer(layer.id)
      return
    }
    if (cut && !this.pixelLayer(layer, "Rasterise this vector layer to cut pixels from it")) return
    this.structural(() => {
      const piece = this.bakedPixels(layer)
      const p = ctxOf(piece)
      p.globalCompositeOperation = "destination-in"
      p.drawImage(sel, 0, 0)
      p.globalCompositeOperation = "source-over"
      const layers = this.state.layers
      if (cut) {
        const rest = cloneCanvas(this.canvases.get(layer.id)!)
        const r = ctxOf(rest)
        r.globalCompositeOperation = "destination-out"
        r.drawImage(sel, 0, 0)
        r.globalCompositeOperation = "source-over"
        this.canvases.set(layer.id, rest)
        this.setState({
          layers: layers.map((l) => (l.id === layer.id ? { ...l, rev: nextRev() } : l)),
        })
      }
      this.layerCounter -= 1
      const made = this.makeLayer(`${layer.name} ${cut ? "cut" : "copy"}`)
      this.canvases.set(made.id, piece)
      const next = this.place([made], layer.id)
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
    if (noPixels(meta)) {
      this.notify(
        meta.group
          ? "A group's mask can't be applied to pixels"
          : "An adjustment layer's mask can't be applied — merge it down instead"
      )
      return
    }
    this.structural(() => {
      this.canvases.set(id, this.bakedPixels({ ...meta, maskOff: false }))
      this.masks.delete(id)
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                mask: false,
                maskOff: false,
                rev: nextRev(),
                vector: undefined,
              }
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

  // ---- vector objects ------------------------------------------------------

  /** The vector object selected on the active layer, if any. */
  selectedObject(): VectorObject | null {
    return selectedObject(this.state)
  }

  private objectIn(layerId: string, objId: string): VectorObject | undefined {
    return this.state.layers
      .find((l) => l.id === layerId)
      ?.vector?.find((o) => o.id === objId)
  }

  /** Redraws any vector layer whose canvas is out of date with its objects. */
  private syncVector() {
    const hide = this.textEdit?.objId ?? null
    for (const l of this.state.layers) {
      if (!l.vector) continue
      const c = this.canvases.get(l.id)
      if (!c) continue
      const d = this.drawn.get(c)
      if (d && d.objs === l.vector && d.hide === hide) continue
      rasterize(c, l.vector, hide)
      this.drawn.set(c, { objs: l.vector, hide })
      this.loadFonts(l.vector)
    }
  }

  /** Web fonts arrive late; re-measure and redraw text once they are in. */
  private loadFonts(objects: VectorObject[]) {
    for (const font of fontsUsed(objects)) {
      if (this.fontsAsked.has(font)) continue
      this.fontsAsked.add(font)
      if (document.fonts.check(font)) continue
      document.fonts.load(font).then(
        () => {
          this.drawn = new WeakMap()
          this.setState({
            layers: this.state.layers.map((l) =>
              l.vector
                ? {
                    ...l,
                    rev: nextRev(),
                    vector: l.vector.map((o) =>
                      o.type === "text" ? fitText(o) : o
                    ),
                  }
                : l
            ),
          })
          this.syncVector()
          this.requestRender()
        },
        () => {}
      )
    }
  }

  private setObjects(
    layerId: string,
    objects: VectorObject[],
    extra?: Partial<EngineState>
  ) {
    this.setState({
      ...extra,
      layers: this.state.layers.map((l) =>
        l.id === layerId ? { ...l, vector: objects, rev: nextRev() } : l
      ),
    })
    this.syncVector()
    this.requestRender()
  }

  private patchObject(layerId: string, objId: string, next: VectorObject) {
    const objs = this.state.layers.find((l) => l.id === layerId)?.vector
    if (!objs) return
    this.setObjects(
      layerId,
      objs.map((o) => (o.id === objId ? next : o))
    )
  }

  /**
   * Records a finished vector edit for undo. Rapid edits sharing a key (a
   * slider drag, a run of nudges) collapse into one step.
   */
  private vecCommit(before: StructSnap, key = "") {
    const after = this.snap()
    const now = performance.now()
    const e = this.vecEdit
    if (
      key &&
      e &&
      e.key === key &&
      this.undoStack[this.undoStack.length - 1] === e.entry &&
      now - e.at < 1200
    ) {
      e.after = after
      e.at = now
      this.scheduleSave()
      return
    }
    const edit = { key, at: now, after, entry: null as unknown as UndoEntry }
    edit.entry = {
      undo: () => this.restore(before),
      redo: () => this.restore(edit.after),
    }
    this.vecEdit = key ? edit : null
    this.pushUndo(edit.entry)
  }

  /**
   * Changes properties of the selected object — and of the style new objects
   * of that kind are given. With nothing selected only the style changes.
   */
  setVectorProps(patch: VecPatch) {
    const apply = <T extends object>(target: T): T => {
      const out = { ...target } as Record<string, unknown>
      for (const [k, v] of Object.entries(patch)) {
        if (k in target && v !== undefined) out[k] = v
      }
      return out as T
    }
    const layer = this.activeLayer()
    const obj = this.selectedObject()
    if (obj && layer) {
      this.cancelAction()
      this.commitText()
      const before = this.snap()
      const next = apply(obj)
      this.patchObject(
        layer.id,
        obj.id,
        next.type === "text" ? fitText(next) : normalizeShape(next)
      )
      this.vecCommit(before, `${obj.id}:${Object.keys(patch).join()}`)
    }
    const forText = obj ? obj.type === "text" : this.state.tool === "text"
    if (forText) this.setState({ textStyle: apply(this.state.textStyle) })
    else this.setState({ shapeStyle: apply(this.state.shapeStyle) })
  }

  /** Picks the shape the shape tool draws, and switches to that tool. */
  setShapeKind(shape: ShapeKind) {
    this.commitText()
    this.setState({
      tool: "shape",
      vecSel: null,
      shapeStyle: { ...this.state.shapeStyle, shape },
    })
    this.styleFromColor()
    this.requestRender()
    this.updateCursor()
  }

  /**
   * Chooses whether the colour panel drives the fill or the stroke, and
   * shows that paint's colour there.
   */
  setVecPaint(target: "fill" | "stroke") {
    const s = this.state
    const style =
      this.selectedObject() ?? (s.tool === "text" ? s.textStyle : s.shapeStyle)
    const hex = style[target]
    const hsv = hex ? hexToHsv(hex, s.color.h) : null
    this.setState(hsv ? { vecPaint: target, color: hsv } : { vecPaint: target })
  }

  /** Sends a colour picked in the colour panel to the selected object. */
  private colorToVector() {
    const { tool, vecPaint, shapeStyle } = this.state
    const obj = this.selectedObject()
    if (tool !== "shape" && tool !== "text" && !(tool === "move" && obj)) return
    const line = obj
      ? isLine(obj)
      : tool === "shape" &&
        (shapeStyle.shape === "line" || shapeStyle.shape === "arrow")
    this.setVectorProps({ [line ? "stroke" : vecPaint]: hsvToHex(this.state.color) })
  }

  private hitVector(
    tool: ToolId,
    x: number,
    y: number
  ): { layer: LayerMeta; obj: VectorObject } | null {
    const tol = 5 / this.view.scale
    const active = this.activeLayer()
    const find = (l: LayerMeta | undefined, textOnly: boolean) => {
      if (!l?.vector || !l.visible) return null
      for (let i = l.vector.length - 1; i >= 0; i--) {
        const obj = l.vector[i]
        if (textOnly && obj.type !== "text") continue
        if (hitObject(obj, x, y, tol)) return { layer: l, obj }
      }
      return null
    }
    if (tool === "move") return find(active, false)
    if (tool === "shape") {
      // The shape tool draws; it only grabs the object it just made.
      const sel = this.selectedObject()
      return sel && active && hitObject(sel, x, y, tol)
        ? { layer: active, obj: sel }
        : null
    }
    // The text tool reaches text on any layer, topmost first.
    const own = find(active, true)
    if (own) return own
    const { layers } = this.state
    for (let i = layers.length - 1; i >= 0; i--) {
      const hit = find(layers[i], true)
      if (hit) return hit
    }
    return null
  }

  private beginVector(
    tool: ToolId,
    pointerId: number,
    x: number,
    y: number,
    sx: number,
    sy: number,
    canDraw: boolean
  ) {
    const layer = this.activeLayer()
    const base = { kind: "vec" as const, pointerId, x0: x, y0: y, sx, sy, moved: false }

    const sel = this.selectedObject()
    if (sel && layer?.visible) {
      const handle = hitHandle(sel, x, y, this.view.scale)
      if (handle) {
        this.action = {
          ...base,
          mode: handle.kind === "rotate" ? "rotate" : "resize",
          handle,
          layerId: layer.id,
          objId: sel.id,
          orig: sel,
          before: this.snap(),
          edit: false,
        }
        return
      }
    }

    const hit = this.hitVector(tool, x, y)
    if (hit) {
      const { obj } = hit
      const now = performance.now()
      const again = this.lastVecDown.id === obj.id && now - this.lastVecDown.t < 400
      this.lastVecDown = { id: obj.id, t: now }
      const before = this.snap()
      if (obj.id !== this.state.vecSel || hit.layer.id !== this.state.activeLayerId) {
        this.setState({
          activeLayerId: hit.layer.id,
          editMask: false,
          vecSel: obj.id,
          vecPaint: obj.fill || !obj.stroke ? "fill" : "stroke",
        })
      }
      this.action = {
        ...base,
        mode: "move",
        layerId: hit.layer.id,
        objId: obj.id,
        orig: obj,
        before,
        edit: obj.type === "text" && (tool === "text" || again),
      }
      this.requestRender()
      return
    }

    if (tool === "move" || !canDraw) {
      if (this.state.vecSel) this.setState({ vecSel: null })
      this.requestRender()
      return
    }

    // Draw a new object, on a new vector layer if the active one isn't one.
    const before = this.snap()
    let layerId = layer?.id ?? ""
    if (!layer?.vector || !layer.visible) {
      const { docW, docH } = this.state
      const made: LayerMeta = {
        ...this.makeLayer(`Vector ${this.layerCounter + 1}`),
        vector: [],
      }
      this.canvases.set(made.id, makeCanvas(docW, docH))
      const next = this.place([made])
      this.setState({ layers: next, activeLayerId: made.id, editMask: false })
      layerId = made.id
    }
    const { shapeStyle, textStyle, vecPaint } = this.state
    const hex = hsvToHex(this.state.color)
    const style = tool === "text" ? textStyle : shapeStyle
    const paint = { fill: style.fill, stroke: style.stroke }
    if (paint[vecPaint] !== null) paint[vecPaint] = hex
    if (!paint.fill && !paint.stroke) paint.fill = hex
    if (tool === "shape" && (shapeStyle.shape === "line" || shapeStyle.shape === "arrow")) {
      paint.stroke = hex
    }
    const obj: VectorObject =
      tool === "text"
        ? makeText({ ...textStyle, ...paint }, x, y)
        : makeShape({ ...shapeStyle, ...paint }, x, y)
    this.rememberColor()
    const objs = this.state.layers.find((l) => l.id === layerId)?.vector ?? []
    this.setObjects(layerId, [...objs, obj], { vecSel: obj.id })
    this.action = {
      ...base,
      mode: "draw",
      layerId,
      objId: obj.id,
      orig: obj,
      before,
      edit: false,
    }
  }

  private dragVector(
    a: Extract<Action, { kind: "vec" }>,
    x: number,
    y: number,
    constrain: boolean
  ) {
    const o = a.orig
    const dx = x - a.x0
    const dy = y - a.y0
    let next: VectorObject = o
    if (a.mode === "draw") {
      if (isLine(o)) {
        next = dragHandle(
          { ...o, x: a.x0, y: a.y0, w: 0, h: 0 },
          { id: "end", hx: 1, hy: 1, x: 0, y: 0, kind: "resize" },
          x,
          y,
          constrain
        )
      } else {
        let w = Math.abs(dx)
        let h = Math.abs(dy)
        if (constrain) w = h = Math.max(w, h)
        const box = { x: dx < 0 ? a.x0 - w : a.x0, y: dy < 0 ? a.y0 - h : a.y0, w, h }
        next = o.type === "text" ? { ...o, ...box, wrap: true } : { ...o, ...box }
      }
    } else if (a.mode === "move") {
      let mx = dx
      let my = dy
      if (constrain) {
        if (Math.abs(mx) > Math.abs(my)) my = 0
        else mx = 0
      }
      next = { ...o, x: o.x + mx, y: o.y + my }
    } else if (a.mode === "resize" && a.handle) {
      next = dragHandle(o, a.handle, x, y, constrain)
    } else if (a.mode === "rotate") {
      let ang = Math.atan2(y - (o.y + o.h / 2), x - (o.x + o.w / 2)) + Math.PI / 2
      if (constrain) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      next = { ...o, rot: ang }
    }
    this.patchObject(a.layerId, a.objId, next)
  }

  private finishVector(a: Extract<Action, { kind: "vec" }>) {
    const obj = this.objectIn(a.layerId, a.objId)
    if (!obj) return
    if (a.mode === "draw") {
      if (obj.type === "text") {
        // A click makes text that grows as you type; a drag makes a box it wraps in.
        if (a.moved) {
          this.patchObject(
            a.layerId,
            a.objId,
            fitText({ ...obj, wrap: true, w: Math.max(obj.w, obj.size) })
          )
        }
        this.beginTextEdit(a.layerId, a.objId, a.before, null)
      } else if (!a.moved || Math.hypot(obj.w, obj.h) < 2) {
        this.restore(a.before)
        this.setState({ vecSel: null })
      } else {
        this.vecCommit(a.before)
      }
      return
    }
    if (a.moved) this.vecCommit(a.before)
    else if (a.edit && obj.type === "text") {
      this.beginTextEdit(a.layerId, a.objId, a.before, obj.text)
    }
  }

  // ---- live text -------------------------------------------------------------

  private beginTextEdit(
    layerId: string,
    objId: string,
    before: StructSnap,
    initial: string | null
  ) {
    this.textEdit = { layerId, objId, before, initial }
    this.setState({ activeLayerId: layerId, vecSel: objId, textEditing: true })
    this.syncVector()
    this.requestRender()
  }

  /** Starts typing into the selected text object. */
  editSelectedText(): boolean {
    const obj = this.selectedObject()
    if (!obj || obj.type !== "text" || this.textEdit || this.action) return false
    this.beginTextEdit(this.state.activeLayerId, obj.id, this.snap(), obj.text)
    return true
  }

  /** Called as the user types in the on-canvas editor. */
  setEditingText(text: string) {
    const te = this.textEdit
    if (!te) return
    const obj = this.objectIn(te.layerId, te.objId)
    if (!obj || obj.type !== "text") return
    this.patchObject(te.layerId, te.objId, fitText({ ...obj, text }))
  }

  /** Ends text editing, keeping what was typed. Empty text is removed. */
  commitText() {
    const te = this.textEdit
    if (!te) return
    this.textEdit = null
    this.setState({ textEditing: false })
    const obj = this.objectIn(te.layerId, te.objId)
    if (!obj || obj.type !== "text" || !obj.text.trim()) {
      if (te.initial === null) {
        // Nothing was typed into a new object: as if it never happened.
        this.restore(te.before)
      } else if (obj) {
        const objs = this.state.layers.find((l) => l.id === te.layerId)?.vector ?? []
        this.setObjects(
          te.layerId,
          objs.filter((o) => o.id !== te.objId),
          { vecSel: null }
        )
        this.vecCommit(te.before)
      }
    } else if (obj.text !== te.initial) {
      this.syncVector()
      this.vecCommit(te.before)
    }
    this.syncVector()
    this.requestRender()
  }

  /** The textarea laid over the canvas while text is being edited. */
  attachTextEditor(el: HTMLTextAreaElement | null) {
    this.textEl = el
    this.placeTextEditor()
  }

  /** Keeps the on-canvas editor exactly over the text it edits. */
  private placeTextEditor() {
    const el = this.textEl
    const te = this.textEdit
    if (!el || !te) return
    const o = this.objectIn(te.layerId, te.objId)
    if (!o || o.type !== "text") return
    const { tx, ty, scale, rot } = this.view
    const c = Math.cos(rot) * scale
    const s = Math.sin(rot) * scale
    // Text that grows as it is typed needs room for the caret past its end.
    const pad = o.wrap ? 0 : o.size
    const ax = o.align === "center" ? 0.5 : o.align === "right" ? 1 : 0
    el.style.width = `${o.w + pad}px`
    el.style.height = `${o.h + o.size * o.lineHeight}px`
    el.style.transform =
      `matrix(${c},${s},${-s},${c},${tx},${ty}) ` +
      `translate(${o.x + o.w / 2}px,${o.y + o.h / 2}px) rotate(${o.rot}rad) ` +
      `translate(${-o.w / 2 - pad * ax}px,${-o.h / 2}px)`
  }

  // ---- object commands -------------------------------------------------------

  /** Applies a change to the active layer's object list as one undo step. */
  private editObjects(
    fn: (objs: VectorObject[], obj: VectorObject) => VectorObject[] | null,
    sel?: (obj: VectorObject) => string | null,
    key?: (obj: VectorObject) => string
  ): boolean {
    const layer = this.activeLayer()
    const obj = this.selectedObject()
    if (!layer?.vector || !obj) return false
    this.cancelAction()
    this.commitText()
    const before = this.snap()
    const next = fn(layer.vector, obj)
    if (!next) return false
    this.setObjects(layer.id, next, sel ? { vecSel: sel(obj) } : undefined)
    this.vecCommit(before, key?.(obj))
    return true
  }

  deleteObject() {
    this.editObjects(
      (objs, obj) => objs.filter((o) => o !== obj),
      () => null
    )
  }

  duplicateObject() {
    const id = uid("obj")
    this.editObjects(
      (objs, obj) => {
        const next = objs.slice()
        next.splice(objs.indexOf(obj) + 1, 0, { ...obj, id, x: obj.x + 24, y: obj.y + 24 })
        return next
      },
      () => id
    )
  }

  /** Moves the selected object one step forward (1) or back (-1) in its layer. */
  orderObject(dir: 1 | -1) {
    this.editObjects((objs, obj) => {
      const i = objs.indexOf(obj)
      const to = i + dir
      if (to < 0 || to >= objs.length) return null
      const next = objs.slice()
      next.splice(i, 1)
      next.splice(to, 0, obj)
      return next
    })
  }

  nudgeObject(dx: number, dy: number): boolean {
    if (!isVectorTool(this.state.tool)) return false
    return this.editObjects(
      (objs, obj) =>
        objs.map((o) => (o === obj ? { ...o, x: o.x + dx, y: o.y + dy } : o)),
      undefined,
      (obj) => `${obj.id}:nudge`
    )
  }

  /**
   * Readies a layer for a pixel edit. An image layer is converted to pixels
   * on the spot; other vector layers refuse with `refusal`, and false is
   * returned.
   */
  private pixelLayer(layer: LayerMeta, refusal: string): boolean {
    if (!layer.vector) return true
    if (!layer.vector.some(isImageObject)) {
      this.notify(refusal)
      return false
    }
    this.rasterizeLayer(layer.id)
    this.notify("Image converted to a raster layer")
    return true
  }

  /**
   * Places an image on its own layer as a rectangle with an image fill, so it
   * can still be moved, resized and rotated. Centred on `at`, or the canvas.
   */
  async importImage(file: Blob, name: string, at?: { x: number; y: number }): Promise<boolean> {
    let image: ImageBitmap
    try {
      image = await createImageBitmap(file)
    } catch {
      this.notify("That file couldn't be opened as an image")
      return false
    }
    const assetId = uid("img")
    setImageAsset(assetId, image)
    this.imageBlobs.set(assetId, file)
    this.structural(() => {
      const { docW, docH } = this.state
      const k = Math.min(1, docW / image.width, docH / image.height)
      const w = Math.round(image.width * k)
      const h = Math.round(image.height * k)
      const obj: VectorObject = {
        ...DEFAULT_SHAPE_STYLE,
        shape: "rect",
        fill: null,
        stroke: null,
        image: assetId,
        id: uid("obj"),
        type: "shape",
        x: Math.round((at?.x ?? docW / 2) - w / 2),
        y: Math.round((at?.y ?? docH / 2) - h / 2),
        w,
        h,
        rot: 0,
      }
      const layer: LayerMeta = { ...this.makeLayer(name || "Image"), vector: [obj] }
      this.canvases.set(layer.id, makeCanvas(docW, docH))
      const next = this.place([layer])
      this.setState({ layers: next, activeLayerId: layer.id, editMask: false, vecSel: obj.id })
    })
    // The move tool shows the new image's handles straight away.
    this.setTool("move")
    return true
  }

  /** Turns a vector layer into ordinary pixels; its objects stop being editable. */
  rasterizeLayer(id: string) {
    const meta = this.state.layers.find((l) => l.id === id)
    const src = this.canvases.get(id)
    if (!meta?.vector || !src) return
    this.structural(() => {
      this.canvases.set(id, cloneCanvas(src))
      this.setState({
        layers: this.state.layers.map((l) =>
          l.id === id ? { ...l, vector: undefined, rev: nextRev() } : l
        ),
        vecSel: null,
      })
    })
  }

  /** The outline and handles of the selected object. */
  private drawVecOverlay(ctx: CanvasRenderingContext2D) {
    const o = this.selectedObject()
    if (!o || !isVectorTool(this.state.tool)) return
    const scale = this.view.scale
    const px = 1 / scale
    const a = this.action
    ctx.save()
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2)
    ctx.rotate(o.rot)
    ctx.setLineDash([])
    ctx.lineWidth = 1.5 * px
    ctx.strokeStyle = "#2f8cff"
    ctx.fillStyle = "#fff"
    ctx.beginPath()
    if (isLine(o)) {
      ctx.moveTo(-o.w / 2, -o.h / 2)
      ctx.lineTo(o.w / 2, o.h / 2)
    } else {
      ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h)
    }
    ctx.stroke()
    if (!this.textEdit && !(a?.kind === "vec" && a.mode === "draw")) {
      for (const h of handlesOf(o, scale)) {
        ctx.beginPath()
        if (h.kind === "rotate") {
          ctx.moveTo(0, -o.h / 2)
          ctx.lineTo(h.x, h.y)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(h.x, h.y, 5 * px, 0, Math.PI * 2)
        } else {
          ctx.rect(h.x - 4 * px, h.y - 4 * px, 8 * px, 8 * px)
        }
        ctx.fill()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // ---- distort -------------------------------------------------------------

  /**
   * Starts a distortion of the active layer in the current mode. Nothing
   * changes until the mesh is moved; `quiet` suppresses the explanation when
   * the layer can't be distorted.
   */
  private beginDistort(quiet = false) {
    this.distort = null
    const layer = this.activeLayer()
    const fail = (text: string) => {
      this.setState({ distortActive: false, distortDirty: false })
      if (!quiet && text) this.notify(text)
      this.updateCursor()
      this.requestRender()
    }
    if (!layer) return fail("")
    if (noPixels(layer)) return fail("That layer holds no pixels to distort")
    if (layer.vector && !layer.vector.some(isImageObject)) {
      return fail("Rasterise this vector layer to distort it")
    }
    if (layer.vector) {
      // Distorting works on pixels, so an image stops being an object here.
      this.rasterizeLayer(layer.id)
      this.notify("Image converted to a raster layer")
      return
    }
    this.distortGL ??= DistortRenderer.create()
    const { docW, docH, distortMode, warpGrid } = this.state
    if (!this.distortGL || !this.distortGL.fits(docW, docH)) {
      return fail("Distortion isn't available: WebGL2 can't handle this canvas")
    }
    const box = this.selection ? alphaBounds(this.selection) : null
    const src = this.canvases.get(layer.id)
    const mask = this.masks.get(layer.id) ?? null
    let session: DistortSession
    let sel: DistortSelection | null = null
    if (box && src && this.selection) {
      const selection = this.selection
      const part = (c: HTMLCanvasElement, op: GlobalCompositeOperation) => {
        const out = cloneCanvas(c)
        const cx = ctxOf(out)
        cx.globalCompositeOperation = op
        cx.drawImage(selection, 0, 0)
        cx.globalCompositeOperation = "source-over"
        return out
      }
      const liquify = distortMode === "liquify"
      sel = {
        cut: part(src, "destination-in"),
        rest: part(src, "destination-out"),
        maskCut: mask && part(mask, "destination-in"),
        maskRest: mask && part(mask, "destination-out"),
        clip: liquify ? selection : null,
      }
      if (liquify) {
        session = makeSession(distortMode, docW, docH, warpGrid)
      } else {
        // The handles frame the selection rather than the whole canvas.
        session = makeSession(distortMode, box.w, box.h, warpGrid)
        offsetSession(session, box.x, box.y)
      }
    } else {
      session = makeSession(distortMode, docW, docH, warpGrid)
    }
    this.distort = {
      ...session,
      layerId: layer.id,
      out: null,
      outMask: null,
      uploaded: false,
      sel,
    }
    this.setState({ distortActive: true, distortDirty: false })
    this.updateCursor()
    this.requestRender()
  }

  /** Redraws the distorted layer (and its mask) after the mesh has moved. */
  private distortChanged() {
    const d = this.distort
    const gl = this.distortGL
    const src = d && this.canvases.get(d.layerId)
    if (!d || !gl || !src) return
    const { docW, docH } = this.state
    const mask = this.masks.get(d.layerId)
    const sel = d.sel
    // Liquify reads the whole layer; warp and perspective only the lifted part.
    const lifted = sel && !sel.clip
    if (!d.uploaded) {
      gl.setSource(0, lifted ? sel.cut : src)
      if (mask) gl.setSource(1, lifted ? (sel.maskCut ?? mask) : mask)
      d.uploaded = true
    }
    const draw = (slot: 0 | 1, out: HTMLCanvasElement | null, rest: HTMLCanvasElement | null) => {
      const c = out ?? makeCanvas(docW, docH)
      const ctx = ctxOf(c)
      ctx.globalCompositeOperation = "copy"
      ctx.drawImage(gl.render(slot, d.mesh, docW, docH), 0, 0)
      if (sel?.clip) {
        ctx.globalCompositeOperation = "destination-in"
        ctx.drawImage(sel.clip, 0, 0)
      }
      if (rest) {
        // Everything outside the selection stays where it was.
        ctx.globalCompositeOperation = "destination-over"
        ctx.drawImage(rest, 0, 0)
      }
      ctx.globalCompositeOperation = "source-over"
      return c
    }
    d.out = draw(0, d.out, sel?.rest ?? null)
    if (mask) d.outMask = draw(1, d.outMask, sel?.maskRest ?? null)
    if (!this.state.distortDirty) this.setState({ distortDirty: true })
    this.requestRender()
  }

  /** Makes the distortion in progress permanent, as one undo step. */
  applyDistort() {
    const d = this.distort
    if (!d) return
    this.distort = null
    const dirty = this.state.distortDirty && !!d.out
    this.setState({ distortDirty: false })
    if (!dirty) {
      if (this.state.tool === "distort") this.beginDistort(true)
      return
    }
    // structural() starts a fresh session afterwards while the tool is active.
    this.structural(() => {
      this.canvases.set(d.layerId, d.out!)
      this.bumpRev(d.layerId)
      if (d.outMask && this.masks.has(d.layerId)) {
        this.masks.set(d.layerId, d.outMask)
        this.bumpRev(d.layerId, "mask")
      }
    })
  }

  /** Throws away the distortion in progress. */
  resetDistort() {
    if (this.action?.kind === "distort" || this.action?.kind === "liquify") {
      this.action = null
    }
    if (this.state.tool === "distort") this.beginDistort(true)
  }

  setDistortOptions(
    patch: Partial<
      Pick<
        EngineState,
        "distortMode" | "warpGrid" | "liqTool" | "liqSize" | "liqStrength" | "distortGrid"
      >
    >
  ) {
    const next = { ...patch }
    if (next.liqSize !== undefined) next.liqSize = clamp(Math.round(next.liqSize), 10, 2000)
    if (next.liqStrength !== undefined) next.liqStrength = clamp(next.liqStrength, 0.05, 1)
    if (next.warpGrid !== undefined) next.warpGrid = clamp(Math.round(next.warpGrid), 1, 6)
    const s = this.state
    const rebuild =
      (next.distortMode !== undefined && next.distortMode !== s.distortMode) ||
      (next.warpGrid !== undefined && next.warpGrid !== s.warpGrid)
    // A different mesh can't carry the old one's edits, so those are applied first.
    if (rebuild) this.applyDistort()
    this.setState(next)
    if (rebuild && this.state.tool === "distort") this.beginDistort(true)
    this.updateCursor()
    this.requestRender()
  }

  private beginDistortDrag(pointerId: number, x: number, y: number) {
    if (!this.distort) this.beginDistort()
    const d = this.distort
    if (!d) return
    if (!this.activeLayer()?.visible) {
      this.notify("The active layer is hidden")
      return
    }
    if (d.mode === "liquify") {
      this.action = { kind: "liquify", pointerId, lx: x, ly: y }
      this.liquifyAt(x, y, 0, 0)
      return
    }
    // Dragging anywhere pulls the nearest control point along.
    const idx = nearestControl(d, x, y)
    if (idx < 0 || !d.ctrl) return
    this.action = {
      kind: "distort",
      pointerId,
      idx,
      ox: d.ctrl[idx * 2] - x,
      oy: d.ctrl[idx * 2 + 1] - y,
    }
  }

  /** One touch of the liquify brush; returns whether the mesh moved. */
  private liquifyAt(x: number, y: number, dx: number, dy: number, redraw = true) {
    const d = this.distort
    if (!d || d.mode !== "liquify") return false
    const { liqTool, liqSize, liqStrength } = this.state
    if (liqTool === "push" && dx === 0 && dy === 0) return false
    const moved = liquifyDab(d.mesh, liqTool, x, y, dx, dy, liqSize / 2, liqStrength)
    if (moved && redraw) this.distortChanged()
    return moved
  }

  /** The mesh as a grid, with handles on its control points. */
  private drawDistortOverlay(ctx: CanvasRenderingContext2D) {
    const d = this.distort
    if (!d || this.state.tool !== "distort") return
    const px = 1 / this.view.scale
    const { cols, rows, pos } = d.mesh
    const stride = cols + 1
    ctx.save()
    ctx.setLineDash([])
    ctx.lineJoin = "round"
    if (this.state.distortGrid) {
      ctx.beginPath()
      for (let j = 0; j <= rows; j += d.step) {
        for (let i = 0; i <= cols; i++) {
          const k = (j * stride + i) * 2
          if (i === 0) ctx.moveTo(pos[k], pos[k + 1])
          else ctx.lineTo(pos[k], pos[k + 1])
        }
      }
      for (let i = 0; i <= cols; i += d.step) {
        for (let j = 0; j <= rows; j++) {
          const k = (j * stride + i) * 2
          if (j === 0) ctx.moveTo(pos[k], pos[k + 1])
          else ctx.lineTo(pos[k], pos[k + 1])
        }
      }
      ctx.lineWidth = 2.5 * px
      ctx.strokeStyle = "rgba(0,0,0,0.22)"
      ctx.stroke()
      ctx.lineWidth = px
      ctx.strokeStyle = "rgba(90,170,255,0.9)"
      ctx.stroke()
    }
    if (d.ctrl) {
      const a = this.action
      const held = a?.kind === "distort" ? a.idx : -1
      ctx.lineWidth = 1.5 * px
      ctx.strokeStyle = "#2f8cff"
      for (let i = 0; i < d.ctrl.length; i += 2) {
        ctx.beginPath()
        ctx.arc(d.ctrl[i], d.ctrl[i + 1], (i / 2 === held ? 6.5 : 5) * px, 0, Math.PI * 2)
        ctx.fillStyle = i / 2 === held ? "#2f8cff" : "#fff"
        ctx.fill()
        ctx.stroke()
      }
    }
    ctx.restore()
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
    if (k === "marquee" || k === "lasso" || k === "selbrush" || k === "vec" || k === "gradient") {
      this.cancelAction()
      return true
    }
    if (this.selectedObject()) {
      this.setState({ vecSel: null })
      this.requestRender()
      return true
    }
    if (this.state.tool === "distort" && this.state.distortDirty) {
      this.resetDistort()
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
    } else if (this.selectedObject() && isVectorTool(this.state.tool)) {
      this.deleteObject()
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

  // ---- gradient ------------------------------------------------------------

  private beginGradient(pointerId: number, x: number, y: number) {
    const layer = this.activeLayer()
    if (!layer) return
    if (!layer.visible) {
      this.notify("The active layer is hidden")
      return
    }
    const target: Target = this.state.editMask && layer.mask ? "mask" : "pixels"
    if (target === "pixels") {
      if (noPixels(layer)) {
        this.notify("Select a paint layer — that layer holds no pixels")
        return
      }
      if (!this.pixelLayer(layer, "Rasterise this vector layer to fill it")) return
    }
    this.action = { kind: "gradient", pointerId, layerId: layer.id, target, x0: x, y0: y, x1: x, y1: y }
  }

  /**
   * `base` with the gradient laid over it, into `out`: from the current
   * colour at the start point to the previous colour (or nothing) at the end.
   * It stays inside the selection, and only on existing pixels with alpha lock.
   */
  private gradientOver(
    base: HTMLCanvasElement,
    a: Extract<Action, { kind: "gradient" }>,
    alphaLock: boolean,
    out: HTMLCanvasElement
  ): HTMLCanvasElement {
    const { docW: w, docH: h, color, prevColor, gradientEnd, fillMode } = this.state
    const from = hsvToHex(color)
    const to = gradientEnd === "transparent" ? null : hsvToHex(prevColor)
    const rgb = hexToRgb(from) ?? [0, 0, 0]
    const g = this.scratch("gradient")
    const G = ctxOf(g)
    G.globalAlpha = 1
    G.globalCompositeOperation = "copy"
    const len = Math.max(1, Math.hypot(a.x1 - a.x0, a.y1 - a.y0))
    const grad =
      fillMode === "radial"
        ? G.createRadialGradient(a.x0, a.y0, 0, a.x0, a.y0, len)
        : G.createLinearGradient(a.x0, a.y0, a.x1 === a.x0 && a.y1 === a.y0 ? a.x0 + 1 : a.x1, a.y1)
    grad.addColorStop(0, from)
    // Fading to transparent keeps the hue rather than going through black.
    grad.addColorStop(1, to ?? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
    G.fillStyle = grad
    G.fillRect(0, 0, w, h)
    G.globalCompositeOperation = "source-over"

    const O = ctxOf(out)
    O.globalAlpha = 1
    O.globalCompositeOperation = "copy"
    O.drawImage(base, 0, 0)
    O.globalCompositeOperation = alphaLock ? "source-atop" : "source-over"
    O.drawImage(g, 0, 0)
    O.globalCompositeOperation = "source-over"
    const sel = this.selection
    return sel ? maskedBlend(this.scratch("gradSel"), this.scratch("gradTmp"), base, out, sel) : out
  }

  private commitGradient(a: Extract<Action, { kind: "gradient" }>) {
    // A click without a drag draws nothing.
    if (Math.hypot(a.x1 - a.x0, a.y1 - a.y0) * this.view.scale < 4) {
      this.requestRender()
      return
    }
    const layer = this.layerById(a.layerId)
    if (!layer) return
    const lock = a.target === "pixels" && layer.alphaLock
    this.rememberColor()
    this.replaceCanvas(
      a.layerId,
      (src) => cloneCanvas(this.gradientOver(src, a, lock, makeCanvas(src.width, src.height))),
      a.target
    )
  }

  /** The line being dragged out, with its two ends. */
  private drawGradientOverlay(ctx: CanvasRenderingContext2D) {
    const a = this.action
    if (a?.kind !== "gradient") return
    const px = 1 / this.view.scale
    ctx.save()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(a.x0, a.y0)
    ctx.lineTo(a.x1, a.y1)
    ctx.lineWidth = 3 * px
    ctx.strokeStyle = "rgba(0,0,0,0.35)"
    ctx.stroke()
    ctx.lineWidth = 1.5 * px
    ctx.strokeStyle = "#ffffff"
    ctx.stroke()
    for (const [x, y] of [
      [a.x0, a.y0],
      [a.x1, a.y1],
    ]) {
      ctx.beginPath()
      ctx.arc(x, y, 5 * px, 0, Math.PI * 2)
      ctx.fillStyle = "#ffffff"
      ctx.fill()
      ctx.lineWidth = 1.5 * px
      ctx.strokeStyle = "#2f8cff"
      ctx.stroke()
    }
    ctx.restore()
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
    if (noPixels(layer)) {
      this.notify("Select a paint layer — that layer holds no pixels")
      return
    }
    if (!this.pixelLayer(layer, "Rasterise this vector layer to fill it")) return
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
    this.commitText()
    this.applyDistort()
    const out = this.flatten()
    return new Promise((resolve) => out.toBlob(resolve, "image/png"))
  }

  /** The whole picture as it appears, at full size. */
  private flatten(): HTMLCanvasElement {
    const { docW, docH, background, showBackground } = this.state
    const out = makeCanvas(docW, docH)
    const ctx = ctxOf(out)
    if (showBackground) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, docW, docH)
    }
    if (this.fxActive()) ctx.drawImage(this.compose(), 0, 0)
    else this.drawLayers(ctx)
    return out
  }

  /** A small preview of the picture for the gallery. */
  private thumbnail(): Promise<Blob | null> {
    const { docW, docH } = this.state
    const k = Math.min(1, 640 / Math.max(docW, docH))
    const out = makeCanvas(Math.max(1, Math.round(docW * k)), Math.max(1, Math.round(docH * k)))
    const ctx = ctxOf(out)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(this.flatten(), 0, 0, out.width, out.height)
    return new Promise((resolve) => out.toBlob(resolve, "image/png"))
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      this.saving = this.saving.then(() => this.save())
    }, 1500)
  }

  private async save() {
    if (this.action || this.settling || this.textEdit) {
      this.scheduleSave()
      return
    }
    const s = this.state
    const id = s.projectId
    if (!id) return
    const blobs: Record<string, Blob> = {}
    for (const meta of s.layers) {
      if (noPixels(meta) || meta.vector) continue
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
    for (const meta of s.layers) {
      for (const o of meta.vector ?? []) {
        const blob = o.type === "shape" && o.image ? this.imageBlobs.get(o.image) : undefined
        if (blob && o.type === "shape") blobs[`img:${o.image}`] = blob
      }
    }
    try {
      const thumb = await this.thumbnail()
      await saveProject(
        id,
        {
          version: 1,
          width: s.docW,
          height: s.docH,
          background: s.background,
          showBackground: s.showBackground,
          layers: s.layers,
          activeLayerId: s.activeLayerId,
          blobs,
        },
        thumb
      )
    } catch {
      // storage may be unavailable (private mode, quota) — painting still works
    }
  }
}

export const engine = new PaintEngine()
