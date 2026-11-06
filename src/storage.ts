import { parseLibrary, type Route } from './domain.ts';
import { seedRoutes } from './data.ts';
export const STORAGE_KEY = 'dayroute.library.v1';
export function loadRoutes(): { routes: Route[]; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return { routes: raw ? parseLibrary(raw).routes : seedRoutes() };
  } catch {
    return { routes: [], error: '저장된 코스를 읽지 못했어요. 기존 데이터는 덮어쓰지 않았어요. 백업을 확인해 주세요.' };
  }
}
export function persistRoutes(routes: Route[]): boolean {
  try {
    const raw = JSON.stringify({ schemaVersion: 1, routes });
    if (new TextEncoder().encode(raw).length > 5_000_000) return false;
    parseLibrary(raw);
    localStorage.setItem(STORAGE_KEY, raw); return true;
  }
  catch { return false; }
}
export function downloadBackup(routes: Route[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, routes }, null, 2)], { type: 'application/json' }));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a'); a.href = url; a.download = `dayroute-${date}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
