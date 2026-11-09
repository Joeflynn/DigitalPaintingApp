import { useEffect, useSyncExternalStore } from "react"

import { engine, type EngineState } from "@/paint/engine"

export function useEngine(): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  )
}

export function useShortcuts(togglePanels: () => void) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

      if (mod) {
        if (key === "z") {
          e.preventDefault()
          if (e.shiftKey) engine.redo()
          else engine.undo()
        } else if (key === "y") {
          e.preventDefault()
          engine.redo()
        } else if (key === "0") {
          e.preventDefault()
          engine.fit()
        }
        return
      }

      if (e.code === "Space") {
        e.preventDefault()
        engine.setSpace(true)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        togglePanels()
        return
      }
      if (e.repeat && key !== "[" && key !== "]") return

      const s = engine.getState()
      switch (key) {
        case "b":
          engine.setTool("brush")
          break
        case "e":
          engine.setTool("eraser")
          break
        case "s":
          engine.setTool("smudge")
          break
        case "g":
          engine.setTool("fill")
          break
        case "i":
          engine.setTool("eyedropper")
          break
        case "v":
          engine.setTool("move")
          break
        case "h":
          engine.setTool("hand")
          break
        case "r":
          engine.setRotateKey(true)
          break
        case "x":
          engine.swapColors()
          break
        case "m":
          engine.setSymmetry(!s.symmetry)
          break
        case "f":
          engine.fit()
          break
        case "[":
          engine.nudgeSize(-1)
          break
        case "]":
          engine.nudgeSize(1)
          break
        case "=":
        case "+":
          engine.zoomBy(1.25)
          break
        case "-":
          engine.zoomBy(0.8)
          break
        default:
          if (/^[0-9]$/.test(key)) {
            const tool = engine.settingsTool()
            engine.setToolSettings(tool, {
              opacity: key === "0" ? 1 : Number(key) / 10,
            })
          }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") engine.setSpace(false)
      if (e.key.toLowerCase() === "r") engine.setRotateKey(false)
    }
    const blur = () => {
      engine.setSpace(false)
      engine.setRotateKey(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [togglePanels])
}
