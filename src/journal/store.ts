// store: the journal's pages, kept in IndexedDB.
//
// A page's scan bytes are large and never change, so they live in their own
// object store; listing the pages for the scrapbook only reads the small
// records (title, date, notes, cover). Songs sit in a third store, same idea.
// If IndexedDB is unavailable (some private modes), everything is kept in
// memory for this visit instead.

export type Vec3 = [number, number, number];
export type NoteStyle = "pencil" | "whisper";
export type InkColor = "black" | "white";
export type LineFeel = "still" | "breathing" | "sketchy";
export interface StoredNote { id: string; p: Vec3; text: string; strokes: number[][][] | null; style?: NoteStyle; scale?: number; reach?: number; color?: InkColor }
export interface StoredDoodle { pts: Vec3[]; d: number; color?: InkColor }
export interface PageRecord {
  id: string;
  number: number;      // 1, 2, 3… in order of creation, never reused
  title: string;
  date: string;
  notes: StoredNote[];
  doodles: StoredDoodle[];
  flipped: boolean;
  cover: Blob | null;  // a small JPEG of the print, taken in the page
  label: string;       // the scan's file name, which tells the loader its format
  song: string | null; // audio file name, if this page has a song; bytes live in "songs"
  start?: Vec3;        // where the camera first stands, if the scan came with one
  target?: Vec3;
  created: number;
}
export interface Page extends PageRecord { scanBytes: Uint8Array }

const DB = "splat-journal", VERSION = 2;
let dbp: Promise<IDBDatabase | null> | null = null;
const memory = {
  pages: new Map<string, PageRecord>(),
  scans: new Map<string, Uint8Array>(),
  songs: new Map<string, Uint8Array>(),
  lines: "breathing" as LineFeel,
  last: 0,
};

export function normalizeLineFeel(v: unknown): LineFeel {
  return v === "still" || v === "sketchy" ? v : "breathing";
}

function open(): Promise<IDBDatabase | null> {
  dbp ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("pages")) db.createObjectStore("pages", { keyPath: "id" });
        if (!db.objectStoreNames.contains("scans")) db.createObjectStore("scans");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const result = <T>(req: IDBRequest<T>) => new Promise<T>((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** every page's record (no scan bytes), in page-number order */
export async function listPages(): Promise<PageRecord[]> {
  const db = await open();
  const all = db ? await result(db.transaction("pages").objectStore("pages").getAll() as IDBRequest<PageRecord[]>) : [...memory.pages.values()];
  return all.sort((a, b) => a.number - b.number);
}

export async function getPage(id: string): Promise<Page | null> {
  const db = await open();
  if (!db) {
    const rec = memory.pages.get(id), scan = memory.scans.get(id);
    return rec && scan ? { ...rec, scanBytes: scan } : null;
  }
  const tx = db.transaction(["pages", "scans"]);
  const [rec, scan] = await Promise.all([
    result(tx.objectStore("pages").get(id) as IDBRequest<PageRecord | undefined>),
    result(tx.objectStore("scans").get(id) as IDBRequest<Uint8Array | undefined>),
  ]);
  return rec && scan ? { ...rec, song: rec.song ?? null, scanBytes: scan } : null;
}

/** a new page, numbered after every page there has ever been */
export async function createPage(init: Omit<PageRecord, "id" | "number" | "created" | "cover" | "song"> & { scanBytes: Uint8Array; song?: string | null }): Promise<PageRecord> {
  const { scanBytes, ...rest } = init;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const db = await open();
  if (!db) {
    const rec: PageRecord = { ...rest, id, number: ++memory.last, created: Date.now(), cover: null, song: rest.song ?? null };
    memory.pages.set(id, rec); memory.scans.set(id, scanBytes);
    return rec;
  }
  const tx = db.transaction(["pages", "scans", "meta"], "readwrite");
  const meta = tx.objectStore("meta");
  const last = ((await result(meta.get("lastNumber") as IDBRequest<number | undefined>)) || 0);
  const rec: PageRecord = { ...rest, id, number: last + 1, created: Date.now(), cover: null, song: rest.song ?? null };
  meta.put(rec.number, "lastNumber");
  tx.objectStore("pages").put(rec);
  tx.objectStore("scans").put(scanBytes, id);
  await done(tx);
  return rec;
}

/** write a page's record (title, notes, doodles, flip, cover, song name); the scan is left alone */
export async function savePage(rec: PageRecord): Promise<void> {
  const db = await open();
  if (!db) { memory.pages.set(rec.id, rec); return; }
  const tx = db.transaction("pages", "readwrite");
  tx.objectStore("pages").put(rec);
  await done(tx);
}

export async function deletePage(id: string): Promise<void> {
  const db = await open();
  if (!db) { memory.pages.delete(id); memory.scans.delete(id); memory.songs.delete(id); return; }
  const tx = db.transaction(["pages", "scans", "songs"], "readwrite");
  tx.objectStore("pages").delete(id);
  tx.objectStore("scans").delete(id);
  tx.objectStore("songs").delete(id);
  await done(tx);
}

export async function getLines(): Promise<LineFeel> {
  const db = await open();
  if (!db) return memory.lines;
  const tx = db.transaction("meta", "readwrite");
  const meta = tx.objectStore("meta");
  const defaultApplied = await result(meta.get("breathingDefaultV1") as IDBRequest<boolean | undefined>);
  if (!defaultApplied) {
    // Start existing installs in breathing once, then keep any mode the user chooses.
    meta.put("breathing", "lines");
    meta.put(true, "breathingDefaultV1");
    await done(tx);
    return "breathing";
  }
  const v = await result(meta.get("lines") as IDBRequest<unknown>);
  await done(tx);
  return normalizeLineFeel(v);
}

export async function setLines(feel: LineFeel): Promise<void> {
  const next = normalizeLineFeel(feel);
  const db = await open();
  if (!db) { memory.lines = next; return; }
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(next, "lines");
  await done(tx);
}

export async function getSong(id: string): Promise<Uint8Array | null> {
  const db = await open();
  if (!db) return memory.songs.get(id) ?? null;
  return (await result(db.transaction("songs").objectStore("songs").get(id) as IDBRequest<Uint8Array | undefined>)) ?? null;
}

export async function saveSong(id: string, bytes: Uint8Array): Promise<void> {
  const db = await open();
  if (!db) { memory.songs.set(id, bytes); return; }
  const tx = db.transaction("songs", "readwrite");
  tx.objectStore("songs").put(bytes, id);
  await done(tx);
}

export async function deleteSong(id: string): Promise<void> {
  const db = await open();
  if (!db) { memory.songs.delete(id); return; }
  const tx = db.transaction("songs", "readwrite");
  tx.objectStore("songs").delete(id);
  await done(tx);
}

// ---------- the old localStorage notes, read once and then cleared ----------
interface LegacyPage { title?: string; flipped?: boolean; notes?: StoredNote[]; doodles?: StoredDoodle[]; date?: string }
/** notes saved by the earlier, localStorage-only journal under `sj:<key>`; removed once read */
export function takeLegacy(key: string): LegacyPage | null {
  try {
    const raw = localStorage.getItem("sj:" + key);
    if (!raw) return null;
    localStorage.removeItem("sj:" + key);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
