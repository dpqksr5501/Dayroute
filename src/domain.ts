export type Category = '식사' | '카페' | '산책' | '문화' | '쇼핑' | '기타';
export type TravelMode = 'walk' | 'car' | 'transit';
export type TransitStepMode = 'walk' | 'bus' | 'subway' | 'train';
export type Theme = 'forest' | 'town' | 'river';
export const MAX_COVER_LENGTH = 180_000;
export interface Stop {
  id: string; name: string; category: Category; address: string; note: string;
  lng: number | null; lat: number | null; duration: number; travelMinutes: number;
  mode: TravelMode; cost: number; reserved: boolean;
  walking?: WalkingLeg;
  transit?: TransitLeg;
}
export interface WalkingLeg {
  key: string; minutes: number; meters: number; fetchedAt: string;
  coordinates: [number, number][];
}
export interface TransitStep {
  mode: TransitStepMode; minutes: number; meters?: number;
  route?: string; from?: string; to?: string; stationId?: string;
  fromLng?: number; fromLat?: number; stops?: number;
}
export interface TransitLeg {
  key: string; summary: string; minutes: number; transfers: number;
  walkMinutes: number; fare?: number; fetchedAt: string;
  steps: TransitStep[]; coordinates: [number, number][];
}
export interface Route {
  id: string; title: string; description: string; region: string; date: string;
  startTime: string; theme: Theme; favorite: boolean; stops: Stop[]; updatedAt: string;
  coverPhoto?: string;
}
export interface Library { schemaVersion: 1; routes: Route[] }
export const uid = () => crypto.randomUUID();
export const makeStop = (values: Partial<Stop> = {}): Stop => ({
  id: uid(), name: '', category: '기타', address: '', note: '', lng: null, lat: null,
  duration: 60, travelMinutes: 15, mode: 'walk', cost: 0, reserved: false, ...values,
});
export const makeRoute = (): Route => ({
  id: uid(), title: '새로운 하루', description: '', region: '서울', date: '',
  startTime: '12:00', theme: 'forest', favorite: false, stops: [], updatedAt: new Date().toISOString(),
});
export function cloneRoute(route: Route): Route {
  return { ...copyRoute(route), title: `${route.title.slice(0, 95)} (복사)`, date: '', favorite: false };
}
// Import/share are snapshots, while duplication starts a new day.
export function copyRoute(route: Route): Route {
  return { ...structuredClone(route), id: uid(), updatedAt: new Date().toISOString(),
    stops: route.stops.map(s => ({ ...structuredClone(s), id: uid() })) };
}
export function walkingKey(from: Stop, to: Stop): string {
  return `${from.lng},${from.lat}>${to.lng},${to.lat}`;
}
export function walkingFor(from: Stop, to: Stop | undefined): WalkingLeg | undefined {
  return to && from.mode === 'walk' && hasCoordinates(from) && hasCoordinates(to)
    && from.walking?.key === walkingKey(from, to) ? from.walking : undefined;
}
export function transitFor(from: Stop, to: Stop | undefined): TransitLeg | undefined {
  return to && from.mode === 'transit' && hasCoordinates(from) && hasCoordinates(to)
    && from.transit?.key === walkingKey(from, to) ? from.transit : undefined;
}
export function legMinutes(route: Route, index: number): number {
  const from = route.stops[index], to = route.stops[index + 1];
  return walkingFor(from, to)?.minutes ?? transitFor(from, to)?.minutes ?? from.travelMinutes;
}
export function totalMinutes(route: Route): number {
  return route.stops.reduce((total, s, i) => total + s.duration + (i < route.stops.length - 1 ? legMinutes(route, i) : 0), 0);
}
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}시간 ` : ''}${minutes % 60 ? `${minutes % 60}분` : ''}`.trim() || '0분';
}
function clockLabel(cursor: number): string {
  const day = Math.floor(cursor / 1440);
  return `${day ? `+${day}일 ` : ''}${String(Math.floor(cursor / 60) % 24).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
}
export function schedule(route: Route, departure = false): string[] {
  const [h, m] = route.startTime.split(':').map(Number);
  let cursor = h * 60 + m;
  return route.stops.map((s, i) => {
    const label = clockLabel(cursor + (departure ? s.duration : 0));
    cursor += s.duration + legMinutes(route, i);
    return label;
  });
}
export function hasCoordinates(s: Stop): s is Stop & { lat: number; lng: number } {
  return s.lat !== null && s.lng !== null && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}
export function directDistance(stops: Stop[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (!hasCoordinates(a) || !hasCoordinates(b)) continue;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const d = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    total += 6371 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(Math.max(0, 1 - d)));
  }
  return total;
}
const str = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validCoverPhoto(value: unknown): value is string {
  if (!str(value, MAX_COVER_LENGTH) || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try { const header = atob(value.slice('data:image/webp;base64,'.length, 'data:image/webp;base64,'.length + 24));
    return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  } catch { return false; }
}
export function validStop(v: unknown): v is Stop {
  return obj(v) && str(v.id, 100) && str(v.name, 100) && str(v.address, 300) && str(v.note, 2000)
    && ['식사', '카페', '산책', '문화', '쇼핑', '기타'].includes(v.category as string)
    && ['walk', 'car', 'transit'].includes(v.mode as string)
    && ((v.lng === null && v.lat === null) || (num(v.lng, -180, 180) && num(v.lat, -85, 85)))
    && num(v.duration, 0, 1440) && num(v.travelMinutes, 0, 1440) && num(v.cost, 0, 100000000)
    && typeof v.reserved === 'boolean' && (v.walking === undefined || validWalking(v.walking))
    && (v.transit === undefined || validTransit(v.transit));
}
export function validWalking(v: unknown): v is WalkingLeg {
  return obj(v) && str(v.key, 150) && num(v.minutes, 0, 1440) && Number.isInteger(v.minutes)
    && num(v.meters, 0, 200000) && str(v.fetchedAt, 50) && Number.isFinite(Date.parse(v.fetchedAt))
    && Array.isArray(v.coordinates) && (v.coordinates.length === 0 || v.coordinates.length >= 2) && v.coordinates.length <= 12000
    && v.coordinates.every(p => Array.isArray(p) && p.length === 2 && num(p[0], -180, 180) && num(p[1], -85, 85));
}
export function validTransitStep(v: unknown): v is TransitStep {
  return obj(v) && ['walk', 'bus', 'subway', 'train'].includes(v.mode as string)
    && num(v.minutes, 0, 1440) && Number.isInteger(v.minutes)
    && (v.meters === undefined || num(v.meters, 0, 500000))
    && (v.route === undefined || str(v.route, 80)) && (v.from === undefined || str(v.from, 100))
    && (v.to === undefined || str(v.to, 100)) && (v.stationId === undefined || str(v.stationId, 50))
    && (v.fromLng === undefined || num(v.fromLng, -180, 180)) && (v.fromLat === undefined || num(v.fromLat, -85, 85))
    && (v.stops === undefined || (num(v.stops, 0, 300) && Number.isInteger(v.stops)));
}
export function validTransit(v: unknown): v is TransitLeg {
  return obj(v) && str(v.key, 150) && str(v.summary, 160)
    && num(v.minutes, 0, 1440) && Number.isInteger(v.minutes)
    && num(v.transfers, 0, 20) && Number.isInteger(v.transfers)
    && num(v.walkMinutes, 0, 1440) && Number.isInteger(v.walkMinutes)
    && (v.fare === undefined || (num(v.fare, 0, 500000) && Number.isInteger(v.fare)))
    && str(v.fetchedAt, 50) && Number.isFinite(Date.parse(v.fetchedAt))
    && Array.isArray(v.steps) && v.steps.length >= 1 && v.steps.length <= 30 && v.steps.every(validTransitStep)
    && Array.isArray(v.coordinates) && (v.coordinates.length === 0 || v.coordinates.length >= 2) && v.coordinates.length <= 12000
    && v.coordinates.every(p => Array.isArray(p) && p.length === 2 && num(p[0], -180, 180) && num(p[1], -85, 85));
}
export function validRoute(v: unknown): v is Route {
  return obj(v) && str(v.id, 100) && str(v.title, 100) && str(v.description, 1000) && str(v.region, 100)
    && str(v.date, 10) && (v.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(v.date))
    && str(v.startTime, 5) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.startTime)
    && ['forest', 'town', 'river'].includes(v.theme as string) && typeof v.favorite === 'boolean'
    && (v.coverPhoto === undefined || validCoverPhoto(v.coverPhoto))
    && str(v.updatedAt, 50) && Number.isFinite(Date.parse(v.updatedAt))
    && Array.isArray(v.stops) && v.stops.length <= 100 && v.stops.every(validStop)
    && new Set(v.stops.map(s => s.id)).size === v.stops.length;
}
export function parseLibrary(raw: string): Library {
  if (raw.length > 5_000_000) throw new Error('파일은 5MB 이하여야 해요.');
  const v: unknown = JSON.parse(raw);
  if (!obj(v) || v.schemaVersion !== 1 || !Array.isArray(v.routes) || v.routes.length > 500 || !v.routes.every(validRoute)
    || new Set(v.routes.map(r => r.id)).size !== v.routes.length) throw new Error('지원하는 Dayroute 백업 파일이 아니에요.');
  return v as unknown as Library;
}
export function encodeShare(route: Route): string {
  const snapshot = { ...route }; delete snapshot.coverPhoto;
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return btoa(Array.from(bytes, x => String.fromCharCode(x)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeShare(raw: string): Route {
  if (raw.length > 100_000) throw new Error('공유 코스가 너무 커요.');
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const route: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized), x => x.charCodeAt(0))));
  if (!validRoute(route)) throw new Error('올바른 공유 코스가 아니에요.');
  return route;
}
export function routeText(route: Route): string {
  const times = schedule(route);
  return `${route.title}\n${route.date || '날짜 미정'} · ${route.region}\n${route.description}\n\n` + route.stops.map((s, i) => {
    const next = route.stops[i + 1], walk = walkingFor(s, next), transit = transitFor(s, next);
    const legSource = walk ? 'TMAP 도보 예상' : transit ? `대중교통: ${transit.summary}` : '직접 설정';
    return `${times[i]} ${i + 1}. ${s.name}\n${s.address}${s.note ? `\n${s.note}` : ''}${i < route.stops.length - 1 ? `\n다음 장소까지 ${legMinutes(route, i)}분 (${legSource})` : ''}`;
  }).join('\n\n');
}
