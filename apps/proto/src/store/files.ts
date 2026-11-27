/**
 * Contents of attached files, kept in this browser (IndexedDB). The prototype has no server, so
 * nobody else gets them. Without IndexedDB (blocked, private window) they last until the page is
 * closed.
 */
import { STORAGE_SUFFIX } from '../lib/storage';

const DB = `quix-hw-files${STORAGE_SUFFIX}`;
const STORE = 'files';

interface Stored {
  blob: Blob;
  addedAt: number;
}

const memory = new Map<string, Stored>();
let opening: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB?.open(DB, 1);
      if (!req) return resolve(undefined);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      req.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

/** Run one transaction; rejects when it could not be stored (e.g. the disk is full). */
async function tx<T>(
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = work(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onabort = () => reject(t.error ?? new Error('aborted'));
    t.onerror = () => reject(t.error ?? new Error('failed'));
  });
}

export async function putFile(key: string, blob: Blob): Promise<void> {
  const entry: Stored = { blob, addedAt: Date.now() };
  if (!(await open())) memory.set(key, entry);
  else await tx('readwrite', (s) => s.put(entry, key));
}

export async function getFile(key: string): Promise<Blob | undefined> {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory.blob;
  try {
    const entry = (await tx('readonly', (s) => s.get(key))) as Stored | undefined;
    return entry?.blob;
  } catch {
    return undefined;
  }
}

export async function deleteFile(key: string): Promise<void> {
  memory.delete(key);
  await tx('readwrite', (s) => s.delete(key)).catch(() => undefined);
}

export async function clearFiles(): Promise<void> {
  memory.clear();
  await tx('readwrite', (s) => s.clear()).catch(() => undefined);
}

const HOUR = 60 * 60 * 1000;

/** Drop contents no record points at. Fresh ones stay: another tab may be saving its record. */
export async function dropOrphans(keys: readonly string[]): Promise<void> {
  try {
    const all = (await tx('readonly', (s) => s.getAllKeys())) ?? [];
    for (const key of all) {
      if (typeof key !== 'string' || keys.includes(key)) continue;
      const entry = (await tx('readonly', (s) => s.get(key))) as Stored | undefined;
      if (entry && Date.now() - entry.addedAt > HOUR) await deleteFile(key);
    }
  } catch {
    /* it only frees space */
  }
}

const PHOTO = /\.(jpe?g|png|webp)$/i;
const SHRINK_FROM = 1024 * 1024;
const MAX_SIDE = 2000;

/** Photos above 1 MB are made smaller (and lose what the camera wrote into them, like GPS). */
export async function shrinkPhoto(file: File): Promise<{ name: string; blob: Blob }> {
  const same = { name: file.name, blob: file as Blob };
  if (!PHOTO.test(file.name) || file.size <= SHRINK_FROM || !globalThis.createImageBitmap)
    return same;
  try {
    const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * k));
    canvas.height = Math.max(1, Math.round(img.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) return same;
    // a transparent plan would turn black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return same;
    return { name: file.name.replace(PHOTO, '.jpg'), blob };
  } catch {
    // not a real picture: the limits decide
    return same;
  }
}
