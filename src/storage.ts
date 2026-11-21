import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { parseLibrary, validRoute, type Route } from './domain.ts';
import { seedRoutes } from './data.ts';
export const STORAGE_KEY = 'dayroute.library.v1';
const LIBRARY_LIMIT = 5_000_000;
const encoder = new TextEncoder();
const envelopeBytes = encoder.encode('{"schemaVersion":1,"routes":[]}').length;
export const LIBRARY_READ_ERROR = '저장된 코스를 읽지 못했어요. 기존 데이터는 덮어쓰지 않았어요. 백업을 확인해 주세요.';

interface LibraryState {
  revision: string;
  entries: { id: string; bytes: number }[];
}
interface RouteDB extends DBSchema {
  routes: { key: string; value: Route };
  state: { key: 'library'; value: LibraryState };
}
export interface LibrarySnapshot {
  routes: Route[];
  revision: string | null;
  legacyRaw?: string | null;
  error?: string;
}
export type SaveResult = { ok: true; revision: string }
  | { ok: false; reason: 'conflict' | 'invalid' | 'unavailable' };

let connection: Promise<IDBPDatabase<RouteDB>> | undefined;
function database() {
  connection ??= openDB<RouteDB>('dayroute', 1, {
    upgrade(db) {
      db.createObjectStore('routes', { keyPath: 'id' });
      db.createObjectStore('state');
    },
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      connection = undefined;
    },
    terminated() { connection = undefined; },
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

function loadLegacy(): LibrarySnapshot {
  let raw: string | null | undefined;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return { routes: raw === null ? seedRoutes() : parseLibrary(raw).routes, revision: null, legacyRaw: raw };
  } catch {
    return { routes: [], revision: null, legacyRaw: raw, error: LIBRARY_READ_ERROR };
  }
}

export async function loadRoutes(): Promise<LibrarySnapshot> {
  let db: IDBPDatabase<RouteDB>;
  try {
    db = await database();
  } catch {
    return { ...loadLegacy(), error: LIBRARY_READ_ERROR };
  }
  try {
    const tx = db.transaction(['state', 'routes']);
    const state = await tx.objectStore('state').get('library');
    if (!state) { await tx.done; return loadLegacy(); }
    const saved = new Map((await tx.objectStore('routes').getAll()).map(route => [route.id, route]));
    await tx.done;
    const routes = state.entries.map(entry => saved.get(entry.id));
    if (!routes.every(validRoute)) throw new Error(LIBRARY_READ_ERROR);
    return { routes, revision: state.revision };
  } catch {
    return { routes: [], revision: null, error: LIBRARY_READ_ERROR };
  }
}

export async function saveRoutes(routes: Route[], previous: LibrarySnapshot): Promise<SaveResult> {
  const ids = new Set(routes.map(route => route.id));
  if (routes.length > 500 || ids.size !== routes.length) return { ok: false, reason: 'invalid' };
  const existing = new Map(previous.routes.map(route => [route.id, route]));
  const changes = new Map<string, { route: Route; bytes: number }>();
  for (const route of routes) {
    if (previous.revision !== null && existing.get(route.id) === route) continue;
    if (!validRoute(route)) return { ok: false, reason: 'invalid' };
    changes.set(route.id, { route, bytes: encoder.encode(JSON.stringify(route)).length });
  }
  let abort: (() => void) | undefined;
  try {
    const db = await database();
    const tx = db.transaction(['state', 'routes'], 'readwrite');
    abort = () => tx.abort();
    // Observe both the transaction and individual request failures.
    void tx.done.catch(() => {});
    const stateStore = tx.objectStore('state');
    const state = await stateStore.get('library');
    const legacyChanged = !state && localStorage.getItem(STORAGE_KEY) !== previous.legacyRaw;
    if ((state?.revision ?? null) !== previous.revision || legacyChanged) {
      await tx.done;
      return { ok: false, reason: 'conflict' };
    }
    const savedSizes = new Map(state?.entries.map(entry => [entry.id, entry.bytes]));
    const entries = routes.map(route => ({ id: route.id, bytes: changes.get(route.id)?.bytes ?? savedSizes.get(route.id) ?? NaN }));
    const bytes = entries.reduce((total, entry) => total + entry.bytes, envelopeBytes + Math.max(0, entries.length - 1));
    if (!Number.isFinite(bytes) || bytes > LIBRARY_LIMIT) { await tx.done; return { ok: false, reason: 'invalid' }; }
    const removed = state?.entries.filter(entry => !ids.has(entry.id)) ?? [];
    if (state && !changes.size && !removed.length && entries.every((entry, i) => state.entries[i]?.id === entry.id)) {
      await tx.done;
      return { ok: true, revision: state.revision };
    }
    const revision = crypto.randomUUID();
    const store = tx.objectStore('routes');
    await Promise.all([
      ...removed.map(entry => store.delete(entry.id)),
      ...Array.from(changes.values(), change => store.put(change.route)),
      stateStore.put({ revision, entries }, 'library'),
      tx.done,
    ]);
    return { ok: true, revision };
  }
  catch {
    try { abort?.(); } catch { /* The database already ended the transaction. */ }
    return { ok: false, reason: 'unavailable' };
  }
}
export function downloadBackup(routes: Route[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, routes }, null, 2)], { type: 'application/json' }));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a'); a.href = url; a.download = `dayroute-${date}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
