import { useCallback, useEffect, useState } from "react"

import { BrushPanel } from "@/components/paint/BrushPanel"
import { BrushStudio } from "@/components/paint/BrushStudio"
import { CanvasView } from "@/components/paint/CanvasView"
import { ColorPanel } from "@/components/paint/ColorPanel"
import { panelClass } from "@/components/paint/controls"
import { LayersPanel } from "@/components/paint/LayersPanel"
import { ToolRail } from "@/components/paint/ToolRail"
import { TopBar } from "@/components/paint/TopBar"
import { useEngine, useShortcuts } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { engine } from "@/paint/engine"

function Toast() {
  const { notice } = useEngine()
  const [shownId, setShownId] = useState(0)

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setShownId(notice.id), 2200)
    return () => window.clearTimeout(t)
  }, [notice])

  if (!notice || notice.id === shownId) return null
  return (
    <div
      role="status"
      className={cn(
        panelClass,
        "pointer-events-none absolute bottom-5 left-1/2 z-40 -translate-x-1/2 px-4 py-2 text-xs text-foreground"
      )}
    >
      {notice.text}
    </div>
  )
}

export function App() {
  const [panelsOpen, setPanelsOpen] = useState(true)
  const togglePanels = useCallback(() => setPanelsOpen((v) => !v), [])
  const [studio, setStudio] = useState(false)
  const closeStudio = useCallback(() => setStudio(false), [])
  const { tool } = useEngine()
  useShortcuts(togglePanels)

  useEffect(() => {
    engine.setInsets(panelsOpen ? 76 : 0, panelsOpen ? 316 : 0)
  }, [panelsOpen])

  return (
    <div className="relative h-svh w-screen overflow-hidden bg-[radial-gradient(ellipse_at_center,oklch(0.24_0.008_107),oklch(0.15_0.006_107))] text-foreground select-none">
      <CanvasView />
      <TopBar panelsOpen={panelsOpen} onTogglePanels={togglePanels} />

      {panelsOpen && (
        <>
          <ToolRail className="absolute top-[4.75rem] left-3 z-20" />
          <aside className="absolute top-[4.75rem] right-3 bottom-3 z-20 flex w-[292px] flex-col gap-2">
            <section className={cn(panelClass, "shrink-0")} aria-label="Colour">
              <ColorPanel />
            </section>
            <section className={cn(panelClass, "flex min-h-28 flex-1 flex-col")} aria-label="Brushes">
              <BrushPanel onOpenStudio={() => setStudio(true)} />
            </section>
            <section className={cn(panelClass, "flex min-h-36 flex-[1.15] flex-col")} aria-label="Layers">
              <LayersPanel />
            </section>
          </aside>
        </>
      )}
      {studio && (
        <BrushStudio
          tool={tool === "eraser" ? "eraser" : "brush"}
          onClose={closeStudio}
        />
      )}
      <Toast />
    </div>
  )
}

export default App
