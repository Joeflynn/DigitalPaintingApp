/** Side of the greyscale image a brush stores for a raster stamp or texture. */
export const BRUSH_IMAGE_SIZE = 256

function canvasOf(side = BRUSH_IMAGE_SIZE) {
  const canvas = document.createElement("canvas")
  canvas.width = side
  canvas.height = side
  return [canvas, canvas.getContext("2d", { willReadFrequently: true })!] as const
}

/**
 * Turns a picture into the greyscale mask a brush stores: white marks, black
 * does not. A stamp is fitted inside the square and keeps its shape; a tile
 * fills it. Pictures with transparency use their alpha. Opaque stamps are
 * assumed to be drawn on a plain background, which is read from the corners,
 * so both dark-on-light and light-on-dark artwork come out the right way up.
 */
export async function importBrushImage(
  file: Blob,
  mode: "stamp" | "tile"
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const S = BRUSH_IMAGE_SIZE
  const [canvas, ctx] = canvasOf()
  ctx.imageSmoothingQuality = "high"
  if (mode === "stamp") {
    const k = Math.min(S / bitmap.width, S / bitmap.height)
    const w = bitmap.width * k
    const h = bitmap.height * k
    ctx.drawImage(bitmap, (S - w) / 2, (S - h) / 2, w, h)
  } else {
    ctx.drawImage(bitmap, 0, 0, S, S)
  }
  bitmap.close()

  const image = ctx.getImageData(0, 0, S, S)
  const d = image.data
  const lum = (i: number) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
  let transparent = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) transparent++
  // Letterboxing a stamp adds transparent bars, so ask for more than those.
  const useAlpha = transparent > (mode === "stamp" ? S * S * 0.02 : 0)
  let background = 0
  if (!useAlpha && mode === "stamp") {
    const corners = [0, S - 1, S * (S - 1), S * S - 1]
    background = corners.reduce((sum, c) => sum + lum(c * 4), 0) / 4
  }
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    let v = useAlpha ? a : lum(i)
    if (!useAlpha && mode === "stamp" && background > 0.5) v = 1 - v
    // Letterbox bars around an opaque stamp are empty, whatever its polarity.
    if (!useAlpha && a < 0.5) v = 0
    const g = Math.round(v * 255)
    d[i] = d[i + 1] = d[i + 2] = g
    d[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL("image/png")
}

/** Swaps what marks and what does not in a stored brush image. */
export async function invertBrushImage(url: string): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  const [canvas, ctx] = canvasOf()
  ctx.drawImage(bitmap, 0, 0, BRUSH_IMAGE_SIZE, BRUSH_IMAGE_SIZE)
  bitmap.close()
  ctx.globalCompositeOperation = "difference"
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, BRUSH_IMAGE_SIZE, BRUSH_IMAGE_SIZE)
  return canvas.toDataURL("image/png")
}
