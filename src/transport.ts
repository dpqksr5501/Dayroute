import type { Category, Stop, TransitLeg, TransitStep, WalkingLeg } from './domain.ts';

export type TransportCode = 'unconfigured' | 'unsupported' | 'quota' | 'upstream' | 'offline' | 'invalid';
export class TransportError extends Error {
  code: TransportCode;
  constructor(code: TransportCode, message: string) { super(message); this.code = code; }
}
export interface BusStation { id: string; name: string; region: 'seoul' | 'gyeonggi'; number?: string; distance?: number; lng?: number; lat?: number }
export interface BusArrival { route: string; direction: string; first: string; second: string; stopsAway?: number }
export interface BusResult { arrivals: BusArrival[]; fetchedAt: string; providerTime?: string; source: string }
export interface PoiItem { id: string; name: string; address: string; category: Category; lng: number; lat: number }
export interface TransitOption extends TransitLeg { id: string }
export interface TransitRouteResult { options: TransitOption[]; fetchedAt: string; source: string; mapAllowed: boolean; nearby?: true }
export interface TransitLiveResult {
  stationName: string; stationNumber?: string; route: string;
  matched: BusArrival[]; others: BusArrival[]; fetchedAt: string; source: string;
}
export interface TransportStatus {
  walking: boolean; walkingMap: boolean;
  car: boolean; pois: boolean;
  transit: boolean; transitMap: boolean;
  seoul: boolean; gyeonggi: boolean; subway: boolean;
}
const cache = new Map<string, { until: number; data: unknown }>();
interface PendingTransport {
  controller: AbortController;
  response: Promise<unknown>;
  subscribers: number;
}
const inflight = new Map<string, PendingTransport>();
const cacheLifetimes: Record<string, number> = {
  walk: 3600000, car: 3600000, 'reverse-geocode': 3600000,
  transit: 1800000, pois: 1800000, stations: 300000,
};

async function loadTransport(query: string, signal: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(12000);
  let response: Response;
  try { response = await fetch(`/api/transport?${query}`, { signal: AbortSignal.any([signal, timeout]), cache: 'no-store' }); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new TransportError('upstream', '조회하지 못했어요. 잠시 후 다시 시도하세요.');
  }
  let body: { data?: unknown; code?: TransportCode; message?: string };
  try { body = await response.json(); } catch { throw new TransportError('upstream', '교통 서버에 연결하지 못했어요.'); }
  if (!response.ok || body.data === undefined) throw new TransportError(body.code || 'upstream', body.message || '정보를 가져오지 못했어요.');
  return body.data;
}

export async function transportRequest<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const search = new URLSearchParams(params);
  search.sort();
  const query = search.toString();
  const hit = cache.get(query);
  if (hit && hit.until > Date.now()) return hit.data as T;
  if (!navigator.onLine) throw new TransportError('offline', '오프라인이에요. 연결 후 다시 조회하세요.');

  let request = inflight.get(query);
  if (!request) {
    const controller = new AbortController();
    const ttl = cacheLifetimes[params.action] ?? 30000;
    const response = loadTransport(query, controller.signal).then(data => {
      controller.signal.throwIfAborted();
      cache.delete(query);
      if (cache.size >= 150) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(query, { until: Date.now() + ttl, data });
      return data;
    }).finally(() => {
      if (inflight.get(query)?.controller === controller) inflight.delete(query);
    });
    request = { controller, response, subscribers: 0 };
    inflight.set(query, request);
  }

  request.subscribers++;
  let onAbort: () => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([request.response, cancellation]) as T;
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (--request.subscribers === 0 && inflight.get(query) === request) {
      inflight.delete(query);
      request.controller.abort();
    }
  }
}
export const coordinates = (s: Stop) => ({ lng: String(s.lng), lat: String(s.lat) });
export const walkingParams = (a: Stop, b: Stop) => ({ action: 'walk', lng: String(a.lng), lat: String(a.lat), toLng: String(b.lng), toLat: String(b.lat) });
export const carParams = (a: Stop, b: Stop) => ({ action: 'car', lng: String(a.lng), lat: String(a.lat), toLng: String(b.lng), toLat: String(b.lat) });
export const transitParams = (a: Stop, b: Stop) => ({ action: 'transit', lng: String(a.lng), lat: String(a.lat), toLng: String(b.lng), toLat: String(b.lat) });
export const poiParams = (q: string) => ({ action: 'pois', q: q.trim() });
export const reverseGeocodeParams = (lng: number, lat: number) => ({ action: 'reverse-geocode', lng: String(lng), lat: String(lat) });
export type WalkingResult = WalkingLeg & { source: string; mapAllowed: boolean; taxiFare?: number };
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
    ...(step.fromLng !== undefined && step.fromLat !== undefined ? { stationPoint: 'true' } : {}),
    lng: String(step.fromLng ?? fallback.lng ?? ''),
    lat: String(step.fromLat ?? fallback.lat ?? ''),
  };
}
export function transitLiveRegion(step: TransitStep, fallback: Stop, routeRegion?: string): 'seoul' | 'gyeonggi' {
  if (/^\d{5}$/.test(step.stationId ?? '')) return 'seoul';
  if (/^\d{9}$/.test(step.stationId ?? '')) return 'gyeonggi';
  const lng = step.fromLng ?? fallback.lng, lat = step.fromLat ?? fallback.lat;
  if (lng === null || lat === null) return routeRegion?.includes('경기') ? 'gyeonggi' : 'seoul';
  return lng >= 126.76 && lng <= 127.19 && lat >= 37.42 && lat <= 37.70 ? 'seoul' : 'gyeonggi';
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
