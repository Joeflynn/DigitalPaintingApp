/// <reference types="@webgpu/types" />
import {
  MASK_BLENDS,
  PAINT_BLENDS,
  STROKE_EFFECTS,
  STROKE_TEXTURE_KINDS,
  TEXTURE_KINDS,
  TIP_SHAPES,
  effectScale,
  type BrushPreset,
} from "./brushes"
import type { Dab } from "./stroke"
import common from "./gpu/common.wgsl?raw"
import depositSrc from "./gpu/deposit.wgsl?raw"
import flowSrc from "./gpu/flow.wgsl?raw"
import reservoirSrc from "./gpu/reservoir.wgsl?raw"
import resolveSrc from "./gpu/resolve.wgsl?raw"

export class GPUSizeError extends Error {}

export interface StrokeSetup {
  width: number
  height: number
  /** The layer being painted on; omitted for a blank surface. */
  source?: HTMLCanvasElement | null
  brush: BrushPreset
  /** Straight RGB, 0–1 */
  color: [number, number, number]
  /** Secondary colour that stamps may mix towards; defaults to `color` */
  color2?: [number, number, number]
  /** Nominal brush diameter in document pixels */
  size: number
  opacity: number
  seed: number
  mode: "paint" | "erase" | "smudge"
  alphaLock?: boolean
}

const FLOAT = "rgba16float" as const
const DAB_FLOATS = 16
const CAPACITY = 8192
const RESERVOIR = 32
const PARAM_FLOATS = 68
/** Side of a raster stamp or texture once it is on the GPU. */
const IMAGE_SIZE = 256
/** Shader code for "this layer is a raster image". */
const RASTER = 100

/** Index of a procedural kind as the shaders number it, or the raster code. */
function kindOf<T extends string>(list: readonly T[], kind: T | "none" | "image"): number {
  if (kind === "image") return RASTER
  return list.indexOf(kind as T)
}

/** True if this brush needs the tip reservoir: it picks up or meters paint. */
function usesReservoir(brush: BrushPreset): boolean {
  return (
    brush.pickup > 0 ||
    (brush.links ?? []).some((l) => l.target === "load" && l.amount !== 0)
  )
}

/** The raster images a brush actually samples. */
function imagesOf(brush: BrushPreset): string[] {
  const out: string[] = []
  if (brush.tip === "image" && brush.tipImage) out.push(brush.tipImage)
  if (brush.dual === "image" && brush.dualImage) out.push(brush.dualImage)
  if (brush.texture === "image" && brush.textureImage) out.push(brush.textureImage)
  if (brush.strokeTex === "image" && brush.strokeImage) out.push(brush.strokeImage)
  return out
}

const LERP: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
}

/**
 * WebGPU brush renderer. A stroke lives in two float buffers (colour and
 * material) that sit over a snapshot of the layer; `frame()` deposits new
 * dabs, advances the wet-paint simulation and resolves the lit result into
 * `canvas`, which always shows the whole layer as it would look if committed.
 */
export class GPUBrush {
  readonly canvas = document.createElement("canvas")

  readonly device: GPUDevice
  private context: GPUCanvasContext
  private deposit: GPURenderPipeline
  private reservoir: GPURenderPipeline
  private flow: GPURenderPipeline
  private resolve: GPURenderPipeline
  private sampler: GPUSampler
  private repeat: GPUSampler
  private white: GPUTexture
  /** Raster stamps and textures by data URL. */
  private images = new Map<string, GPUTexture>()
  private loading = new Map<string, Promise<void>>()
  /** Tip, dual stamp, canvas texture and stroke texture for this stroke. */
  private layers: GPUTexture[] = []
  private uniform: GPUBuffer
  private storage: GPUBuffer
  private params = new Float32Array(PARAM_FLOATS)

  private width = 0
  private height = 0
  private base: GPUTexture | null = null
  /** Two [colour, material] pairs; the simulation ping-pongs between them. */
  private pairs: [GPUTexture, GPUTexture][] = []
  private cur = 0
  private res: GPUTexture[]
  private resCur = 0

  private setup: StrokeSetup | null = null
  private pending: number[] = []
  private pendingLoad = 0
  private reservoirOn = false
  private bounds: { x0: number; y0: number; x1: number; y1: number } | null = null
  private spread = 0
  private lastDistance = 0
  private firstDeposit = true
  private heading = { x: 0, y: 0, dx: 0, dy: 0, distance: -1 }
  private batchHeading = [0, 0]

