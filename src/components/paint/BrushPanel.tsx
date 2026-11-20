import { DotsThreeIcon } from "@phosphor-icons/react"
import { useMemo, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"

import basicIcon from "@/assets/icons/brush-category/basic.svg"
import digitalIcon from "@/assets/icons/brush-category/digital.svg"
import effectsIcon from "@/assets/icons/brush-category/effects.svg"
import favoritesIcon from "@/assets/icons/brush-category/favorites.svg"
import inkIcon from "@/assets/icons/brush-category/ink.svg"
import oilPaintIcon from "@/assets/icons/brush-category/oil-paint.svg"
import recentIcon from "@/assets/icons/brush-category/recent.svg"
import sketchingIcon from "@/assets/icons/brush-category/sketching.svg"
import sprayIcon from "@/assets/icons/brush-category/spray.svg"
import textureIcon from "@/assets/icons/brush-category/texture.svg"
import { MaskIcon } from "@/components/paint/controls"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import {
  allBrushes,
  BRUSH_CATEGORIES,
  getBrush,
  maskBrush,
  subscribeBrushes,
  type BrushCategory,
  type BrushPreset,
} from "@/paint/brushes"
import { EFFECT_GROUPS, EFFECTS, LOOKS } from "@/paint/effects"
import { engine, isPaintTool, type FxChoice, type PaintTool } from "@/paint/engine"
import { BrushPreview } from "./BrushPreview"

type Section = "recent" | "all" | BrushCategory | "effects" | "mine"

const SECTION_INFO: Record<Section, { label: string; icon: string }> = {
  recent: { label: "Recently used", icon: recentIcon },
  all: { label: "All brushes", icon: basicIcon },
  Sketch: { label: "Sketch", icon: sketchingIcon },
  Ink: { label: "Ink", icon: inkIcon },
  Paint: { label: "Paint", icon: oilPaintIcon },
  Airbrush: { label: "Airbrush", icon: sprayIcon },
  Texture: { label: "Texture", icon: textureIcon },
  FX: { label: "Special", icon: digitalIcon },
  effects: { label: "Effects — paint an effect onto the canvas (K)", icon: effectsIcon },
  mine: { label: "My brushes", icon: favoritesIcon },
}

// ---- recently used brushes, remembered per browser ----

const RECENT_KEY = "pigment.recentBrushes"
const RECENT_MAX = 16
let recent: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
})()
const recentSubs = new Set<() => void>()
const recentStore = {
  subscribe(fn: () => void) {
    recentSubs.add(fn)
    return () => {
      recentSubs.delete(fn)
    }
  },
  get: () => recent,
  use(id: string) {
    recent = [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_MAX)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
    } catch {
      // not remembered
    }
    recentSubs.forEach((fn) => fn())
  },
}

const cardClass =
  "group/card relative h-14 shrink-0 overflow-hidden rounded-xl border border-transparent bg-black/20 hover:bg-black/35 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
const cardOn = "border-primary bg-primary/25 hover:bg-primary/25"
const cardName =
  "pointer-events-none absolute top-1 left-2 z-10 max-w-[calc(100%-36px)] truncate text-[10px] leading-[14px] font-medium text-foreground"

/** The "…" on a card: opens the Brush Studio for it. */
function MoreButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "absolute top-[5px] right-[5px] z-10 grid size-[22px] place-items-center rounded-lg border border-white/8 bg-muted text-muted-foreground shadow-sm outline-none hover:text-foreground focus-visible:opacity-100",
        on ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"
      )}
    >
      <DotsThreeIcon weight="bold" className="size-[18px]" />
    </button>
  )
}

function Card({
  on,
  name,
  title,
  onPick,
  onMore,
  moreLabel,
  children,
  className,
}: {
  on: boolean
  name: ReactNode
  title?: string
  onPick: () => void
  onMore: () => void
  moreLabel: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn(cardClass, on && cardOn, className)}>
      <button
        type="button"
        title={title}
        aria-pressed={on}
        onClick={onPick}
        className="absolute inset-0 outline-none"
      >
        {children}
      </button>
      <span className={cardName}>{name}</span>
      <MoreButton on={on} label={moreLabel} onClick={onMore} />
    </div>
  )
}

const preview =
  "pointer-events-none absolute top-1/2 left-1/2 h-[47px] w-[280px] max-w-none -translate-x-1/2 -translate-y-[calc(50%-0.5px)] object-cover mix-blend-lighten"

