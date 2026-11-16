/// <reference types="@webgpu/types" />
import shader from "./gpu/ants.wgsl?raw"

/** Draws the animated selection outline into a screen-sized canvas. */
export class GPUAnts {
  readonly canvas = document.createElement("canvas")

  private device: GPUDevice
  private context: GPUCanvasContext
  private pipeline: GPURenderPipeline
  private sampler: GPUSampler
  private uniform: GPUBuffer
  private mask: GPUTexture | null = null
  private rev = -1

  constructor(device: GPUDevice) {
    this.device = device
    this.context = this.canvas.getContext("webgpu")!
    const format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({ device, format, alphaMode: "premultiplied" })
    const module = device.createShaderModule({ code: shader })
    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    })
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    })
    this.uniform = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Renders the outline of `selection` (revision `rev`) as seen through the
   * given view. Returns false if the selection is too large for this GPU.
   */
  draw(
    selection: HTMLCanvasElement,
    rev: number,
    width: number,
    height: number,
    view: { tx: number; ty: number; scale: number; rot: number },
    dpr: number,
    phase: number
  ): boolean {
    const { device } = this
    const w = selection.width
    const h = selection.height
    const max = device.limits.maxTextureDimension2D
    if (w > max || h > max) return false
    if (!this.mask || this.mask.width !== w || this.mask.height !== h) {
      this.mask?.destroy()
      this.mask = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.rev = -1
    }
    if (this.rev !== rev) {
      selection.getContext("2d")
      device.queue.copyExternalImageToTexture(
        { source: selection },
        { texture: this.mask, premultipliedAlpha: true },
        [w, h]
      )
      this.rev = rev
    }
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([
        view.tx * dpr,
        view.ty * dpr,
        view.scale * dpr,
        view.rot,
        w,
        h,
        phase,
        dpr,
      ])
    )
    const encoder = device.createCommandEncoder()
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
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: this.mask.createView() },
          { binding: 2, resource: this.sampler },
        ],
      })
    )
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    return true
  }
}
