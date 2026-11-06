import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  normalizeRouteName, TransportError,
  type BusArrival, type BusStation, type PoiItem, type TransitLiveResult, type TransitOption, type TransitRouteResult,
} from '../src/transport.ts';
import { validTransit, validWalking, type Category, type TransitStep, type TransitStepMode } from '../src/domain.ts';

type Env = Record<string, string | undefined>;
type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const list = (v: unknown): unknown[] => v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const str = (v: unknown) => v === undefined || v === null ? '' : String(v).slice(0, 200);
const cache = new Map<string, { until: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const budgets = new Map<string, number>();
const limits = new Map<string, { reset: number; count: number }>();

function consume(provider: string) {
  const day = new Date().toISOString().slice(0, 10), key = `${day}:${provider}`;
  for (const k of budgets.keys()) if (!k.startsWith(day)) budgets.delete(k);
  const cap = provider.startsWith('tmap') || provider === 'odsay' ? 500 : 1000;
  if ((budgets.get(key) || 0) >= cap) throw new TransportError('quota', '오늘 조회 한도에 도달했어요. 직접 설정한 시간으로 계획하세요.');
  budgets.set(key, (budgets.get(key) || 0) + 1);
}
function required(env: Env, name: string) {
  const key = env[name];
  if (!key) throw new TransportError('unconfigured', '아직 API가 연결되지 않았어요. 직접 입력한 계획 시간은 그대로 사용할 수 있어요.');
  return key;
}
function point(params: URLSearchParams, prefix = ''): [number, number] {
  const x = params.get(prefix ? 'toLng' : 'lng'), y = params.get(prefix ? 'toLat' : 'lat');
  if (!x || !y) throw new TransportError('invalid', '지도에서 장소 위치를 지정해 주세요.');
  const lng = Number(x), lat = Number(y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new TransportError('invalid', '장소 좌표를 확인해 주세요.');
  if (lng < 124 || lng > 132 || lat < 33 || lat > 39) throw new TransportError('unsupported', '한국 내 장소만 조회할 수 있어요.');
  return [lng, lat];
}
async function json(url: string, init: RequestInit, fetcher: typeof fetch) {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new TransportError(response.status === 429 ? 'quota' : 'upstream', response.status === 429 ? '조회 한도에 도달했어요. 잠시 후 다시 확인하세요.' : '제공처에서 응답을 받지 못했어요.');
  const value: unknown = await response.json();
  return record(value);
}
export function parseLinestring(raw: string): [number, number][] {
  if (!raw) return [];
  const points: [number, number][] = [];
  for (const token of raw.trim().split(/\s+/)) {
    const [x, y] = token.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = points[points.length - 1];
    if (!prev || prev[0] !== x || prev[1] !== y) points.push([x, y]);
  }
  return points;
}
export function parseTmap(body: RecordValue, key: string, mapAllowed: boolean) {
  const features = list(body.features).map(record);
  const props = record(features[0]?.properties);
  const seconds = Number(props.totalTime), meters = Number(props.totalDistance);
  const taxiFare = Number(props.taxiFare);
  const lines = features.filter(f => record(f.geometry).type === 'LineString');
  const coordinates = lines.flatMap(f => list(record(f.geometry).coordinates));
  const result = {
    key, minutes: Math.max(1, Math.ceil(seconds / 60)), meters, coordinates,
    fetchedAt: new Date().toISOString(), source: 'TMAP', mapAllowed,
    ...(Number.isFinite(taxiFare) && taxiFare > 0 ? { taxiFare: Math.round(taxiFare) } : {}),
  };
  if (!Number.isFinite(seconds) || !Number.isFinite(meters) || !validWalking(result)) throw new TransportError('upstream', '이 구간의 경로를 찾지 못했어요.');
  // Geometry is only returned when the operator has verified cross-map display rights.
  return mapAllowed ? result : { ...result, coordinates: [] };
}
function inferCategory(biz: string): Category {
  if (/카페|커피|베이커리|제과|디저트|찻집/.test(biz)) return '카페';
  if (/음식|식당|한식|중식|일식|양식|레스토랑|치킨|피자|분식|술집|주점|고기/.test(biz)) return '식사';
  if (/공원|산책|숲|해수욕장|수목원|자연|관광명소|유원지|하천/.test(biz)) return '산책';
  if (/영화|극장|박물관|미술관|전시|공연|문화|도서관|서점/.test(biz)) return '문화';
  if (/백화점|마트|쇼핑|시장|아울렛|몰|소품/.test(biz)) return '쇼핑';
  return '기타';
}
export function parseTmapPois(body: RecordValue): PoiItem[] {
  const pois = list(record(record(body.searchPoiInfo).pois).poi).map(record);
  const items: PoiItem[] = [];
  for (const p of pois.slice(0, 15)) {
    const name = str(p.name).trim();
    const lng = Number(p.noorLon || p.frontLon), lat = Number(p.noorLat || p.frontLat);
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const roadList = list(record(p.newAddressList).newAddress).map(record);
    const roadAddr = str(roadList[0]?.fullAddressRoad).trim();
    const fallbackAddr = [str(p.upperAddrName), str(p.middleAddrName), str(p.lowerAddrName), str(p.detailAddrName)].filter(Boolean).join(' ');
    const biz = `${str(p.upperBizName)} ${str(p.middleBizName)} ${str(p.lowerBizName)} ${name}`;
    items.push({
      id: str(p.id || `${lng},${lat}`),
      name,
      address: (roadAddr || fallbackAddr).slice(0, 200),
      category: inferCategory(biz),
      lng,
      lat,
    });
  }
  return items;
}
export function parseTmapReverseGeocode(body: RecordValue): { address: string } {
  const info = record(body.addressInfo);
  const address = str(info.fullAddress || [str(info.city_do), str(info.gu_gun), str(info.eup_myun), str(info.roadName), str(info.buildingIndex)].filter(Boolean).join(' ')).trim();
  return { address };
}
function summarizeSteps(steps: TransitStep[], totalMinutes: number): string {
  const main = steps.filter(s => s.mode !== 'walk' && s.route).map(s => s.route!);
  return main.length ? main.slice(0, 3).join(' → ').slice(0, 120) : `도보 ${totalMinutes}분`;
}
export function parseTmapTransit(body: RecordValue, key: string, mapAllowed: boolean): TransitRouteResult {
  const plan = record(record(body.metaData).plan);
  const itineraries = list(plan.itineraries).map(record);
  const fetchedAt = new Date().toISOString();
  const options: TransitOption[] = [];
  for (const [idx, it] of itineraries.slice(0, 5).entries()) {
    const minutes = Math.max(1, Math.ceil(Number(it.totalTime) / 60));
    const transfers = Math.max(0, Math.round(Number(it.transferCount || 0)));
    const walkMinutes = Math.max(0, Math.ceil(Number(it.totalWalkTime || 0) / 60));
    const rawFare = Number(record(record(it.fare).regular).totalFare);
    const fare = Number.isFinite(rawFare) && rawFare >= 0 ? Math.round(rawFare) : undefined;
    const steps: TransitStep[] = [];
    const coords: [number, number][] = [];
    for (const rawLeg of list(it.legs).map(record)) {
      const rawMode = str(rawLeg.mode).toUpperCase();
      const mode: TransitStepMode = rawMode === 'SUBWAY' ? 'subway' : rawMode === 'BUS' || rawMode === 'EXPRESSBUS' ? 'bus' : rawMode === 'TRAIN' ? 'train' : 'walk';
      const stepMinutes = Math.max(1, Math.ceil(Number(rawLeg.sectionTime || 60) / 60));
      const meters = Number.isFinite(Number(rawLeg.distance)) ? Math.max(0, Math.round(Number(rawLeg.distance))) : undefined;
      const start = record(rawLeg.start), end = record(rawLeg.end);
      const fromLng = Number(start.lon), fromLat = Number(start.lat);
      const stations = list(record(rawLeg.passStopList).stationList).map(record);
      const stationId = str(stations[0]?.stationID || start.stationID || '');
      const stops = stations.length > 1 ? stations.length - 1 : undefined;
      const route = mode !== 'walk' ? str(rawLeg.route || rawLeg.routeName || '') : undefined;
      steps.push({
        mode, minutes: stepMinutes, ...(meters !== undefined ? { meters } : {}),
        ...(route ? { route } : {}),
        ...(str(start.name) ? { from: str(start.name) } : {}),
        ...(str(end.name) ? { to: str(end.name) } : {}),
        ...(stationId ? { stationId } : {}),
        ...(Number.isFinite(fromLng) && Number.isFinite(fromLat) ? { fromLng, fromLat } : {}),
        ...(stops ? { stops } : {}),
      });
      if (mapAllowed) {
        const shape = parseLinestring(str(record(rawLeg.passShape).linestring));
        const walkShape = list(rawLeg.steps).flatMap(s => parseLinestring(str(record(s).linestring)));
        for (const pt of (shape.length ? shape : walkShape)) {
          const prev = coords[coords.length - 1];
          if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) coords.push(pt);
        }
      }
    }
    if (!steps.length) continue;
    const candidate: TransitOption = {
      id: `tmap-${idx + 1}`, key, summary: summarizeSteps(steps, minutes),
      minutes, transfers, walkMinutes, ...(fare !== undefined ? { fare } : {}),
      fetchedAt, steps: steps.slice(0, 25),
      coordinates: mapAllowed && coords.length >= 2 ? coords.slice(0, 4000) : [],
    };
    if (validTransit(candidate)) options.push(candidate);
  }
  if (!options.length) throw new TransportError('upstream', '이 구간의 대중교통 경로를 찾지 못했어요.');
  return { options, fetchedAt, source: 'TMAP 대중교통', mapAllowed };
}
export function parseOdsayTransit(body: RecordValue, key: string, mapAllowed: boolean): TransitRouteResult {
  const paths = list(record(body.result).path).map(record);
  const fetchedAt = new Date().toISOString();
  const options: TransitOption[] = [];
  for (const [idx, p] of paths.slice(0, 5).entries()) {
    const info = record(p.info);
    const minutes = Math.max(1, Math.round(Number(info.totalTime)));
    const transitCount = Number(info.busTransitCount || 0) + Number(info.subwayTransitCount || 0);
    const transfers = Math.max(0, transitCount - 1);
    const rawFare = Number(info.payment);
    const fare = Number.isFinite(rawFare) && rawFare >= 0 ? Math.round(rawFare) : undefined;
    const steps: TransitStep[] = [];
    const coords: [number, number][] = [];
    let walkMinutes = 0;
    for (const sub of list(p.subPath).map(record)) {
      const tType = Number(sub.trafficType);
      const mode: TransitStepMode = tType === 1 ? 'subway' : tType === 2 ? 'bus' : 'walk';
      const stepMinutes = Math.max(0, Math.round(Number(sub.sectionTime || 0)));
      if (mode === 'walk' && stepMinutes === 0) continue;
      if (mode === 'walk') walkMinutes += stepMinutes;
      const lane = record(list(sub.lane)[0]);
      const route = mode === 'bus' ? str(lane.busNo) : mode === 'subway' ? str(lane.name) : undefined;
      const fromLng = Number(sub.startX), fromLat = Number(sub.startY);
      const endLng = Number(sub.endX), endLat = Number(sub.endY);
      const stationId = str(sub.startArsID || sub.startLocalStationID || sub.startID || '').replace(/-/g, '');
      const stops = Number(sub.stationCount);
      steps.push({
        mode, minutes: Math.max(1, stepMinutes),
        ...(Number.isFinite(Number(sub.distance)) ? { meters: Math.max(0, Math.round(Number(sub.distance))) } : {}),
        ...(route ? { route } : {}),
        ...(str(sub.startName) ? { from: str(sub.startName) } : {}),
        ...(str(sub.endName) ? { to: str(sub.endName) } : {}),
        ...(stationId ? { stationId } : {}),
        ...(Number.isFinite(fromLng) && Number.isFinite(fromLat) ? { fromLng, fromLat } : {}),
        ...(Number.isFinite(stops) && stops > 0 ? { stops: Math.round(stops) } : {}),
      });
      if (mapAllowed) {
        const passCoords = list(record(sub.passStopCoords).stations ?? list(record(sub.passStopList).stations)).map(record);
        if (passCoords.length) {
          for (const st of passCoords) {
            const sx = Number(st.x ?? st.lon), sy = Number(st.y ?? st.lat);
            if (Number.isFinite(sx) && Number.isFinite(sy)) coords.push([sx, sy]);
          }
        } else if (Number.isFinite(fromLng) && Number.isFinite(fromLat) && Number.isFinite(endLng) && Number.isFinite(endLat)) {
          coords.push([fromLng, fromLat], [endLng, endLat]);
        }
      }
    }
    if (!steps.length) continue;
    const candidate: TransitOption = {
      id: `odsay-${idx + 1}`, key, summary: summarizeSteps(steps, minutes),
      minutes, transfers, walkMinutes, ...(fare !== undefined ? { fare } : {}),
      fetchedAt, steps: steps.slice(0, 25),
      coordinates: mapAllowed && coords.length >= 2 ? coords.slice(0, 4000) : [],
    };
    if (validTransit(candidate)) options.push(candidate);
  }
  if (!options.length) throw new TransportError('upstream', '이 구간의 대중교통 경로를 찾지 못했어요.');
  return { options, fetchedAt, source: 'ODSay 대중교통', mapAllowed };
}
function publicItems(body: RecordValue, region: string): unknown[] {
  if (region === 'seoul') {
    const header = record(body.msgHeader);
    if (String(header.headerCd) === '4') return [];
    if (String(header.headerCd) !== '0') throw new TransportError('upstream', '서울 버스 정보를 가져오지 못했어요.');
    return list(record(body.msgBody).itemList);
  }
  const response = record(body.response), header = record(response.msgHeader);
  if (String(header.resultCode) === '4') return [];
  if (String(header.resultCode) !== '0') throw new TransportError('upstream', '경기 버스 정보를 가져오지 못했어요.');
  const contents = record(response.msgBody);
  return list(contents.busArrivalList ?? contents.busStationAroundList);
}
export function parseArrivals(body: RecordValue, region: string): BusArrival[] {
  return publicItems(body, region).slice(0, 80).map(record).map(item => {
    if (region === 'seoul') return { route: str(item.rtNm), direction: str(item.adirection), first: str(item.arrmsg1) || '정보 없음', second: str(item.arrmsg2) || '정보 없음' };
    const flag = str(item.flag);
    const arrival = (n: string) => {
      const seconds = Number(item[`predictTimeSec${n}`]), minutes = Number(item[`predictTime${n}`]);
      if (flag === 'STOP') return '운행 종료';
      if (flag === 'WAIT') return '출발 대기';
      if (Number.isFinite(seconds) && seconds > 0) return `${Math.ceil(seconds / 60)}분 후`;
      if (Number.isFinite(minutes) && minutes > 0) return `${minutes}분 후`;
      return '정보 없음';
    };
    const stops = Number(item.locationNo1);
    return { route: str(item.routeName || item.routeId), direction: str(item.routeDestName), first: arrival('1'), second: arrival('2'), ...(stops > 0 ? { stopsAway: stops } : {}) };
  });
}
export function parseSubwayArrivals(body: RecordValue): BusArrival[] {
  const items = list(body.realtimeArrivalList).slice(0, 40).map(record);
  return items.map(item => {
    const line = str(item.trainLineNm || item.bstatnNm);
    const direction = str(item.updnLine || item.bstatnNm);
    const msg = str(item.arvlMsg2) || '정보 없음';
    const next = str(item.arvlMsg3) ? `${str(item.arvlMsg3)} 기준` : '다음 열차 확인';
    return { route: line || '지하철', direction, first: msg, second: next };
  });
}
export function matchRouteArrivals(arrivals: BusArrival[], targetRoute: string): { matched: BusArrival[]; others: BusArrival[] } {
  const normTarget = normalizeRouteName(targetRoute);
  if (!normTarget) return { matched: [], others: arrivals };
  const matched: BusArrival[] = [], others: BusArrival[] = [];
  for (const a of arrivals) {
    const normItem = normalizeRouteName(a.route);
    if (normItem && (normItem === normTarget || normItem.startsWith(normTarget) || normTarget.startsWith(normItem))) {
      matched.push(a);
    } else {
      others.push(a);
    }
  }
  return { matched, others };
}
function cleanStationName(raw: string): string {
  return raw.replace(/역$/, '').replace(/\(.*\)/g, '').trim();
}
export async function transportData(params: URLSearchParams, env: Env = process.env, fetcher: typeof fetch = fetch): Promise<unknown> {
  const action = params.get('action');
  const tmapEnabled = !!env.TMAP_APP_KEY && env.TMAP_FREE_PLAN_CONFIRMED === 'true';
  const transitEnabled = !!env.ODSAY_API_KEY || (!!env.TMAP_APP_KEY && (env.TMAP_TRANSIT_CONFIRMED === 'true' || env.TMAP_FREE_PLAN_CONFIRMED === 'true'));
  const transitMapAllowed = env.TRANSIT_MAP_DISPLAY_CONFIRMED === 'true' || env.TMAP_MAP_DISPLAY_CONFIRMED === 'true';
  if (action === 'status') return {
    walking: tmapEnabled,
    walkingMap: env.TMAP_MAP_DISPLAY_CONFIRMED === 'true',
    car: tmapEnabled,
    pois: tmapEnabled,
    transit: transitEnabled,
    transitMap: transitMapAllowed,
    seoul: !!env.SEOUL_BUS_SERVICE_KEY,
    gyeonggi: !!(env.GYEONGGI_BUS_SERVICE_KEY || env.GYEONGGI_BUS_STATION_KEY),
    subway: !!env.SEOUL_SUBWAY_SERVICE_KEY,
  };
  if (!['walk', 'car', 'pois', 'reverse-geocode', 'transit', 'transit-live', 'stations', 'arrivals'].includes(action || '')) {
    throw new TransportError('invalid', '지원하지 않는 조회예요.');
  }
  const cacheKey = params.toString();
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.data;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const run = async () => {
    if (action === 'walk' || action === 'car') {
      const apiKey = required(env, 'TMAP_APP_KEY');
      if (env.TMAP_FREE_PLAN_CONFIRMED !== 'true') throw new TransportError('unconfigured', '무료 요금제와 호출 차단 설정 확인 후 연결할 수 있어요.');
      const [lng, lat] = point(params), [toLng, toLat] = point(params, 'to');
      if (action === 'walk' && Math.hypot(toLng - lng, toLat - lat) > .4) throw new TransportError('unsupported', '장거리 구간은 대중교통이나 자동차로 계획해 주세요.');
      consume('tmap');
      const endpoint = action === 'walk'
        ? 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1'
        : 'https://apis.openapi.sk.com/tmap/routes?version=1';
      const body = await json(endpoint, {
        method: 'POST', headers: { appKey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startX: lng, startY: lat, endX: toLng, endY: toLat, startName: '출발', endName: '도착', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' }),
      }, fetcher);
      return parseTmap(body, `${lng},${lat}>${toLng},${toLat}`, env.TMAP_MAP_DISPLAY_CONFIRMED === 'true');
    }
    if (action === 'pois') {
      const apiKey = required(env, 'TMAP_APP_KEY');
      if (env.TMAP_FREE_PLAN_CONFIRMED !== 'true') throw new TransportError('unconfigured', 'TMAP 연결 확인 후 실시간 장소 검색을 사용할 수 있어요.');
      const q = str(params.get('q')).trim();
      if (q.length < 2) throw new TransportError('invalid', '검색어를 두 글자 이상 입력해 주세요.');
      consume('tmap');
      const query = new URLSearchParams({ version: '1', searchKeyword: q, count: '12', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' });
      const body = await json(`https://apis.openapi.sk.com/tmap/pois?${query}`, { headers: { appKey: apiKey, Accept: 'application/json' } }, fetcher);
      return parseTmapPois(body);
    }
    if (action === 'reverse-geocode') {
      const apiKey = required(env, 'TMAP_APP_KEY');
      if (env.TMAP_FREE_PLAN_CONFIRMED !== 'true') throw new TransportError('unconfigured', 'TMAP 연결 확인 후 주소 변환을 사용할 수 있어요.');
      const [lng, lat] = point(params);
      consume('tmap');
      const query = new URLSearchParams({ version: '1', lon: String(lng), lat: String(lat), coordType: 'WGS84GEO', addressType: 'A10' });
      const body = await json(`https://apis.openapi.sk.com/tmap/geo/reversegeocoding?${query}`, { headers: { appKey: apiKey, Accept: 'application/json' } }, fetcher);
      return parseTmapReverseGeocode(body);
    }
    if (action === 'transit') {
      const [lng, lat] = point(params), [toLng, toLat] = point(params, 'to');
      const key = `${lng},${lat}>${toLng},${toLat}`;
      if (env.ODSAY_API_KEY) {
        consume('odsay');
        const q = new URLSearchParams({ SX: String(lng), SY: String(lat), EX: String(toLng), EY: String(toLat), apiKey: env.ODSAY_API_KEY });
        const body = await json(`https://api.odsay.com/v1/api/searchPubTransPathT?${q}`, {}, fetcher);
        return parseOdsayTransit(body, key, transitMapAllowed);
      }
      const apiKey = required(env, 'TMAP_APP_KEY');
      if (env.TMAP_TRANSIT_CONFIRMED !== 'true' && env.TMAP_FREE_PLAN_CONFIRMED !== 'true') {
        throw new TransportError('unconfigured', '대중교통 경로 API 요금제 확인 후 연결할 수 있어요.');
      }
      consume('tmap-transit');
      const body = await json('https://apis.openapi.sk.com/transit/routes', {
        method: 'POST', headers: { appKey: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ startX: String(lng), startY: String(lat), endX: String(toLng), endY: String(toLat), count: 5, lang: 0, format: 'json' }),
      }, fetcher);
      return parseTmapTransit(body, key, transitMapAllowed);
    }
    if (action === 'transit-live') {
      const mode = params.get('mode') || 'bus';
      const targetRoute = str(params.get('route'));
      const stationName = str(params.get('stationName'));
      if (mode === 'subway') {
        const subwayKey = required(env, 'SEOUL_SUBWAY_SERVICE_KEY');
        const cleanName = cleanStationName(stationName);
        if (!cleanName) throw new TransportError('invalid', '지하철 역 이름을 확인해 주세요.');
        consume('subway');
        const body = await json(`http://swopenAPI.seoul.go.kr/api/subway/${encodeURIComponent(subwayKey)}/json/realtimeStationArrival/0/20/${encodeURIComponent(cleanName)}`, {}, fetcher);
        const arrivals = parseSubwayArrivals(body);
        const { matched, others } = matchRouteArrivals(arrivals, targetRoute || str(params.get('direction')));
        return { stationName: `${cleanName}역`, route: targetRoute, matched, others: others.slice(0, 8), fetchedAt: new Date().toISOString(), source: '서울 실시간 지하철' } satisfies TransitLiveResult;
      }
      const region = params.get('region') === 'gyeonggi' ? 'gyeonggi' : 'seoul';
      const stationApiKey = region === 'seoul'
        ? required(env, 'SEOUL_BUS_SERVICE_KEY')
        : (env.GYEONGGI_BUS_SERVICE_KEY || required(env, 'GYEONGGI_BUS_STATION_KEY'));
      const arrivalApiKey = required(env, region === 'seoul' ? 'SEOUL_BUS_SERVICE_KEY' : 'GYEONGGI_BUS_SERVICE_KEY');
      let stationId = str(params.get('station'));
      let resolvedName = stationName || '승차 정류소';
      let resolvedNumber = stationId;
      const validDirectId = region === 'seoul' ? /^\d{5}$/.test(stationId) : /^\d{9}$/.test(stationId);
      if (!validDirectId) {
        const [lng, lat] = point(params);
        const stQuery = new URLSearchParams();
        stQuery.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', stationApiKey);
        stQuery.set(region === 'seoul' ? 'resultType' : 'format', 'json');
        stQuery.set(region === 'seoul' ? 'tmX' : 'x', String(lng));
        stQuery.set(region === 'seoul' ? 'tmY' : 'y', String(lat));
        stQuery.set('radius', '500');
        const stEndpoint = region === 'seoul' ? 'https://ws.bus.go.kr/api/rest/stationinfo/getStationByPos' : 'https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationAroundListv2';
        consume(region);
        const stBody = await json(`${stEndpoint}?${stQuery}`, {}, fetcher);
        const stations = publicItems(stBody, region).map(record).map((s): BusStation => ({
          id: str(region === 'seoul' ? s.arsId : s.stationId), name: str(region === 'seoul' ? s.stationNm : s.stationName), region,
          number: str(region === 'seoul' ? s.arsId : s.mobileNo), distance: Number(region === 'seoul' ? s.dist : s.distance),
        })).filter(s => (region === 'seoul' ? /^\d{5}$/ : /^\d{9}$/).test(s.id) && s.name);
        if (!stations.length) throw new TransportError('upstream', '승차 지점 주변 500m 안에 조회 가능한 정류소가 없어요.');
        const cleanTarget = stationName.replace(/\s+/g, '');
        const best = (cleanTarget ? stations.find(s => s.name.replace(/\s+/g, '').includes(cleanTarget) || cleanTarget.includes(s.name.replace(/\s+/g, ''))) : undefined) || stations[0];
        stationId = best.id; resolvedName = best.name; resolvedNumber = best.number || best.id;
      }
      const arrQuery = new URLSearchParams();
      arrQuery.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', arrivalApiKey);
      arrQuery.set(region === 'seoul' ? 'resultType' : 'format', 'json');
      arrQuery.set(region === 'seoul' ? 'arsId' : 'stationId', stationId);
      const arrEndpoint = region === 'seoul' ? 'https://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
      consume(region);
      const arrBody = await json(`${arrEndpoint}?${arrQuery}`, {}, fetcher);
      const arrivals = parseArrivals(arrBody, region);
      const { matched, others } = matchRouteArrivals(arrivals, targetRoute);
      return {
        stationName: resolvedName, stationNumber: resolvedNumber, route: targetRoute,
        matched, others: others.slice(0, 8), fetchedAt: new Date().toISOString(),
        source: region === 'seoul' ? '서울 TOPIS' : '경기 GBIS',
      } satisfies TransitLiveResult;
    }
    const region = params.get('region');
    if (region !== 'seoul' && region !== 'gyeonggi') throw new TransportError('unsupported', '서울·경기 버스를 지원해요. 지역을 선택하세요.');
    const apiKey = action === 'stations' && region === 'gyeonggi'
      ? (env.GYEONGGI_BUS_SERVICE_KEY || required(env, 'GYEONGGI_BUS_STATION_KEY'))
      : required(env, region === 'seoul' ? 'SEOUL_BUS_SERVICE_KEY' : 'GYEONGGI_BUS_SERVICE_KEY');
    const query = new URLSearchParams();
    query.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', apiKey);
    query.set(region === 'seoul' ? 'resultType' : 'format', 'json');
    let endpoint: string;
    if (action === 'stations') {
      const [lng, lat] = point(params);
      if (region === 'seoul' && (lng < 126.7 || lng > 127.25 || lat < 37.4 || lat > 37.72)) throw new TransportError('unsupported', '서울 인근 장소를 선택하거나 경기로 바꿔 주세요.');
      query.set(region === 'seoul' ? 'tmX' : 'x', String(lng)); query.set(region === 'seoul' ? 'tmY' : 'y', String(lat)); query.set('radius', '500');
      endpoint = region === 'seoul' ? 'https://ws.bus.go.kr/api/rest/stationinfo/getStationByPos' : 'https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationAroundListv2';
    } else {
      const id = params.get('station') || '';
      if (!(region === 'seoul' ? /^\d{5}$/ : /^\d{9}$/).test(id)) throw new TransportError('invalid', region === 'seoul' ? '정류소 번호 5자리를 확인하세요.' : '경기 정류소 ID 9자리를 확인하세요. 표지판 번호와 달라요.');
      query.set(region === 'seoul' ? 'arsId' : 'stationId', id);
      endpoint = region === 'seoul' ? 'https://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
    }
    consume(region);
    const body = await json(`${endpoint}?${query}`, {}, fetcher);
    if (action === 'stations') return publicItems(body, region).map(record).map((s): BusStation => ({
      id: str(region === 'seoul' ? s.arsId : s.stationId), name: str(region === 'seoul' ? s.stationNm : s.stationName), region,
      number: str(region === 'seoul' ? s.arsId : s.mobileNo), distance: Number(region === 'seoul' ? s.dist : s.distance),
    })).filter(s => s.id && s.name).slice(0, 20);
    return { arrivals: parseArrivals(body, region), fetchedAt: new Date().toISOString(), source: region === 'seoul' ? '서울 TOPIS' : '경기 GBIS' };
  };
  const ttl = action === 'walk' || action === 'car' || action === 'reverse-geocode' ? 3600000
    : action === 'transit' || action === 'pois' ? 1800000
    : action === 'stations' ? 300000 : 30000;
  const pending = run().then(data => {
    if (cache.size > 200) cache.clear();
    cache.set(cacheKey, { until: Date.now() + ttl, data }); return data;
  }).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, pending); return pending;
}
export async function handleTransport(req: IncomingMessage, res: ServerResponse, env: Env = process.env) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  const fail = (status: number, code: string, message: string) => { res.statusCode = status; res.end(JSON.stringify({ code, message })); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(405, 'invalid', 'GET 요청만 지원해요.'); }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return fail(403, 'invalid', '앱에서 조회해 주세요.');
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'local');
  const now = Date.now();
  if (limits.size > 2000) for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
  const limit = limits.get(ip);
  if (limit && limit.reset > now && limit.count >= 30) { res.setHeader('Retry-After', '60'); return fail(429, 'quota', '조회가 잦아요. 1분 후 다시 확인하세요.'); }
  limits.set(ip, limit && limit.reset > now ? { ...limit, count: limit.count + 1 } : { reset: now + 60000, count: 1 });
  try {
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const data = await transportData(params, env); res.end(JSON.stringify({ data }));
  } catch (error) {
    if (error instanceof TransportError) return fail(error.code === 'invalid' ? 400 : error.code === 'quota' ? 429 : error.code === 'upstream' ? 502 : 503, error.code, error.message);
    return fail(502, 'upstream', '정보를 가져오지 못했어요. 잠시 후 다시 확인하세요.');
  }
}
