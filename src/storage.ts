import { parseLibrary, validLibrary, type Route } from './domain.ts';
import { seedRoutes } from './data.ts';
export const STORAGE_KEY = 'dayroute.library.v1';
export function loadRoutes(): { routes: Route[]; raw: string | null | undefined; error?: string } {
  let raw: string | null | undefined;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return { routes: raw === null ? seedRoutes() : parseLibrary(raw).routes, raw };
  } catch {
    return { routes: [], raw, error: '저장된 코스를 읽지 못했어요. 기존 데이터는 덮어쓰지 않았어요. 백업을 확인해 주세요.' };
  }
}
export function saveRoutes(routes: Route[], expected: string | null | undefined):
  { ok: true; raw: string } | { ok: false; reason: 'conflict' | 'invalid' | 'unavailable' } {
  try {
    const library = { schemaVersion: 1, routes };
    if (!validLibrary(library)) return { ok: false, reason: 'invalid' };
    const raw = JSON.stringify(library);
    if (new TextEncoder().encode(raw).length > 5_000_000) return { ok: false, reason: 'invalid' };
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous !== expected) return { ok: false, reason: 'conflict' };
    if (raw !== previous) localStorage.setItem(STORAGE_KEY, raw);
    return { ok: true, raw };
  }
  catch { return { ok: false, reason: 'unavailable' }; }
}
export function downloadBackup(routes: Route[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, routes }, null, 2)], { type: 'application/json' }));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a'); a.href = url; a.download = `dayroute-${date}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
