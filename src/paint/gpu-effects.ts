/// <reference types="@webgpu/types" />
import { getEffect, type LayerFx } from "./effects"
import shader from "./gpu/effects.wgsl?raw"

const FLOAT = "rgba16float" as const
const UNIFORM_FLOATS = 16
const BLUR_TAPS = 32

/**
 * Runs adjustment-layer effects on the GPU. `apply()` uploads a canvas,
 * renders the effect over it and leaves the result in `canvas`, which is
 * readable by `drawImage` for the rest of the current task.
 */
export class GPUEffects {
  readonly canvas = document.createElement("canvas")

  private device: GPUDevice
  private context: GPUCanvasContext
  private blurPipe: GPURenderPipeline
  private mainPipe: GPURenderPipeline
  private sampler: GPUSampler
  /** One uniform block per pass: horizontal blur, vertical blur, effect. */
  private uniforms: GPUBuffer[]
  private width = 0
  private height = 0
  private source: GPUTexture | null = null
  private soft: [GPUTexture, GPUTexture] | null = null

  constructor(device: GPUDevice) {
    this.device = device
    this.context = this.canvas.getContext("webgpu")!
    const format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device, format, alphaMode: "premultiplied" })
    const module = device.createShaderModule({ code: shader })
    const build = (entryPoint: string, target: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint, targets: [{ format: target }] },
        primitive: { topology: "triangle-list" },
      })
    this.blurPipe = build("fsBlur", FLOAT)
    this.mainPipe = build("fs", format)
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    })
    this.uniforms = [0, 1, 2].map(() =>
      device.createBuffer({
        size: UNIFORM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    )
  }

  private allocate(width: number, height: number): boolean {
    const max = this.device.limits.maxTextureDimension2D
    if (width > max || height > max) return false
    if (this.source && this.width === width && this.height === height)
      return true
    this.source?.destroy()
    this.soft?.forEach((t) => t.destroy())
    this.soft = null
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.source = this.device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    return true
  }

  private softTargets(): [GPUTexture, GPUTexture] {
    if (!this.soft) {
      const make = () =>
        this.device.createTexture({
          size: [this.width, this.height],
          format: FLOAT,
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
      this.soft = [make(), make()]
    }
    return this.soft
  }

  /**
   * Renders `fx` over `image` at the given strength. Returns the canvas
   * holding the result, or null if the effect could not run.
   */
  apply(
    image: HTMLCanvasElement,
    fx: LayerFx,
    opacity: number
  ): HTMLCanvasElement | null {
    const def = getEffect(fx.type)
    if (!def || !this.allocate(image.width, image.height)) return null
    const { device } = this
    const source = this.source!

    // A canvas has no backing image until a context has been requested.
    image.getContext("2d")
    device.queue.copyExternalImageToTexture(
      { source: image },
      { texture: source, premultipliedAlpha: true },
      [this.width, this.height]
    )

    const values: Record<string, number> = {}
    for (const p of def.params) values[p.key] = fx.params[p.key] ?? p.value
    const sigma = def.blur ? Math.max(0, def.blur(values)) : 0
    const blurred = sigma > 0.05
    const spacing = Math.max(1, (sigma * 3) / BLUR_TAPS)

    const block = (dx: number, dy: number) => {
      const u = new Float32Array(UNIFORM_FLOATS)
      u.set([this.width, this.height, def.code, opacity], 0)
      def.params.slice(0, 8).forEach((p, i) => (u[4 + i] = values[p.key]))
      u.set([dx, dy, sigma, spacing], 12)
      return u
    }
    const pass = (
      encoder: GPUCommandEncoder,
      pipeline: GPURenderPipeline,
      target: GPUTextureView,
      entries: GPUBindGroupEntry[]
    ) => {
      const p = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0, 0, 0, 0],
          },
        ],
      })
      p.setPipeline(pipeline)
      p.setBindGroup(
        0,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries,
        })
      )
      p.draw(3)
      p.end()
    }

    const encoder = device.createCommandEncoder()
    let soft = source
    if (blurred) {
      const [a, b] = this.softTargets()
      const blur = (
        index: number,
        from: GPUTexture,
        to: GPUTexture,
        dx: number,
        dy: number
      ) => {
        device.queue.writeBuffer(this.uniforms[index], 0, block(dx, dy))
        pass(encoder, this.blurPipe, to.createView(), [
          { binding: 0, resource: { buffer: this.uniforms[index] } },
          { binding: 1, resource: from.createView() },
          { binding: 3, resource: this.sampler },
        ])
      }
      blur(0, source, a, 1, 0)
      blur(1, a, b, 0, 1)
      soft = b
    }
    device.queue.writeBuffer(this.uniforms[2], 0, block(0, 0))
    pass(encoder, this.mainPipe, this.context.getCurrentTexture().createView(), [
      { binding: 0, resource: { buffer: this.uniforms[2] } },
      { binding: 1, resource: source.createView() },
      { binding: 2, resource: soft.createView() },
      { binding: 3, resource: this.sampler },
    ])
    device.queue.submit([encoder.finish()])
    return this.canvas
  }
}
