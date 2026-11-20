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
import { ToolRail, hasRail, optionsKind } from "@/components/paint/ToolRail"
import { TopBar, ZoomBar } from "@/components/paint/TopBar"
import { VectorPanel } from "@/components/paint/VectorPanel"
import { useEngine, useShortcuts } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { engine, isPaintTool } from "@/paint/engine"

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
  const options = optionsKind(state)
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
      {panelsOpen && (
        <TopBar panelsOpen={panelsOpen} onTogglePanels={togglePanels} onShowPanels={showPanels} onOpenGallery={openGallery} />
      )}
      {/* Hiding the interface leaves only its toggle, in the bottom-left corner. */}
      <ZoomBar uiVisible={panelsOpen} showZoom={!hidden.viewControls} onToggleUi={togglePanels} />

      {panelsOpen && (
        <>
          {!hidden.tools && hasRail(state) && (
            <PanelFrame id="tools" label="Tool options" resizable={false}>
              <ToolRail />
            </PanelFrame>
          )}
          {!hidden.color && (
            <PanelFrame id="color" label="Colour" minW={200} minH={lay.colorExpanded ? 380 : 240}>
              <ColorPanel />
            </PanelFrame>
          )}
          {!hidden.options && options && (
            <PanelFrame
              id="options"
              label={options === "distort" ? "Transform" : options === "object" ? "Object" : "Brushes"}
              minW={options === "brush" ? 220 : 260}
            >
              {options === "distort" ? (
                <DistortPanel />
              ) : options === "object" ? (
                <VectorPanel />
              ) : (
                <BrushPanel onOpenStudio={() => setStudio(true)} />
              )}
            </PanelFrame>
          )}
          {!hidden.layers && (
            <PanelFrame id="layers" label="Layers" minW={124}>
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
