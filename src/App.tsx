import { useCallback, useEffect, useState } from "react"

import { AidsOverlay } from "@/components/paint/AidsOverlay"
import { AidsPanel } from "@/components/paint/AidsPanel"
import { BrushPanel } from "@/components/paint/BrushPanel"
import { BrushStudio } from "@/components/paint/BrushStudio"
import { CanvasView } from "@/components/paint/CanvasView"
import { Gallery } from "@/components/paint/Gallery"
import { ColorPanel } from "@/components/paint/ColorPanel"
import { DistortPanel } from "@/components/paint/DistortPanel"
import { panelClass } from "@/components/paint/controls"
import { PanelFrame, SnapGuides, measureInsets, useLayout } from "@/components/paint/layout"
import { ImportOffer } from "@/components/paint/ImportOffer"
import { LayersPanel } from "@/components/paint/LayersPanel"
import { ToolRail } from "@/components/paint/ToolRail"
import { TopBar } from "@/components/paint/TopBar"
import { VectorPanel } from "@/components/paint/VectorPanel"
import { useEngine, useShortcuts } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { engine, isPaintTool, selectedObject } from "@/paint/engine"

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
        "pointer-events-none absolute bottom-5 left-1/2 z-[70] -translate-x-1/2 px-4 py-2 text-xs text-foreground"
      )}
    >
      {notice.text}
    </div>
  )
}

export function App() {
  const [panelsOpen, setPanelsOpen] = useState(true)
  const togglePanels = useCallback(() => setPanelsOpen((v) => !v), [])
  const showPanels = useCallback(() => setPanelsOpen(true), [])
  const [studio, setStudio] = useState(false)
  const closeStudio = useCallback(() => setStudio(false), [])
  const [gallery, setGallery] = useState(false)
  const openGallery = useCallback(() => setGallery(true), [])
  const closeGallery = useCallback(() => setGallery(false), [])
  const state = useEngine()
  const { tool } = state
  const vector = tool === "shape" || tool === "text" || !!selectedObject(state)
  useShortcuts(togglePanels)

  const lay = useLayout()
  const { hidden } = lay

  // Keep "fit" centred in the space the edge-docked panels leave free.
  useEffect(() => {
    engine.setInsets(...measureInsets())
  }, [panelsOpen, lay])

  return (
    <div className="relative h-svh w-screen overflow-hidden bg-[radial-gradient(ellipse_at_center,oklch(0.24_0.008_107),oklch(0.15_0.006_107))] text-foreground select-none">
      <CanvasView />
      <AidsOverlay />
      <TopBar panelsOpen={panelsOpen} onTogglePanels={togglePanels} onShowPanels={showPanels} onOpenGallery={openGallery} />

      {panelsOpen && (
        <>
          {!hidden.tools && (
            <PanelFrame id="tools" label="Tools" bare resizable={false}>
              <ToolRail />
            </PanelFrame>
          )}
          {!hidden.color && (
            <PanelFrame id="color" label="Colour" minW={220} minH={lay.colorExpanded ? 380 : 220}>
              <ColorPanel />
            </PanelFrame>
          )}
          {!hidden.options && (
            <PanelFrame
              id="options"
              label={tool === "distort" ? "Distort" : vector ? "Object" : "Brushes"}
              minW={260}
            >
              {tool === "distort" ? (
                <DistortPanel />
              ) : vector ? (
                <VectorPanel />
              ) : (
                <BrushPanel onOpenStudio={() => setStudio(true)} />
              )}
            </PanelFrame>
          )}
          {!hidden.layers && (
            <PanelFrame id="layers" label="Layers" minW={260}>
              <LayersPanel />
            </PanelFrame>
          )}
          {!hidden.aids && (
            <PanelFrame id="aids" label="Drawing aids" minW={250} minH={240}>
              <AidsPanel />
            </PanelFrame>
          )}
          <SnapGuides />
        </>
      )}
      {studio && (
        <BrushStudio
          tool={isPaintTool(tool) ? tool : "brush"}
          onClose={closeStudio}
        />
      )}
      {/* With no project open there is nothing to paint on, so the gallery stays up. */}
      {(gallery || (state.ready && !state.projectId)) && <Gallery onClose={closeGallery} />}
      <ImportOffer />
      <Toast />
    </div>
  )
}

export default App
