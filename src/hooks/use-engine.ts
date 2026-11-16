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
      // A dialog such as the brush studio owns the keyboard while it is open.
      if (document.querySelector("[data-modal]")) return
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
        } else if (key === "a") {
          e.preventDefault()
          engine.selectAll()
        } else if (key === "d") {
          e.preventDefault()
          if (e.shiftKey) engine.reselect()
          else engine.deselect()
        } else if (key === "i" && e.shiftKey) {
          e.preventDefault()
          engine.invertSelection()
        } else if (key === "j") {
          e.preventDefault()
          engine.selectionToLayer(e.shiftKey)
        }
        return
      }

      if (e.key === "Escape") {
        if (engine.escape()) e.preventDefault()
        return
      }
      if (e.key === "Enter") {
        engine.closePolygon()
        engine.applyDistort()
        if (engine.editSelectedText()) e.preventDefault()
        return
      }
      if (e.key.startsWith("Arrow")) {
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0
        if (engine.nudgeObject(dx, dy)) e.preventDefault()
        return
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault()
        engine.backspace()
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
        case "t":
          engine.setTool("text")
          // Don't let this keypress land in the editor.
          e.preventDefault()
          break
        case "u":
          engine.setTool("shape")
          break
        case "d":
          engine.setTool("distort")
          break
        case "h":
          engine.setTool("hand")
          break
        case "a":
          engine.setTool("select-rect")
          break
        case "l":
          engine.setTool("select-lasso")
          break
        case "p":
          engine.setTool("select-poly")
          break
        case "q":
          engine.setTool("select-brush")
          break
        case "w":
          engine.setTool("select-wand")
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
