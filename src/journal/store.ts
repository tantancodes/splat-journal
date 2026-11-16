// store: the journal's pages, kept in IndexedDB.
//
// A page's scan bytes are large and never change, so they live in their own
// object store; listing the pages for the scrapbook only reads the small
// records (title, date, notes, cover). If IndexedDB is unavailable (some
// private modes), everything is kept in memory for this visit instead.

export type Vec3 = [number, number, number];
export interface StoredNote { id: string; p: Vec3; text: string; strokes: number[][][] | null; style?: "thought" | "line"; scale?: number }
export interface StoredDoodle { pts: Vec3[]; d: number }
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
  start?: Vec3;        // where the camera first stands, if the scan came with one
  target?: Vec3;
  created: number;
}
export interface Page extends PageRecord { scanBytes: Uint8Array }

const DB = "splat-journal", VERSION = 1;
let dbp: Promise<IDBDatabase | null> | null = null;
const memory = { pages: new Map<string, PageRecord>(), scans: new Map<string, Uint8Array>(), last: 0 };

function open(): Promise<IDBDatabase | null> {
  dbp ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("pages", { keyPath: "id" });
        db.createObjectStore("scans");
        db.createObjectStore("meta");
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
  return rec && scan ? { ...rec, scanBytes: scan } : null;
}

/** a new page, numbered after every page there has ever been */
export async function createPage(init: Omit<PageRecord, "id" | "number" | "created" | "cover"> & { scanBytes: Uint8Array }): Promise<PageRecord> {
  const { scanBytes, ...rest } = init;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const db = await open();
  if (!db) {
    const rec: PageRecord = { ...rest, id, number: ++memory.last, created: Date.now(), cover: null };
    memory.pages.set(id, rec); memory.scans.set(id, scanBytes);
    return rec;
  }
  const tx = db.transaction(["pages", "scans", "meta"], "readwrite");
  const meta = tx.objectStore("meta");
  const last = ((await result(meta.get("lastNumber") as IDBRequest<number | undefined>)) || 0);
  const rec: PageRecord = { ...rest, id, number: last + 1, created: Date.now(), cover: null };
  meta.put(rec.number, "lastNumber");
  tx.objectStore("pages").put(rec);
  tx.objectStore("scans").put(scanBytes, id);
  await done(tx);
  return rec;
}

/** write a page's record (title, notes, doodles, flip, cover); the scan is left alone */
export async function savePage(rec: PageRecord): Promise<void> {
  const db = await open();
  if (!db) { memory.pages.set(rec.id, rec); return; }
  const tx = db.transaction("pages", "readwrite");
  tx.objectStore("pages").put(rec);
  await done(tx);
}

export async function deletePage(id: string): Promise<void> {
  const db = await open();
  if (!db) { memory.pages.delete(id); memory.scans.delete(id); return; }
  const tx = db.transaction(["pages", "scans"], "readwrite");
  tx.objectStore("pages").delete(id);
  tx.objectStore("scans").delete(id);
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