export function BrushPanel({ onOpenStudio }: { onOpenStudio: () => void }) {
  const s = useEngine()
  const brushes = useSyncExternalStore(subscribeBrushes, allBrushes)
  const recentIds = useSyncExternalStore(recentStore.subscribe, recentStore.get)
  const tool: PaintTool = isPaintTool(s.tool) ? s.tool : "brush"
  const selected = s.toolSettings[tool].brushId
  const hasCustom = brushes.some((b) => b.custom)

  const sections: Section[] = [
    "recent",
    "all",
    ...BRUSH_CATEGORIES,
    "effects",
    ...(hasCustom ? ["mine" as const] : []),
  ]
  const home: Section = tool === "fx" ? "effects" : recentIds.length ? "recent" : "all"
  const [section, setSection] = useState<Section>(home)
  // Switching to or from the effect brush (K, or picking an effect) follows
  // it to the matching section.
  const [lastTool, setLastTool] = useState(tool)
  if (tool !== lastTool) {
    setLastTool(tool)
    if (tool === "fx" || lastTool === "fx") setSection(home)
  }

  const list = useMemo(() => {
    if (section === "recent") {
      return recentIds.map((id) => brushes.find((b) => b.id === id)).filter((b): b is BrushPreset => !!b)
    }
    if (section === "all") return brushes
    if (section === "mine") return brushes.filter((b) => b.custom)
    if (section === "effects") return []
    return brushes.filter((b) => b.category === section)
  }, [brushes, recentIds, section])

  // Picking a brush from a regular section leaves the effect brush; the
  // eraser and smudge keep their own brush choice.
  const paintTool: PaintTool = tool === "fx" ? "brush" : tool
  const pick = (b: BrushPreset) => {
    if (tool === "fx") engine.setTool("brush")
    engine.selectBrush(paintTool, b.id)
    recentStore.use(b.id)
  }
  const pickEffect = (choice: FxChoice) => {
    engine.setFxChoice(choice)
    if (tool !== "fx") engine.setTool("fx")
  }
  const fxOn = (choice: FxChoice) =>
    tool === "fx" && s.fxChoice.kind === choice.kind && s.fxChoice.id === choice.id
  const fxTip = { ...getBrush(s.toolSettings.fx.brushId), ...(s.toolSettings.fx.dynamics ?? {}) }

  return (
    <div className="flex min-h-0 flex-1 gap-1">
      <nav
        aria-label="Brush categories"
        className="flex shrink-0 flex-col gap-1 overflow-y-auto [scrollbar-width:none]"
      >
        {sections.map((c) => (
          <button
            key={c}
            type="button"
            title={SECTION_INFO[c].label}
            aria-label={SECTION_INFO[c].label}
            aria-pressed={section === c}
            onClick={() => setSection(c)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-2xl text-muted-foreground transition-colors outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              section === c && "text-foreground"
            )}
          >
            <MaskIcon src={SECTION_INFO[c].icon} className="size-4" />
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto rounded-tl-2xl rounded-tr-[2px] rounded-br-[17px] rounded-bl-[2px] bg-white/6 p-2">
        {section === "effects" ? (
          <>
            <EffectHeading>Looks</EffectHeading>
            {LOOKS.map((look) => {
              const choice: FxChoice = { kind: "look", id: look.id }
              return (
                <Card
                  key={look.id}
                  on={fxOn(choice)}
                  name={look.label}
                  title={`${look.hint} (${look.layers.length} layers)`}
                  onPick={() => pickEffect(choice)}
                  moreLabel="Edit the effect brush tip in the Brush Studio"
                  onMore={() => {
                    pickEffect(choice)
                    onOpenStudio()
                  }}
                  className="bg-[linear-gradient(135deg,oklch(0.42_0.09_250/0.45),oklch(0.42_0.11_340/0.45))]"
                >
                  <BrushPreview brush={maskBrush(fxTip)} className={preview} />
                </Card>
              )
            })}
            {EFFECT_GROUPS.map((group) => (
              <div key={group} className="contents">
                <EffectHeading>{group}</EffectHeading>
                {EFFECTS.filter((e) => e.group === group).map((e) => {
                  const choice: FxChoice = { kind: "fx", id: e.id }
                  return (
                    <Card
                      key={e.id}
                      on={fxOn(choice)}
                      name={e.label}
                      title={e.hint}
                      onPick={() => pickEffect(choice)}
                      moreLabel="Edit the effect brush tip in the Brush Studio"
                      onMore={() => {
                        pickEffect(choice)
                        onOpenStudio()
                      }}
                    >
                      <BrushPreview brush={maskBrush(fxTip)} className={preview} />
                    </Card>
                  )
                })}
              </div>
            ))}
          </>
        ) : (
          <>
            {list.length === 0 && (
              <p className="px-1 py-2 text-[11px] leading-snug text-muted-foreground">
                {section === "recent" ? "Brushes you pick show up here." : "No brushes here yet."}
              </p>
            )}
            {list.map((b) => {
              const on = tool !== "fx" && b.id === selected
              const dyn = on ? (s.toolSettings[tool].dynamics ?? {}) : {}
              return (
                <Card
                  key={b.id}
                  on={on}
                  name={
                    <>
                      {b.name}
                      {b.custom && <span className="ml-1.5 text-muted-foreground">· mine</span>}
                      {on && Object.keys(dyn).length > 0 && <span className="ml-1.5 text-muted-foreground">· edited</span>}
                    </>
                  }
                  onPick={() => pick(b)}
                  moreLabel={`Open ${b.name} in the Brush Studio`}
                  onMore={() => {
                    if (!on) pick(b)
                    onOpenStudio()
                  }}
                >
                  <BrushPreview brush={{ ...b, ...dyn }} className={preview} />
                </Card>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

function EffectHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase first:pt-0">
      {children}
    </div>
  )
}
