import type * as React from "react"
import { useEffect } from "react"

import { cn } from "@/lib/utils"

export const panelClass =
  "rounded-2xl border border-white/8 bg-card/95 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md"

/**
 * Closes a popover on Escape or a press anywhere outside it. Mark the
 * popover and the control that toggles it with `data-popover` so presses on
 * those are left alone.
 */
export function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest("[data-popover]")) return
      // Swallow the press so dismissing a menu doesn't also paint a dab.
      e.stopPropagation()
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("keydown", key)
    return () => {
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("keydown", key)
    }
  }, [open, onClose])
}

export function IconButton({
  label,
  active,
  soft = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  /** Active shows as a tint rather than solid primary: for panel toggles and sub-tools. */
  soft?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-[18px]",
        active &&
          (soft
            ? "bg-primary/25 text-foreground hover:bg-primary/35"
            : "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"),
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * A single-colour SVG asset drawn in the current text colour, so it follows
 * hover and active states like the Phosphor icons do.
 */
export function MaskIcon({ src, className }: { src: string; className?: string }) {
  // Quoted: Vite inlines small SVGs as data URIs, which break a bare url().
  const url = `url("${src.replace(/"/g, "%22")}")`
  return (
    <span
      aria-hidden
      className={cn("inline-block size-[18px] shrink-0 bg-current", className)}
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  )
}

/** Small uppercase caption used beside quick-option controls. */
export const captionClass = "text-[10px] leading-[14px] font-medium tracking-[0.25px] text-muted-foreground uppercase"

/** Compact select-style trigger (design: Dropdown Trigger). */
export const dropdownTriggerClass =
  "flex h-7 shrink-0 items-center gap-1 rounded-[10px] border border-white/10 bg-black/30 px-2 text-[11px] leading-4 text-foreground outline-none hover:border-white/30 focus-visible:ring-2 focus-visible:ring-ring"

interface SliderProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  label: string
  vertical?: boolean
  /** >1 gives finer control at the low end */
  exp?: number
  className?: string
  /** Custom track background (e.g. a hue gradient); hides the fill. */
  trackStyle?: React.CSSProperties
  /** A filled bar with a pill thumb, as on the layer tiles. Horizontal only. */
  bar?: boolean
}

export function Slider({
  value,
  min,
  max,
  onChange,
  label,
  vertical = false,
  exp = 1,
  className,
  trackStyle,
  bar = false,
}: SliderProps) {
  const t = Math.pow(Math.min(1, Math.max(0, (value - min) / (max - min))), 1 / exp)
  const fromT = (u: number) => min + (max - min) * Math.pow(u, exp)

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const pad = vertical ? 0 : bar ? 4 : 7
    const u = vertical
      ? 1 - (e.clientY - r.top) / r.height
      : (e.clientX - r.left - pad) / (r.width - pad * 2)
    onChange(fromT(Math.min(1, Math.max(0, u))))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    onChange(fromT(Math.min(1, Math.max(0, t + dir * 0.02))))
  }

  const common = {
    role: "slider",
    tabIndex: 0,
    "aria-label": label,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": Math.round(value * 100) / 100,
    "aria-orientation": vertical ? ("vertical" as const) : ("horizontal" as const),
    onKeyDown,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      fromPointer(e)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e)
    },
  }

  if (vertical) {
    return (
      <div
        {...common}
        className={cn(
          "relative w-9 cursor-ns-resize touch-none overflow-hidden rounded-xl bg-white/6 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        <div
          className="absolute inset-x-0 bottom-0 bg-white/14"
          style={{ height: `${t * 100}%` }}
        />
        <div
          className="absolute inset-x-1.5 h-1 -translate-y-1/2 rounded-full bg-foreground/90"
          style={{ top: `calc(${(1 - t) * 100}% * 0.94 + 3%)` }}
        />
      </div>
    )
  }

  if (bar) {
    const at = `calc(4px + (100% - 8px) * ${t})`
    return (
      <div
        {...common}
        className={cn(
          "relative h-6 cursor-ew-resize touch-none overflow-hidden rounded-md bg-white/6 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        <div className="absolute inset-y-0 left-0 bg-white/14" style={{ width: at }} />
        <div
          className="absolute top-0.5 h-5 w-1 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: at }}
        />
      </div>
    )
  }

  return (
    <div
      {...common}
      className={cn(
        "relative h-5 cursor-ew-resize touch-none outline-none [&:focus-visible>div:last-child]:ring-2 [&:focus-visible>div:last-child]:ring-ring",
        className
      )}
    >
      <div
        className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10"
        style={trackStyle}
      >
        {!trackStyle && (
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `calc(7px + (100% - 14px) * ${t})` }}
          />
        )}
      </div>
      <div
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
        style={{ left: `calc(7px + (100% - 14px) * ${t})` }}
      />
    </div>
  )
}
