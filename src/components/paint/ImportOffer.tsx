import { PaletteIcon, XIcon } from "@phosphor-icons/react"
import { useEffect } from "react"

import { IconButton, panelClass } from "@/components/paint/controls"
import { layout } from "@/components/paint/layout"
import { cn } from "@/lib/utils"
import { engine } from "@/paint/engine"
import { palettes, usePalettes } from "@/paint/palettes"

/** After an image is imported: a short-lived offer to pull a palette from it. */
export function ImportOffer() {
  const { offer } = usePalettes()

  useEffect(() => {
    if (!offer) return
    const t = window.setTimeout(() => palettes.dismissOffer(), 12000)
    return () => window.clearTimeout(t)
  }, [offer])

  if (!offer) return null

  const extract = async () => {
    const made = await palettes.acceptOffer()
    if (!made) {
      engine.notify("No colours could be read from that image")
      return
    }
    // Show the result: the expanded colour panel, on its palettes.
    if (!layout.get().colorExpanded) layout.toggleColor()
    engine.notify(`Added the palette “${made.name}”`)
  }

  return (
    <div
      role="status"
      className={cn(
        panelClass,
        "absolute bottom-16 left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 py-1.5 pr-1.5 pl-4 text-xs text-muted-foreground"
      )}
    >
      <span className="truncate">
        Imported <b className="font-medium text-foreground">{offer.name}</b>
      </span>
      <button
        type="button"
        onClick={() => void extract()}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PaletteIcon className="size-4" /> Extract palette
      </button>
      <IconButton label="Dismiss" className="size-7" onClick={() => palettes.dismissOffer()}>
        <XIcon />
      </IconButton>
    </div>
  )
}