  private constructor(device: GPUDevice) {
    this.device = device
    this.context = this.canvas.getContext("webgpu")!
    const format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device, format, alphaMode: "premultiplied" })

    const build = (
      src: string,
      targets: GPUColorTargetState[]
    ): GPURenderPipeline => {
      const module = device.createShaderModule({ code: `${common}\n${src}` })
      return device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets },
        primitive: { topology: "triangle-list" },
      })
    }
    this.deposit = build(depositSrc, [
      { format: FLOAT, blend: LERP },
      { format: FLOAT, blend: LERP },
    ])
    this.reservoir = build(reservoirSrc, [{ format: FLOAT }])
    this.flow = build(flowSrc, [{ format: FLOAT }, { format: FLOAT }])
    this.resolve = build(resolveSrc, [{ format }])

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    })
    this.repeat = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    })
    this.white = device.createTexture({
      size: [1, 1],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: this.white }, new Uint8Array([255]), {}, [1, 1])
    this.uniform = device.createBuffer({
      size: PARAM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.storage = device.createBuffer({
      size: CAPACITY * DAB_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.res = [0, 1].map(() =>
      device.createTexture({
        size: [RESERVOIR, RESERVOIR],
        format: FLOAT,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    )
  }

  static async create(onLost: () => void): Promise<GPUBrush> {
    const adapter = await navigator.gpu?.requestAdapter({
      powerPreference: "high-performance",
    })
    if (!adapter) throw new Error("WebGPU is unavailable")
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    })
    device.pushErrorScope("validation")
    const renderer = new GPUBrush(device)
    const error = await device.popErrorScope()
    if (error) {
      device.destroy()
      throw new Error(error.message)
    }
    device.addEventListener("uncapturederror", (e) =>
      console.error("WebGPU:", e.error.message)
    )
    void device.lost.then(onLost)
    return renderer
  }

  /**
   * Loads the raster stamps and textures a brush uses. A stroke begun before
   * they arrive paints as if they were blank, so call this when a brush is
   * picked or edited.
   */
  preload(brush: BrushPreset): Promise<void> {
    return Promise.all(imagesOf(brush).map((url) => this.load(url))).then(
      () => undefined
    )
  }

  private load(url: string): Promise<void> {
    if (this.images.has(url)) return Promise.resolve()
    let job = this.loading.get(url)
    if (!job) {
      job = this.decode(url)
        .catch((error) => console.error("Brush image failed to load", error))
        .finally(() => this.loading.delete(url))
      this.loading.set(url, job)
    }
    return job
  }

  /** Decodes an image into a single-channel texture with a full mip chain. */
  private async decode(url: string) {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const levels = Math.log2(IMAGE_SIZE) + 1
    const texture = this.device.createTexture({
      size: [IMAGE_SIZE, IMAGE_SIZE],
      format: "r8unorm",
      mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!
    for (let level = 0; level < levels; level++) {
      const side = IMAGE_SIZE >> level
      canvas.width = side
      canvas.height = side
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, side, side)
      const rgba = ctx.getImageData(0, 0, side, side).data
      const grey = new Uint8Array(side * side)
      for (let i = 0; i < grey.length; i++) grey[i] = rgba[i * 4]
      this.device.queue.writeTexture(
        { texture, mipLevel: level },
        grey,
        { bytesPerRow: side },
        [side, side]
      )
    }
    bitmap.close()
    // Keep the cache small: brushes come and go while they are being edited.
    if (this.images.size >= 24) {
      const oldest = this.images.keys().next().value as string
      if (!this.layers.includes(this.images.get(oldest)!)) {
        this.images.get(oldest)!.destroy()
      }
      this.images.delete(oldest)
    }
    this.images.set(url, texture)
  }

  private image(kind: string, url: string): GPUTexture {
    if (kind !== "image" || !url) return this.white
    const texture = this.images.get(url)
    if (!texture) void this.load(url)
    return texture ?? this.white
  }

  /** True while the current stroke has wet paint that should keep moving. */
  get wet(): boolean {
    const s = this.setup
    return !!s && s.mode === "paint" && (s.brush.wetness > 0 || s.brush.drip > 0)
  }

  /** How many frames wet paint keeps flowing after the pen lifts. */
  get settleFrames(): number {
    const s = this.setup
    if (!s || !this.wet) return 0
    if (s.brush.drip > 0) return Math.round(30 + 60 * s.brush.drip)
    return Math.round(30 * Math.pow(2.5, (s.brush.dryTime - 0.5) * 2))
  }

  /** How far the simulation may have carried paint beyond the dabs, in px. */
  get margin(): number {
    // A stroke effect may draw up to twice its scale away from the dabs.
    return Math.ceil(this.spread + this.params[66] * 2) + 2
  }

  private target(): GPUTexture {
    return this.device.createTexture({
      size: [this.width, this.height],
      format: FLOAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  }

  private allocate(width: number, height: number) {
    const max = this.device.limits.maxTextureDimension2D
    if (width > max || height > max) {
      throw new GPUSizeError(
        `Canvas ${width} × ${height} exceeds this GPU's texture limit of ${max}px per side.`
      )
    }
    if (this.base && this.width === width && this.height === height) return
    this.base?.destroy()
    for (const pair of this.pairs) for (const t of pair) t.destroy()
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.base = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.pairs = [
      [this.target(), this.target()],
      [this.target(), this.target()],
    ]
  }

  begin(setup: StrokeSetup) {
    this.allocate(setup.width, setup.height)
    this.setup = setup
    this.pending = []
    this.bounds = null
    this.spread = 0
    this.lastDistance = 0
    this.firstDeposit = true
    this.heading = { x: 0, y: 0, dx: 0, dy: 0, distance: -1 }
    this.batchHeading = [0, 0]
    this.cur = 0
    this.resCur = 0

    const { brush, mode } = setup
    const paint = mode === "paint"
    const smudge = mode === "smudge"
    this.pendingLoad = 0
    this.reservoirOn = smudge || (paint && usesReservoir(brush))
    this.layers = [
      this.image(brush.tip, brush.tipImage),
      this.image(brush.dual, brush.dualImage),
      this.image(brush.texture, brush.textureImage),
      this.image(brush.strokeTex, brush.strokeImage),
    ]
    const tipKind = kindOf(TIP_SHAPES, brush.tip)
    const p = this.params
    p.fill(0)
    p.set([setup.width, setup.height, setup.size, setup.seed], 0)
    p.set(paint ? [...setup.color, 1] : [0, 0, 0, 0], 4)
    p.set([...(setup.color2 ?? setup.color), 1], 8)
    p.set([Math.max(0, tipKind), brush.hardness, brush.bristles, 0], 12)
    p.set(
      [
        paint ? brush.wetness : 0,
        smudge ? 1 : paint ? brush.pickup : 0,
        paint ? brush.relief : 0,
        // A dry brush runs out of grip along the stroke just as a loaded one
        // runs out of paint; an eraser never does.
        mode === "erase" ? 0 : brush.depletion,
      ],
      16
    )
    p.set(
      [
        paint ? brush.drip : 0,
        setup.opacity,
        (mode === "erase" ? 1 : 0) |
          (setup.alphaLock ? 2 : 0) |
          (this.reservoirOn ? 4 : 0),
        paint ? PAINT_BLENDS.indexOf(brush.paintBlend) : 0,
      ],
      20
    )
    p[31] = brush.roundness
    if (this.wet) {
      // Sliders sit at 0.5 by default, so each is doubled to a 0–2 multiplier.
      const dry = 0.06 * Math.pow(4, 0.5 - brush.dryTime)
      p.set(
        [
          brush.wetness * 0.24 * brush.bleed,
          // Running paint stays wet for long enough that pooling would
          // etch an outline into it, so it gets very little.
          brush.wetness * 0.16 * brush.edgeDarken * (brush.drip > 0 ? 0.25 : 1),
          brush.drip * 1.5,
          brush.drip > 0 ? 0.985 : 1 - dry,
        ],
        32
      )
    }
    p.set(
      [
        paint ? brush.granulation : 0,
        paint ? brush.feather : 0,
        paint ? brush.pigmentVariation : 0,
        brush.gloss,
      ],
      36
    )
    // Roughly how many dabs land on one pixel, for a tip crossing its width.
    p[64] = Math.min(40, Math.max(1, 0.8 / Math.max(0.01, brush.spacing)))
    p[65] = Math.max(0, STROKE_EFFECTS.indexOf(brush.effect))
    p[66] = effectScale(brush, setup.size)
    // Every mode marks the canvas with the whole brush: stamp, dual stamp,
    // stroke pattern and canvas texture. Painting lays pigment through that
    // mark, erasing lifts it and smudging drags what is already there.
    const on = (depth: number) => depth > 0
    p.set(
      [
        on(brush.dualDepth) && brush.dual !== "none"
          ? kindOf(TIP_SHAPES, brush.dual)
          : -1,
        brush.dualScale,
        MASK_BLENDS.indexOf(brush.dualBlend),
        brush.dualDepth,
        brush.dualRotate,
        brush.dualOffset,
        0,
        0,
      ],
      40
    )
    p.set(
      [
        on(brush.grain) && brush.texture !== "none"
          ? kindOf(TEXTURE_KINDS, brush.texture)
          : -1,
        brush.grainScale,
        MASK_BLENDS.indexOf(brush.textureBlend),
        brush.grain,
        brush.textureInvert ? 1 : 0,
        0,
        0,
        0,
      ],
      48
    )
    p.set(
      [
        on(brush.strokeDepth) && brush.strokeTex !== "none"
          ? kindOf(STROKE_TEXTURE_KINDS, brush.strokeTex)
          : -1,
        brush.strokeScale,
        MASK_BLENDS.indexOf(brush.strokeBlend),
        brush.strokeDepth,
        brush.strokeInvert ? 1 : 0,
        0,
        0,
        0,
      ],
      56
    )
    this.device.queue.writeBuffer(this.uniform, 0, p)

    // Start from empty stroke buffers, a reservoir full of fresh paint and a
    // snapshot of the layer.
    const encoder = this.device.createCommandEncoder()
    const clear = (textures: GPUTexture[], value: GPUColor = [0, 0, 0, 0]) =>
      encoder
        .beginRenderPass({
          colorAttachments: textures.map((t) => ({
            view: t.createView(),
            loadOp: "clear" as const,
            storeOp: "store" as const,
            clearValue: value,
          })),
        })
        .end()
    for (const pair of this.pairs) clear(pair)
    for (const r of this.res) clear([r], [p[4], p[5], p[6], p[7]])
    clear([this.base!])
    this.device.queue.submit([encoder.finish()])

    if (setup.source) {
      // A canvas has no backing image until a context has been requested.
      setup.source.getContext("2d")
      this.device.queue.copyExternalImageToTexture(
        { source: setup.source },
        { texture: this.base!, premultipliedAlpha: true },
        [setup.width, setup.height]
      )
    }
  }

  dab(d: Dab) {
    if (!this.setup) return
    const { x, y, size, distance } = d
    // Brushes that pick up colour refresh their reservoir every fraction of a
    // brush width, so mixing does not depend on how fast the frames arrive.
    if (
      this.reservoirOn &&
      this.pending.length > 0 &&
      distance - this.lastDistance > this.setup.size * 0.06
    ) {
      this.depositPending()
    }
    // Track the heading from primary dabs only: a mirrored dab repeats the
    // distance of the one before it.
    if (this.heading.distance !== distance) {
      const h = this.heading
      const dx = x - h.x
      const dy = y - h.y
      const len = Math.hypot(dx, dy)
      if (h.distance >= 0 && len > 0.01) {
        h.dx = dx / len
        h.dy = dy / len
      }
      h.x = x
      h.y = y
      h.distance = distance
    }
    if (this.pending.length === 0) {
      this.batchHeading = [this.heading.dx, this.heading.dy]
    }
    // Colour shifts belong to paint; erasing and smudging ignore them.
    const paint = this.setup.mode === "paint"
    this.pending.push(
      x,
      y,
      size,
      d.angle,
      d.flow,
      d.pressure,
      distance,
      d.random,
      paint ? d.hue : 0,
      paint ? d.sat : 0,
      paint ? d.lum : 0,
      paint ? d.mix2 : 0,
      d.dir,
      d.roundness,
      d.texture,
      d.wet
    )
    this.pendingLoad += d.load
    const r = size / 2 + 2
    const b = this.bounds
    this.bounds = b
      ? {
          x0: Math.min(b.x0, x - r),
          y0: Math.min(b.y0, y - r),
          x1: Math.max(b.x1, x + r),
          y1: Math.max(b.y1, y + r),
        }
      : { x0: x - r, y0: y - r, x1: x + r, y1: y + r }
    if (this.pending.length >= CAPACITY * DAB_FLOATS) this.depositPending()
  }

  /**
   * Deposits pending dabs, optionally advances the wet simulation one step,
   * and resolves the result into `canvas`.
   */
  frame(simulate = true) {
    if (!this.setup || !this.base) return
    this.depositPending()
    if (simulate && this.wet) this.simulate()
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    })
    pass.setPipeline(this.resolve)
    pass.setBindGroup(
      0,
      this.group(this.resolve, [
        { buffer: this.uniform },
        this.base.createView(),
        this.pairs[this.cur][0].createView(),
        this.pairs[this.cur][1].createView(),
      ])
    )
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  private group(
    pipeline: GPURenderPipeline,
    resources: GPUBindingResource[]
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    })
  }

  private depositPending() {
    const setup = this.setup
    if (!setup || !this.base || this.pending.length === 0) return
    const data = new Float32Array(this.pending)
    this.pending = []
    const count = data.length / DAB_FLOATS
    const p = this.params
    const pickup = p[17]
    // 1 lays fresh paint; towards 0 the tip only moves what is on the canvas.
    const load = setup.mode === "paint" ? this.pendingLoad / count : 1
    this.pendingLoad = 0

    // Reservoir footprint follows the first dab of the batch; how much it
    // exchanges depends on how far the brush has travelled since last time.
    const distance = data[data.length - DAB_FLOATS + 6]
    const travel =
      Math.max(0, distance - this.lastDistance) / Math.max(1, setup.size * 0.5)
    this.lastDistance = distance
    const moved = 1 - Math.exp(-travel * 0.6)
    const smudge = setup.mode === "smudge"
    // Sample a little ahead of the tip: behind it lies only the paint this
    // stroke has just put down, ahead is what it is about to run into.
    const ahead = smudge ? 0 : data[2] * 0.3
    p.set(
      [
        data[0] + this.batchHeading[0] * ahead,
        data[1] + this.batchHeading[1] * ahead,
        data[2],
        data[3],
      ],
      24
    )
    // A dry tip behaves like the smudge tool: it soaks up the canvas quickly
    // and thins out over bare paper instead of reloading.
    const soak = this.firstDeposit ? 1 : 1 - Math.exp(-travel * 1.3)
    const dry = smudge ? 1 : 1 - load
    p.set(
      [
        pickup * moved * (1 - dry) + soak * dry,
        moved * (1 - pickup) * 0.6 * (1 - dry),
        dry,
      ],
      28
    )
    p[31] = data[13]
    this.device.queue.writeBuffer(this.uniform, 0, p)
    this.device.queue.writeBuffer(this.storage, 0, data)

    const encoder = this.device.createCommandEncoder()
    const [t0, t1] = this.pairs[this.cur]
    if (this.reservoirOn) {
      const next = 1 - this.resCur
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: this.res[next].createView(), loadOp: "clear", storeOp: "store" },
        ],
      })
      pass.setPipeline(this.reservoir)
      pass.setBindGroup(
        0,
        this.group(this.reservoir, [
          { buffer: this.uniform },
          this.res[this.resCur].createView(),
          this.base.createView(),
          t0.createView(),
          t1.createView(),
          this.sampler,
        ])
      )
      pass.draw(3)
      pass.end()
      this.resCur = next
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [t0, t1].map((t) => ({
        view: t.createView(),
        loadOp: "load" as const,
        storeOp: "store" as const,
      })),
    })
    pass.setPipeline(this.deposit)
    pass.setBindGroup(
      0,
      this.group(this.deposit, [
        { buffer: this.uniform },
        { buffer: this.storage },
        this.res[this.resCur].createView(),
        this.sampler,
        this.repeat,
        ...this.layers.map((t) => t.createView()),
      ])
    )
    pass.draw(6, count)
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.firstDeposit = false
  }

  private simulate() {
    const b = this.bounds
    if (!b) return
    // Each step can move paint a few pixels, and drips further still.
    this.spread += 3.2 + this.params[34] * 2.6 + this.params[37] * 7
    const m = this.spread
    const x0 = Math.max(0, Math.floor(b.x0 - m))
    const y0 = Math.max(0, Math.floor(b.y0 - m))
    const x1 = Math.min(this.width, Math.ceil(b.x1 + m))
    const y1 = Math.min(this.height, Math.ceil(b.y1 + m))
    if (x1 <= x0 || y1 <= y0) return
    const next = 1 - this.cur
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: this.pairs[next].map((t) => ({
        view: t.createView(),
        loadOp: "load" as const,
        storeOp: "store" as const,
      })),
    })
    pass.setPipeline(this.flow)
    pass.setBindGroup(
      0,
      this.group(this.flow, [
        { buffer: this.uniform },
        this.pairs[this.cur][0].createView(),
        this.pairs[this.cur][1].createView(),
        this.sampler,
      ])
    )
    // The rectangle only ever grows, so the pair being written is always
    // fully refreshed wherever either pair holds paint.
    pass.setScissorRect(x0, y0, x1 - x0, y1 - y0)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
    this.cur = next
  }
}
