import type { Stop, TransitLeg, TransitStep, WalkingLeg } from './domain.ts';

export type TransportCode = 'unconfigured' | 'unsupported' | 'quota' | 'upstream' | 'offline' | 'invalid';
export class TransportError extends Error {
  code: TransportCode;
  constructor(code: TransportCode, message: string) { super(message); this.code = code; }
}
export interface BusStation { id: string; name: string; region: 'seoul' | 'gyeonggi'; number?: string; distance?: number }
export interface BusArrival { route: string; direction: string; first: string; second: string; stopsAway?: number }
export interface BusResult { arrivals: BusArrival[]; fetchedAt: string; providerTime?: string; source: string }
export interface TransitOption extends TransitLeg { id: string }
export interface TransitRouteResult { options: TransitOption[]; fetchedAt: string; source: string; mapAllowed: boolean }
export interface TransitLiveResult {
  stationName: string; stationNumber?: string; route: string;
  matched: BusArrival[]; others: BusArrival[]; fetchedAt: string; source: string;
}
export interface TransportStatus {
  walking: boolean; walkingMap: boolean;
  transit: boolean; transitMap: boolean;
  seoul: boolean; gyeonggi: boolean; subway: boolean;
}
const cache = new Map<string, { until: number; data: unknown }>();
// Explicit actions only. No background polling, retries, or geolocation requests.
export async function transportRequest<T>(params: Record<string, string>, signal: AbortSignal, ttl = 30000): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const hit = cache.get(query);
  if (hit && hit.until > Date.now()) return hit.data as T;
  if (!navigator.onLine) throw new TransportError('offline', '오프라인이에요. 연결 후 다시 조회하세요.');
  const timeout = AbortSignal.timeout(12000);
  let response: Response;
  try { response = await fetch(`/api/transport?${query}`, { signal: AbortSignal.any([signal, timeout]), cache: 'no-store' }); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new TransportError('upstream', '조회하지 못했어요. 잠시 후 다시 시도하세요.');
  }
  let body: { data?: T; code?: TransportCode; message?: string };
  try { body = await response.json(); } catch { throw new TransportError('upstream', '교통 서버에 연결하지 못했어요.'); }
  if (!response.ok || body.data === undefined) throw new TransportError(body.code || 'upstream', body.message || '정보를 가져오지 못했어요.');
  if (cache.size > 150) cache.clear();
  cache.set(query, { until: Date.now() + ttl, data: body.data });
  return body.data;
}
export const coordinates = (s: Stop) => ({ lng: String(s.lng), lat: String(s.lat) });
export const walkingParams = (a: Stop, b: Stop) => ({ action: 'walk', lng: String(a.lng), lat: String(a.lat), toLng: String(b.lng), toLat: String(b.lat) });
export const transitParams = (a: Stop, b: Stop) => ({ action: 'transit', lng: String(a.lng), lat: String(a.lat), toLng: String(b.lng), toLat: String(b.lat) });
export type WalkingResult = WalkingLeg & { source: string; mapAllowed: boolean };
export function firstTransitStep(leg: TransitLeg | undefined): TransitStep | undefined {
  return leg?.steps.find(s => s.mode === 'bus' || s.mode === 'subway');
}
export function transitLiveParams(step: TransitStep, fallback: Stop, region: 'seoul' | 'gyeonggi'): Record<string, string> {
  return {
    action: 'transit-live',
    mode: step.mode,
    region,
    route: step.route || '',
    stationName: step.from || '',
    direction: step.to || '',
    ...(step.stationId ? { station: step.stationId } : {}),
    lng: String(step.fromLng ?? fallback.lng ?? ''),
    lat: String(step.fromLat ?? fallback.lat ?? ''),
  };
}
export function normalizeRouteName(raw: string): string {
  return raw.trim()
    .replace(/^(수도권|서울|경기|인천|간선|지선|광역|순환|마을|심야|직행좌석|일반|좌석|급행)[\s:·-]*/g, '')
    .replace(/(번|버스|호선)$/g, m => m === '호선' ? '호선' : '')
    .replace(/\s+/g, '')
    .toUpperCase();
}
export function arrivalFresh(result: { fetchedAt: string }, now = Date.now()): boolean {
  return now - Date.parse(result.fetchedAt) < 60000;
}
export function naverDirections(from: Stop, to: Stop): string {
  return `https://map.naver.com/p/directions/-/-/-/transit?c=15.00,0,0,0,dh&start=${encodeURIComponent(from.name)}&goal=${encodeURIComponent(to.name)}`;
}
export function kakaoDirections(from: Stop, to: Stop): string {
  if (from.lat !== null && from.lng !== null && to.lat !== null && to.lng !== null) {
    return `https://map.kakao.com/link/from/${encodeURIComponent(from.name || '출발')},${from.lat},${from.lng}/to/${encodeURIComponent(to.name || '도착')},${to.lat},${to.lng}`;
  }
  return `https://map.kakao.com/link/to/${encodeURIComponent(to.name || '도착')},${to.lat},${to.lng}`;
}
