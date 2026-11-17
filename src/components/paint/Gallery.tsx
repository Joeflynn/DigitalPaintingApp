import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  ImageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { IconButton, panelClass, useDismiss } from "@/components/paint/controls"
import { NewCanvasMenu } from "@/components/paint/TopBar"
import { useEngine } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"
import { engine } from "@/paint/engine"
import { importImages } from "@/paint/palettes"
import { listProjects, renameProject, type ProjectMeta } from "@/paint/storage"

/** Largest canvas side an imported image is given. */
const MAX_SIDE = 4096

// Object URLs for thumbnails, replaced only when a project is saved again.
const thumbUrls = new Map<string, { updated: number; url: string }>()

function thumbUrl(p: ProjectMeta): string | null {
  if (!p.thumb) return null
  const hit = thumbUrls.get(p.id)
  if (hit?.updated === p.updated) return hit.url
  if (hit) URL.revokeObjectURL(hit.url)
  const url = URL.createObjectURL(p.thumb)
  thumbUrls.set(p.id, { updated: p.updated, url })
  return url
}

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })

function TextButton({
  onClick,
  disabled,
  active,
  danger,
  children,
  ...props
}: {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
  children: ReactNode
  "data-popover"?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-white/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
        active && "bg-white/10 text-foreground",
        danger && "hover:bg-destructive/20 hover:text-destructive"
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function CardMenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:text-muted-foreground",
        danger && "text-destructive [&_svg]:text-destructive"
      )}
    >
      {children}
    </button>
  )
}

function Card({
  project,
  current,
  selecting,
  picked,
  onOpen,
  onPick,
  onRename,
  onDuplicate,
  onDelete,
}: {
  project: ProjectMeta
  current: boolean
  selecting: boolean
  picked: boolean
  onOpen: () => void
  onPick: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  useDismiss(menu, () => setMenu(false))
  const url = thumbUrl(project)

  const commitName = () => {
    const name = draft?.trim()
    if (name && name !== project.name) onRename(name)
    setDraft(null)
  }

  return (
    <li className="group relative flex flex-col items-center gap-2.5">
      <button
        type="button"
        aria-label={selecting ? `Select ${project.name}` : `Open ${project.name}`}
        aria-pressed={selecting ? picked : undefined}
        onClick={selecting ? onPick : onOpen}
        className="relative aspect-[4/3] w-full rounded-2xl outline-none transition-colors hover:bg-white/4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className={cn(
              "absolute inset-3 m-auto max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] rounded-md bg-[repeating-conic-gradient(#9a9a96_0_25%,#c4c4bf_0_50%)] bg-[length:16px_16px] object-contain shadow-[0_14px_36px_-10px_rgba(0,0,0,0.85)] transition-transform group-hover:scale-[1.02]",
              current && !selecting && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              picked && "ring-2 ring-white ring-offset-2 ring-offset-background"
            )}
          />
        ) : (
<span className="absolute inset-3 rounded-md bg-white/8" />
        )}
      </button>

      {selecting && (
        <span
          className={cn(
            "pointer-events-none absolute top-2 left-2 grid size-6 place-items-center rounded-full border-2 border-white/60 bg-black/40 text-white",
            picked && "border-white bg-primary"
          )}
        >
          {picked && <CheckIcon weight="bold" className="size-3.5" />}
        </span>
      )}

      {!selecting && (
        <div className="absolute top-2 right-2">
          <IconButton
            label={`More actions for ${project.name}`}
            data-popover
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            className={cn(
              "size-8 bg-black/55 text-white opacity-0 backdrop-blur-sm group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-black/75 hover:text-white",
              menu && "opacity-100"
            )}
          >
            <DotsThreeIcon weight="bold" />
          </IconButton>
          {menu && (
            <div data-popover role="menu" className={cn(panelClass, "absolute top-full right-0 z-10 mt-1.5 w-40 p-1.5")}>
              <CardMenuItem
                onClick={() => {
                  setMenu(false)
                  setDraft(project.name)
                }}
              >
                <PencilSimpleIcon /> Rename
              </CardMenuItem>
              <CardMenuItem
                onClick={() => {
                  setMenu(false)
                  onDuplicate()
                }}
              >
                <CopyIcon /> Duplicate
              </CardMenuItem>
              <CardMenuItem
                danger
                onClick={() => {
                  setMenu(false)
                  onDelete()
                }}
              >
                <TrashIcon /> Delete
              </CardMenuItem>
            </div>
          )}
        </div>
      )}

      <div className="flex w-full flex-col items-center gap-0.5 px-2">
        {draft !== null ? (
          <input
            autoFocus
            aria-label="Painting name"
            value={draft}
            maxLength={60}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") commitName()
              if (e.key === "Escape") setDraft(null)
            }}
            className="h-6 w-full max-w-48 rounded-md border border-ring bg-black/30 px-1.5 text-center text-[13px] font-medium text-foreground outline-none select-text"
          />
        ) : (
          <button
            type="button"
            title="Rename"
            disabled={selecting}
            onClick={() => setDraft(project.name)}
            className="h-6 max-w-full truncate rounded-md px-1.5 text-[13px] font-medium text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            {project.name}
          </button>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {project.width} × {project.height} px · {day.format(project.updated)}
        </span>
      </div>
    </li>
  )
}

