export interface HSV {
  /** 0–360 */
  h: number
  /** 0–1 */
  s: number
  /** 0–1 */
  v: number
}

export function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = v - c
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

export function rgbToHsv(r: number, g: number, b: number, fallbackHue = 0): HSV {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = fallbackHue
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")
}

export function hexToRgb(hex: string): [number, number, number] | null {
  let s = hex.trim().replace(/^#/, "")
  if (/^[0-9a-f]{3}$/i.test(s)) {
    s = s
      .split("")
      .map((ch) => ch + ch)
      .join("")
  }
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function hsvToHex(c: HSV): string {
  return rgbToHex(...hsvToRgb(c))
}

export function hexToHsv(hex: string, fallbackHue = 0): HSV | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsv(rgb[0], rgb[1], rgb[2], fallbackHue) : null
}
