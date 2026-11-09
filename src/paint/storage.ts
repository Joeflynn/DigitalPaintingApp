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

const DB_NAME = "pigment"
const STORE = "docs"
const KEY = "autosave"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveAutosave(doc: SavedDoc): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(doc, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadAutosave(): Promise<SavedDoc | null> {
  const db = await openDb()
  const doc = await new Promise<SavedDoc | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as SavedDoc | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return doc
}
