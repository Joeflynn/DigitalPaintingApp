import type { LayerMeta } from "./engine"

export interface SavedDoc {
  version: 1
  width: number
  height: number
  background: string
  showBackground: boolean
  layers: LayerMeta[]
  activeLayerId: string
  blobs: Record<string, Blob>
}

/** What the gallery shows for a project; the painting itself is a SavedDoc. */
export interface ProjectMeta {
  id: string
  name: string
  width: number
  height: number
  created: number
  updated: number
  thumb: Blob | null
}

const DB_NAME = "pigment"
const DOCS = "docs"
const PROJECTS = "projects"
const CURRENT_KEY = "pigment.project"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS)
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const request = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/** Runs `work` in one transaction over both stores and resolves once it commits. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (docs: IDBObjectStore, projects: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openDb()
  try {
    const tx = db.transaction([DOCS, PROJECTS], mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    const out = await work(tx.objectStore(DOCS), tx.objectStore(PROJECTS))
    await done
    return out
  } finally {
    db.close()
  }
}

/** Every project, most recently edited first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await transact("readwrite", async (docs, projects) => {
    const metas = (await request(projects.getAll())) as ProjectMeta[]
    if (metas.length > 0) return metas
    // Before the gallery existed there was a single autosaved painting; adopt
    // it as the first project.
    const old = (await request(docs.get("autosave"))) as SavedDoc | undefined
    if (!old) return metas
    const now = Date.now()
    const meta: ProjectMeta = {
      id: "autosave",
      name: "Untitled painting",
      width: old.width,
      height: old.height,
      created: now,
      updated: now,
      thumb: null,
    }
    projects.put(meta)
    return [meta]
  })
  return all.sort((a, b) => b.updated - a.updated)
}

export function createProject(meta: ProjectMeta): Promise<void> {
  return transact("readwrite", async (_docs, projects) => {
    projects.put(meta)
  })
}

export function loadProject(id: string): Promise<SavedDoc | null> {
  return transact("readonly", async (docs) => ((await request(docs.get(id))) as SavedDoc | undefined) ?? null)
}

/**
 * Stores a project's painting and refreshes its gallery entry. Does nothing
 * if the project has been deleted in the meantime.
 */
export function saveProject(id: string, doc: SavedDoc, thumb: Blob | null): Promise<void> {
  return transact("readwrite", async (docs, projects) => {
    const meta = (await request(projects.get(id))) as ProjectMeta | undefined
    if (!meta) return
    docs.put(doc, id)
    projects.put({
      ...meta,
      width: doc.width,
      height: doc.height,
      updated: Date.now(),
      thumb: thumb ?? meta.thumb,
    })
  })
}

export function renameProject(id: string, name: string): Promise<void> {
  return transact("readwrite", async (_docs, projects) => {
    const meta = (await request(projects.get(id))) as ProjectMeta | undefined
    if (meta) projects.put({ ...meta, name })
  })
}

export function deleteProjects(ids: string[]): Promise<void> {
  return transact("readwrite", async (docs, projects) => {
    for (const id of ids) {
      docs.delete(id)
      projects.delete(id)
    }
  })
}

/** Copies a project under `newId`, named "… copy". */
export function duplicateProject(id: string, newId: string): Promise<void> {
  return transact("readwrite", async (docs, projects) => {
    const meta = (await request(projects.get(id))) as ProjectMeta | undefined
    if (!meta) return
    const doc = (await request(docs.get(id))) as SavedDoc | undefined
    const now = Date.now()
    if (doc) docs.put(doc, newId)
    projects.put({ ...meta, id: newId, name: `${meta.name} copy`, created: now, updated: now })
  })
}

/** The project to reopen on the next launch. */
export function currentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

export function rememberProject(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else localStorage.removeItem(CURRENT_KEY)
  } catch {
    // not remembered; the most recent project opens instead
  }
}