export function Gallery({ onClose }: { onClose: () => void }) {
  const { projectId } = useEngine()
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newOpen, setNewOpen] = useState(false)
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeNew = useCallback(() => setNewOpen(false), [])
  useDismiss(newOpen, closeNew)

  const refresh = useCallback(async () => {
    setProjects(await listProjects().catch(() => []))
  }, [])

  // Save the open painting first so its thumbnail is up to date.
  useEffect(() => {
    void engine.flush().then(refresh)
  }, [refresh])

  const stopSelecting = () => {
    setSelecting(false)
    setPicked(new Set())
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // An open menu takes the Escape for itself.
      if (e.key !== "Escape" || newOpen || document.querySelector("[data-modal] [role=menu]")) return
      if (confirm) setConfirm(null)
      else if (selecting) {
        setSelecting(false)
        setPicked(new Set())
      } else if (projectId) onClose()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [confirm, selecting, newOpen, projectId, onClose])

  const open = async (id: string) => {
    if (id === projectId || (await engine.openProject(id))) onClose()
  }

  const duplicate = async (ids: string[]) => {
    for (const id of ids) await engine.duplicateProject(id)
    stopSelecting()
    await refresh()
  }

  const remove = async (ids: string[]) => {
    setConfirm(null)
    await engine.deleteProjects(ids)
    stopSelecting()
    await refresh()
  }

  const importImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const bmp = await createImageBitmap(file)
      const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
      const name = file.name.replace(/\.[^.]+$/, "") || "Imported image"
      await engine.createProject(Math.round(bmp.width * k), Math.round(bmp.height * k), name)
      bmp.close()
      await importImages([file], (f) => engine.importImage(f, name))
      onClose()
    } catch {
      engine.notify("That file couldn't be opened as an image")
    }
  }

  const togglePick = (id: string) => {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  const count = picked.size
  const doomed = confirm?.length ?? 0
  const doomedName = doomed === 1 ? projects?.find((p) => p.id === confirm?.[0])?.name : undefined

  return (
    <div
      data-modal
      role="dialog"
      aria-label="Gallery"
      className="absolute inset-0 z-[60] flex flex-col bg-[radial-gradient(ellipse_at_top,oklch(0.24_0.008_107),oklch(0.15_0.006_107))]"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 sm:px-6">
        {projectId && (
          <IconButton label="Back to the canvas (Esc)" onClick={onClose}>
            <ArrowLeftIcon />
          </IconButton>
        )}
        <div className="flex items-center gap-2 px-1.5">
          <span className="size-4 rounded-full bg-[conic-gradient(from_210deg,#e5533d,#f6c445,#3f9d5a,#4aa3df,#7a4fc4,#e5533d)]" />
          <h1 className="text-base font-semibold tracking-tight">Pigment</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">Gallery</span>
        </div>

        <div className="relative ml-auto flex items-center gap-1">
          {selecting ? (
            <>
              <span className="mr-2 text-xs text-muted-foreground tabular-nums">{count} selected</span>
              <TextButton disabled={count === 0} onClick={() => void duplicate([...picked])}>
                <CopyIcon /> Duplicate
              </TextButton>
              <TextButton danger disabled={count === 0} onClick={() => setConfirm([...picked])}>
                <TrashIcon /> Delete
              </TextButton>
              <TextButton active onClick={stopSelecting}>
                Done
              </TextButton>
            </>
          ) : (
            <>
              <TextButton disabled={!projects?.length} onClick={() => setSelecting(true)}>
                Select
              </TextButton>
              <TextButton onClick={() => fileRef.current?.click()}>
                <ImageIcon /> Import
              </TextButton>
              <button
                type="button"
                data-popover
                aria-haspopup="dialog"
                aria-expanded={newOpen}
                onClick={() => setNewOpen(!newOpen)}
                className="ml-1 flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
              >
                <PlusIcon weight="bold" /> New canvas
              </button>
              {newOpen && (
                <div data-popover className={cn(panelClass, "absolute top-full right-0 z-20 mt-2 p-3")}>
                  <NewCanvasMenu
                    onDone={() => {
                      setNewOpen(false)
                      onClose()
                    }}
                  />
                </div>
              )}
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void importImage(e.target.files?.[0])
              e.target.value = ""
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-10 [scrollbar-width:thin] sm:px-6">
        {projects && projects.length === 0 && (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm font-medium text-foreground">No paintings yet</p>
              <p className="text-xs text-muted-foreground">
                Start a new canvas or import an image to begin.
              </p>
            </div>
          </div>
        )}
        {projects && projects.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-4 gap-y-7">
            {projects.map((p) => (
              <Card
                key={p.id}
                project={p}
                current={p.id === projectId}
                selecting={selecting}
                picked={picked.has(p.id)}
                onOpen={() => void open(p.id)}
                onPick={() => togglePick(p.id)}
                onRename={(name) => void renameProject(p.id, name).then(refresh)}
                onDuplicate={() => void duplicate([p.id])}
                onDelete={() => setConfirm([p.id])}
              />
            ))}
          </ul>
        )}
      </div>

      {confirm && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-label="Delete paintings" className={cn(panelClass, "flex w-80 flex-col gap-3 p-4")}>
            <h2 className="text-sm font-semibold text-foreground">
              {doomed === 1 ? `Delete “${doomedName ?? "this painting"}”?` : `Delete ${doomed} paintings?`}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {doomed === 1 ? "It" : "They"} will be removed from this browser for good. This can't be undone.
            </p>
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirm(null)}
                className="h-8 rounded-lg px-3 text-xs font-medium text-foreground outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove(confirm)}
                className="h-8 rounded-lg bg-destructive px-3 text-xs font-semibold text-white outline-none hover:bg-destructive/85 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
