import {
  HighlighterIcon,
  LassoIcon,
  MagicWandIcon,
  PolygonIcon,
  SelectionIcon,
} from "@phosphor-icons/react"
import type { ReactNode } from "react"

import type { SelectTool } from "@/paint/engine"

export const SELECT_TOOL_INFO: {
  id: SelectTool
  label: string
  hint: string
  icon: ReactNode
}[] = [
  {
    id: "select-rect",
    label: "Rectangle select (A)",
    hint: "Drag a rectangle",
    icon: <SelectionIcon />,
  },
  {
    id: "select-lasso",
    label: "Lasso (L)",
    hint: "Draw around an area",
    icon: <LassoIcon />,
  },
  {
    id: "select-poly",
    label: "Polygonal lasso (P)",
    hint: "Click corners · double-click or Enter to close",
    icon: <PolygonIcon />,
  },
  {
    id: "select-brush",
    label: "Selection brush (Q)",
    hint: "Paint over an area",
    icon: <HighlighterIcon />,
  },
  {
    id: "select-wand",
    label: "Magic wand (W)",
    hint: "Click a colour",
    icon: <MagicWandIcon />,
  },
]
