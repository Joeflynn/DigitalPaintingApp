import { GPUBrush } from "./gpu-brush"

let renderer: Promise<GPUBrush> | undefined
const lostHandlers = new Set<() => void>()

/**
 * The renderer shared by brush thumbnails and the studio's scratch pad. It is
 * separate from the one painting the document, so previews never disturb a
 * stroke in progress.
 */
export function previewRenderer(onLost?: () => void): Promise<GPUBrush> {
  if (onLost) lostHandlers.add(onLost)
  renderer ??= GPUBrush.create(() => {
    renderer = undefined
    for (const handler of lostHandlers) handler()
  }).catch((error) => {
    renderer = undefined
    throw error
  })
  return renderer
}
