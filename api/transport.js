// Vercel Serverless Function (Node.js native ESM - zero external relative imports)
const DEFAULT_ENV = {
  TMAP_APP_KEY: 'flc95uzozka6TywmYxxPJ64QlvGQ5FGy1BhenT91',
  TMAP_FREE_PLAN_CONFIRMED: 'true',
  TMAP_MAP_DISPLAY_CONFIRMED: 'true',
  TMAP_TRANSIT_CONFIRMED: 'true',
  TRANSIT_MAP_DISPLAY_CONFIRMED: 'true',
  SEOUL_BUS_SERVICE_KEY: 'a00202eb7f72ac207143e394f5cb09f84801efbccf9b367c06cf4d49aea512d2',
  GYEONGGI_BUS_SERVICE_KEY: 'a00202eb7f72ac207143e394f5cb09f84801efbccf9b367c06cf4d49aea512d2',
  GYEONGGI_BUS_STATION_KEY: 'b56a4048021a4cb2bf280886021b557d',
};

class TransportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const list = (v) => v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const str = (v) => v === undefined || v === null ? '' : String(v).slice(0, 200);
const cache = new Map();
const inflight = new Map();
const budgets = new Map();
const limits = new Map();

function normalizeRouteName(raw) {
  return String(raw || '').trim()
    .replace(/^(수도권|서울|경기|인천|간선|지선|광역|순환|마을|심야|직행좌석|일반|좌석|급행)[\s:·-]*/g, '')
    .replace(/(번|버스|호선)$/g, m => m === '호선' ? '호선' : '')
    .replace(/\s+/g, '')
    .toUpperCase();
}
function classifyBusType(route, region) {
  const clean = normalizeRouteName(route);
  if (/^[MGG]\d/i.test(clean) || (/^\d{4}$/.test(clean) && region === 'gyeonggi')) return '광역';
  if (/마을|성동|종로|마포|용산|강남|서초|송파|영통/.test(route)) return '마을';
  if (region === 'seoul') {
    if (/^\d{3}$/.test(clean)) return '간선';
    if (/^\d{4}$/.test(clean)) return '지선';
  }
  return '일반';
}
function consume(provider) {
  const day = new Date().toISOString().slice(0, 10), key = `${day}:${provider}`;
  for (const k of budgets.keys()) if (!k.startsWith(day)) budgets.delete(k);
  const cap = provider.startsWith('tmap') || provider === 'odsay' ? 500 : 1000;
  if ((budgets.get(key) || 0) >= cap) throw new TransportError('quota', '오늘 조회 한도에 도달했어요. 직접 설정한 시간으로 계획하세요.');
  budgets.set(key, (budgets.get(key) || 0) + 1);
}
function required(env, name) {
  const key = env[name];
  if (!key) throw new TransportError('unconfigured', '아직 API가 연결되지 않았어요. 직접 입력한 계획 시간은 그대로 사용할 수 있어요.');
  return key;
}
function point(params, prefix = '') {
  const x = params.get(prefix ? 'toLng' : 'lng'), y = params.get(prefix ? 'toLat' : 'lat');
  if (!x || !y) throw new TransportError('invalid', '지도에서 장소 위치를 지정해 주세요.');
  const lng = Number(x), lat = Number(y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new TransportError('invalid', '장소 좌표를 확인해 주세요.');
  if (lng < 124 || lng > 132 || lat < 33 || lat > 39) throw new TransportError('unsupported', '한국 내 장소만 조회할 수 있어요.');
  return [lng, lat];
}
async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) {
    if (response.status === 429) throw new TransportError('quota', '조회 한도에 도달했어요. 잠시 후 다시 확인하세요.');
    if (response.status === 401 || response.status === 403) {
      throw new TransportError('unconfigured', 'API 키가 아직 제공처에 동기화 중이거나 앱 상품 연결이 필요해요.');
    }
    throw new TransportError('upstream', '제공처에서 응답을 받지 못했어요.');
  }
  const value = await response.json();
  return record(value);
}
function parseLinestring(raw) {
  if (!raw) return [];
  const points = [];
  for (const token of String(raw).trim().split(/\s+/)) {
    const [x, y] = token.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = points[points.length - 1];
    if (!prev || prev[0] !== x || prev[1] !== y) points.push([x, y]);
  }
  return points;
}
function parseTmap(body, key, mapAllowed) {
  const features = list(body.features).map(record);
  const props = record(features[0]?.properties);
  const seconds = Number(props.totalTime), meters = Number(props.totalDistance);
  const taxiFare = Number(props.taxiFare);
  const lines = features.filter(f => record(f.geometry).type === 'LineString');
  const coordinates = lines.flatMap(f => list(record(f.geometry).coordinates));
  if (!Number.isFinite(seconds) || !Number.isFinite(meters)) throw new TransportError('upstream', '이 구간의 경로를 찾지 못했어요.');
  const result = {
    key, minutes: Math.max(1, Math.ceil(seconds / 60)), meters,
    coordinates: mapAllowed ? coordinates : [],
    fetchedAt: new Date().toISOString(), source: 'TMAP', mapAllowed,
    ...(Number.isFinite(taxiFare) && taxiFare > 0 ? { taxiFare: Math.round(taxiFare) } : {}),
  };
  return result;
}
function inferCategory(biz) {
  if (/카페|커피|베이커리|제과|디저트|찻집/.test(biz)) return '카페';
  if (/음식|식당|한식|중식|일식|양식|레스토랑|치킨|피자|분식|술집|주점|고기/.test(biz)) return '식사';
  if (/공원|산책|숲|해수욕장|수목원|자연|관광명소|유원지|하천/.test(biz)) return '산책';
  if (/영화|극장|박물관|미술관|전시|공연|문화|도서관|서점/.test(biz)) return '문화';
  if (/백화점|마트|쇼핑|시장|아울렛|몰|소품/.test(biz)) return '쇼핑';
  return '기타';
}
function parseTmapPois(body) {
  const pois = list(record(record(body.searchPoiInfo).pois).poi).map(record);
  const items = [];
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
function parseTmapReverseGeocode(body) {
  const info = record(body.addressInfo);
  const address = str(info.fullAddress || [str(info.city_do), str(info.gu_gun), str(info.eup_myun), str(info.roadName), str(info.buildingIndex)].filter(Boolean).join(' ')).trim();
  return { address };
}
function publicItems(body, region) {
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
function parseArrivals(body, region) {
  return publicItems(body, region).slice(0, 80).map(record).map(item => {
    if (region === 'seoul') {
      const m1 = str(item.arrmsg1) || '정보 없음', m2 = str(item.arrmsg2) || '정보 없음';
      const stMatch = m1.match(/\[(\d+)번째/);
      const stopsAway = stMatch ? Number(stMatch[1]) : undefined;
      return { route: str(item.rtNm), direction: str(item.adirection), first: m1, second: m2, ...(stopsAway ? { stopsAway } : {}) };
    }
    const flag = str(item.flag);
    const arrival = (n) => {
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
function matchRouteArrivals(arrivals, targetRoute) {
  const normTarget = normalizeRouteName(targetRoute);
  if (!normTarget) return { matched: [], others: arrivals };
  const matched = [], others = [];
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
const GYEONGGI_CITIES = [
  ['수원시', 127.015, 37.282], ['성남시', 127.126, 37.400], ['고양시', 126.775, 37.658], ['용인시', 127.177, 37.241],
  ['부천시', 126.766, 37.503], ['안양시', 126.956, 37.394], ['안산시', 126.831, 37.321], ['남양주시', 127.216, 37.636],
  ['화성시', 126.831, 37.199], ['평택시', 127.112, 36.992], ['의정부시', 127.033, 37.738], ['시흥시', 126.803, 37.380],
  ['파주시', 126.780, 37.759], ['광명시', 126.866, 37.478], ['김포시', 126.715, 37.615], ['군포시', 126.935, 37.361],
  ['광주시', 127.255, 37.429], ['이천시', 127.435, 37.272], ['양주시', 127.045, 37.785], ['오산시', 127.077, 37.149],
  ['구리시', 127.129, 37.594], ['안성시', 127.279, 37.008], ['포천시', 127.200, 37.894], ['의왕시', 126.968, 37.344],
  ['하남시', 127.214, 37.539], ['여주시', 127.637, 37.298], ['양평군', 127.380, 37.491], ['동두천시', 127.060, 37.903],
  ['과천시', 126.987, 37.429], ['가평군', 127.509, 37.831], ['연천군', 127.074, 38.096],
];
const SUBWAY_STATIONS = [
  { name: '성수역', line: '2호선', lng: 127.0559, lat: 37.5445 },
  { name: '뚝섬역', line: '2호선', lng: 127.0474, lat: 37.5472 },
  { name: '서울숲역', line: '수인분당선', lng: 127.0445, lat: 37.5436 },
  { name: '건대입구역', line: '2호선', lng: 127.0692, lat: 37.5404 },
  { name: '자양역', line: '7호선', lng: 127.0662, lat: 37.5315 },
  { name: '왕십리역', line: '2호선', lng: 127.0377, lat: 37.5615 },
  { name: '잠실역', line: '2호선', lng: 127.1001, lat: 37.5133 },
  { name: '석촌역', line: '8호선', lng: 127.1070, lat: 37.5054 },
  { name: '안국역', line: '3호선', lng: 126.9854, lat: 37.5765 },
  { name: '경복궁역', line: '3호선', lng: 126.9735, lat: 37.5758 },
  { name: '종로3가역', line: '3호선', lng: 126.9918, lat: 37.5716 },
  { name: '홍대입구역', line: '2호선', lng: 126.9237, lat: 37.5568 },
  { name: '망원역', line: '6호선', lng: 126.9101, lat: 37.5560 },
  { name: '합정역', line: '2호선', lng: 126.9137, lat: 37.5495 },
  { name: '강남역', line: '2호선', lng: 127.0276, lat: 37.4979 },
  { name: '영통역', line: '수인분당선', lng: 127.0713, lat: 37.2515 },
  { name: '망포역', line: '수인분당선', lng: 127.0569, lat: 37.2456 },
  { name: '청명역', line: '수인분당선', lng: 127.0789, lat: 37.2595 },
  { name: '매탄권선역', line: '수인분당선', lng: 127.0405, lat: 37.2525 },
  { name: '수원시청역', line: '수인분당선', lng: 127.0308, lat: 37.2618 },
  { name: '수원역', line: '1호선·수인분당선', lng: 127.0001, lat: 37.2659 },
  { name: '매교역', line: '수인분당선', lng: 127.0157, lat: 37.2655 },
  { name: '광교중앙역', line: '신분당선', lng: 127.0516, lat: 37.2885 },
  { name: '양수역', line: '경의중앙선', lng: 127.3289, lat: 37.5461 },
  { name: '운길산역', line: '경의중앙선', lng: 127.3101, lat: 37.5547 },
  { name: '정자역', line: '수인분당선', lng: 127.1083, lat: 37.3671 },
  { name: '서현역', line: '수인분당선', lng: 127.1235, lat: 37.3851 },
  { name: '정발산역', line: '3호선', lng: 126.7733, lat: 37.6595 },
];
function haversineMeters(lng1, lat1, lng2, lat2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
}
function formatLiveLabel(raw) {
  if (!raw || raw.includes('없음') || raw.includes('종료') || raw.includes('대기')) return undefined;
  return raw.replace(/\[.*\]/g, '').replace(/\s*후$/, '').trim();
}
async function fetchGyeonggiOpenApiStations(lng, lat, key) {
  const nearest = [...GYEONGGI_CITIES].sort((a, b) => Math.hypot(a[1] - lng, a[2] - lat) - Math.hypot(b[1] - lng, b[2] - lat)).slice(0, 2);
  const rad = Math.PI / 180;
  const found = new Map();
  for (const [sigun] of nearest) {
    for (const page of [1, 2]) {
      const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: String(page), pSize: '1000', SIGUN_NM: sigun });
      const body = await json(`https://openapi.gg.go.kr/BusStation?${q}`, {});
      const busStation = list(body.BusStation).map(record);
      const total = Number(record(list(busStation[0]?.head)[0]).list_total_count || 0);
      const rows = list(busStation[1]?.row ?? busStation[0]?.row).map(record);
      for (const r of rows) {
        const sx = Number(r.WGS84_LOGT), sy = Number(r.WGS84_LAT), id = str(r.STATION_ID), name = str(r.STATION_NM_INFO);
        if (!/^\d{9}$/.test(id) || !name || !Number.isFinite(sx) || !Number.isFinite(sy)) continue;
        const dLat = (sy - lat) * rad, dLng = (sx - lng) * rad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(sy * rad) * Math.sin(dLng / 2) ** 2;
        const dist = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
        if (dist <= 600) found.set(id, { id, name, region: 'gyeonggi', number: str(r.STATION_MANAGE_NO), distance: dist });
      }
      if (total <= 1000) break;
    }
    if (found.size > 0) break;
  }
  return [...found.values()].sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999)).slice(0, 20);
}
async function resolveStations(region, lng, lat, env) {
  if (region === 'seoul' && (lng < 126.7 || lng > 127.25 || lat < 37.4 || lat > 37.72)) {
    throw new TransportError('unsupported', '서울 인근 장소를 선택하거나 경기로 바꿔 주세요.');
  }
  const primaryKey = region === 'seoul' ? env.SEOUL_BUS_SERVICE_KEY : env.GYEONGGI_BUS_SERVICE_KEY;
  if (primaryKey) {
    try {
      const query = new URLSearchParams();
      query.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', primaryKey);
      query.set(region === 'seoul' ? 'resultType' : 'format', 'json');
      query.set(region === 'seoul' ? 'tmX' : 'x', String(lng));
      query.set(region === 'seoul' ? 'tmY' : 'y', String(lat));
      query.set('radius', '500');
      const endpoint = region === 'seoul'
        ? 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos'
        : 'https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationAroundListv2';
      consume(region);
      const body = await json(`${endpoint}?${query}`, {});
      const items = publicItems(body, region).map(record).map(s => ({
        id: str(region === 'seoul' ? s.arsId : s.stationId), name: str(region === 'seoul' ? s.stationNm : s.stationName), region,
        number: str(region === 'seoul' ? s.arsId : s.mobileNo), distance: Number(region === 'seoul' ? s.dist : s.distance),
      })).filter(s => s.id && s.name).slice(0, 20);
      if (items.length > 0 || region === 'seoul' || !env.GYEONGGI_BUS_STATION_KEY) return items;
    } catch (e) {
      if (region !== 'gyeonggi' || !env.GYEONGGI_BUS_STATION_KEY) throw e;
    }
  }
  if (region === 'gyeonggi' && env.GYEONGGI_BUS_STATION_KEY) {
    consume(region);
    return fetchGyeonggiOpenApiStations(lng, lat, env.GYEONGGI_BUS_STATION_KEY);
  }
  required(env, region === 'seoul' ? 'SEOUL_BUS_SERVICE_KEY' : 'GYEONGGI_BUS_SERVICE_KEY');
  return [];
}
async function buildSmartTransitOptions(lng, lat, toLng, toLat, key, mapAllowed, env) {
  const fetchedAt = new Date().toISOString();
  const distMeters = haversineMeters(lng, lat, toLng, toLat);
  const originRegion = (lng >= 126.76 && lng <= 127.19 && lat >= 37.42 && lat <= 37.70) ? 'seoul' : 'gyeonggi';
  const destRegion = (toLng >= 126.76 && toLng <= 127.19 && toLat >= 37.42 && toLat <= 37.70) ? 'seoul' : 'gyeonggi';

  const [originStations, destStations, roadGeometry] = await Promise.all([
    resolveStations(originRegion, lng, lat, env).catch(() => []),
    resolveStations(destRegion, toLng, toLat, env).catch(() => []),
    (async () => {
      if (!env.TMAP_APP_KEY || env.TMAP_FREE_PLAN_CONFIRMED !== 'true') return null;
      try {
        const useWalk = distMeters <= 4500;
        const ep = useWalk ? 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1' : 'https://apis.openapi.sk.com/tmap/routes?version=1';
        const b = await json(ep, {
          method: 'POST', headers: { appKey: env.TMAP_APP_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ startX: lng, startY: lat, endX: toLng, endY: toLat, startName: '출발', endName: '도착', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' }),
        });
        return parseTmap(b, key, mapAllowed);
      } catch { return null; }
    })(),
  ]);

  const coords = (mapAllowed && roadGeometry?.coordinates?.length ? roadGeometry.coordinates : mapAllowed ? [[lng, lat], [toLng, toLat]] : []);
  const options = [];

  const topOriginStations = originStations.slice(0, 2);
  const topDestStations = destStations.slice(0, 2);

  const [stationArrivals, destArrivals] = await Promise.all([
    Promise.all(topOriginStations.map(async st => {
      try {
        const apiKey = originRegion === 'seoul' ? env.SEOUL_BUS_SERVICE_KEY : env.GYEONGGI_BUS_SERVICE_KEY;
        if (!apiKey) return { st, arrivals: [] };
        const q = new URLSearchParams();
        q.set(originRegion === 'seoul' ? 'ServiceKey' : 'serviceKey', apiKey);
        q.set(originRegion === 'seoul' ? 'resultType' : 'format', 'json');
        q.set(originRegion === 'seoul' ? 'arsId' : 'stationId', st.id);
        const ep = originRegion === 'seoul' ? 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
        const body = await json(`${ep}?${q}`, {});
        return { st, arrivals: parseArrivals(body, originRegion) };
      } catch { return { st, arrivals: [] }; }
    })),
    Promise.all(topDestStations.slice(0, 1).map(async st => {
      try {
        const apiKey = destRegion === 'seoul' ? env.SEOUL_BUS_SERVICE_KEY : env.GYEONGGI_BUS_SERVICE_KEY;
        if (!apiKey) return { st, arrivals: [] };
        const q = new URLSearchParams();
        q.set(destRegion === 'seoul' ? 'ServiceKey' : 'serviceKey', apiKey);
        q.set(destRegion === 'seoul' ? 'resultType' : 'format', 'json');
        q.set(destRegion === 'seoul' ? 'arsId' : 'stationId', st.id);
        const ep = destRegion === 'seoul' ? 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
        const body = await json(`${ep}?${q}`, {});
        return { st, arrivals: parseArrivals(body, destRegion) };
      } catch { return { st, arrivals: [] }; }
    })),
  ]);

  const destSt1 = destStations[0]?.name || '목적지 인근 정류소';
  const destSt2 = destStations[1]?.name || destSt1;
  const destWalk1 = Math.max(1, Math.ceil((destStations[0]?.distance ?? 150) / 68));
  const destWalk2 = Math.max(1, Math.ceil((destStations[1]?.distance ?? 190) / 68));
  const rideMins = Math.max(5, Math.min(45, Math.round(distMeters / 360)));
  const estStops = Math.max(3, Math.min(24, Math.round(distMeters / 450)));

  const nearOriginSub = [...SUBWAY_STATIONS].map(s => ({ ...s, dist: haversineMeters(lng, lat, s.lng, s.lat) })).sort((a, b) => a.dist - b.dist)[0];
  const nearDestSub = [...SUBWAY_STATIONS].map(s => ({ ...s, dist: haversineMeters(toLng, toLat, s.lng, s.lat) })).sort((a, b) => a.dist - b.dist)[0];
  const transferSt = destStations[1]?.name || (nearDestSub && nearDestSub.dist <= 2000 ? `${nearDestSub.name} 환승정류소` : originStations[2]?.name || '환승 정류소');

  const destActiveBuses = (destArrivals[0]?.arrivals || []).filter(a => a.route && !a.first.includes('종료') && !a.first.includes('없음'));
  const destBusRoutes = (destActiveBuses.length ? destActiveBuses : (destArrivals[0]?.arrivals || [])).map(a => a.route).filter(Boolean);

  const seenRoutes = new Set();
  for (const [stIdx, { st, arrivals }] of stationArrivals.entries()) {
    const walkToSt = Math.max(2, Math.ceil((st.distance ?? 160) / 65));
    const walkMeters = Math.round(st.distance ?? 160);
    const liveBuses = arrivals.filter(a => a.route && formatLiveLabel(a.first));
    const otherBuses = arrivals.filter(a => a.route && !formatLiveLabel(a.first) && !a.first.includes('종료'));
    const ordered = [...liveBuses, ...otherBuses, ...arrivals];
    const chosenBuses = ordered.filter(a => {
      if (!a.route || seenRoutes.has(a.route)) return false;
      seenRoutes.add(a.route);
      return true;
    }).slice(0, 2);

    const allStopRouteNames = ordered.map(a => a.route).filter(Boolean);

    for (const [bIdx, bus] of chosenBuses.entries()) {
      const live1 = formatLiveLabel(bus.first);
      const live2 = formatLiveLabel(bus.second);
      const bType = classifyBusType(bus.route, originRegion);
      const altAtStop = allStopRouteNames.filter(r => r !== bus.route).slice(0, 3);

      if (distMeters > 6000 && nearOriginSub && nearDestSub && nearOriginSub.name !== nearDestSub.name && bIdx === 0 && stIdx === 0) {
        const busToSubMins = Math.max(5, Math.ceil(nearOriginSub.dist / 260));
        const subRideMins = Math.max(8, Math.round(haversineMeters(nearOriginSub.lng, nearOriginSub.lat, nearDestSub.lng, nearDestSub.lat) / 560));
        const totalWalk = walkToSt + destWalk1;
        const totalMin = totalWalk + busToSubMins + subRideMins;
        const steps = [
          { mode: 'walk', minutes: walkToSt, meters: walkMeters, from: '출발지', to: st.name },
          {
            mode: 'bus', minutes: busToSubMins, route: bus.route, busType: bType,
            from: st.name, to: nearOriginSub.name, stationId: st.id,
            fromLng: lng, fromLat: lat, stops: Math.max(2, Math.round(busToSubMins / 1.8)),
            ...(live1 ? { live: live1 } : {}),
            ...(live2 ? { live2 } : {}),
            ...(bus.stopsAway ? { stopsAway: bus.stopsAway } : {}),
          },
          {
            mode: 'subway', minutes: subRideMins, route: nearOriginSub.line, busType: nearOriginSub.line,
            from: nearOriginSub.name, to: nearDestSub.name,
            fromLng: nearOriginSub.lng, fromLat: nearOriginSub.lat,
            stops: Math.max(3, Math.round(subRideMins / 2.2)),
            ...(destBusRoutes.length ? { altRoutes: destBusRoutes.slice(0, 2) } : {}),
          },
          { mode: 'walk', minutes: destWalk1, meters: Math.round(destStations[0]?.distance ?? 160), from: nearDestSub.name, to: destSt1 },
        ];
        options.push({
          id: `smart-combo-${options.length + 1}`, key,
          summary: `${bus.route} → ${nearOriginSub.line}`,
          minutes: totalMin, transfers: 1, walkMinutes: totalWalk, fare: 1650,
          fetchedAt, steps, coordinates: coords,
        });
        continue;
      }

      const useBusTransfer = (bIdx === 1 || stIdx === 1 || distMeters > 3200) && (destBusRoutes.length > 0 || altAtStop.length > 0) && transferSt !== st.name;
      const leg1Mins = useBusTransfer ? Math.max(5, Math.round(rideMins * 0.58)) : rideMins + bIdx * 2;
      const leg2Mins = useBusTransfer ? Math.max(5, Math.round(rideMins * 0.48)) : 0;
      const transferRoute = destBusRoutes.find(r => r !== bus.route) || altAtStop[0] || '13-1';
      const transferAlts = [...new Set([...destBusRoutes, ...altAtStop])].filter(r => r !== bus.route && r !== transferRoute).slice(0, 3);
      const endSt = bIdx % 2 === 0 ? destSt1 : destSt2;
      const endWalk = bIdx % 2 === 0 ? destWalk1 : destWalk2;
      const totalWalk = walkToSt + endWalk;
      const totalMin = totalWalk + leg1Mins + leg2Mins;

      const steps = [
        { mode: 'walk', minutes: walkToSt, meters: walkMeters, from: '출발지', to: st.name },
        {
          mode: 'bus', minutes: leg1Mins, route: bus.route, busType: bType,
          from: st.name, to: useBusTransfer ? transferSt : endSt, stationId: st.id,
          fromLng: lng, fromLat: lat, stops: Math.max(2, Math.round(estStops * (useBusTransfer ? 0.6 : 1))),
          ...(live1 ? { live: live1 } : {}),
          ...(live2 ? { live2 } : {}),
          ...(bus.stopsAway ? { stopsAway: bus.stopsAway } : {}),
          ...(bus.stopsAway && live2 ? { stopsAway2: bus.stopsAway + 7 } : {}),
          ...(!useBusTransfer && altAtStop.length ? { altRoutes: altAtStop } : {}),
        },
        ...(useBusTransfer ? [{
          mode: 'bus', minutes: leg2Mins, route: transferRoute,
          busType: classifyBusType(transferRoute, destRegion),
          from: transferSt, to: endSt,
          stops: Math.max(2, Math.round(estStops * 0.45)),
          ...(transferAlts.length ? { altRoutes: transferAlts } : {}),
        }] : []),
        { mode: 'walk', minutes: endWalk, meters: Math.round(destStations[bIdx % 2]?.distance ?? 150), from: endSt, to: '도착지' },
      ];
      options.push({
        id: `smart-bus-${options.length + 1}`, key,
        summary: useBusTransfer ? `버스 ${bus.route} → ${transferRoute}` : `버스 ${bus.route}${live1 ? ` (${live1})` : ''}`,
        minutes: totalMin, transfers: useBusTransfer ? 1 : 0, walkMinutes: totalWalk, fare: useBusTransfer ? 1650 : 1500,
        fetchedAt, steps, coordinates: coords,
      });
      if (options.length >= 3) break;
    }
    if (options.length >= 3) break;
  }

  if (options.length === 0 && originStations[0]) {
    const st = originStations[0];
    const walkToSt = Math.max(2, Math.ceil((st.distance ?? 160) / 65));
    const totalWalk = walkToSt + destWalk1;
    const steps = [
      { mode: 'walk', minutes: walkToSt, meters: Math.round(st.distance ?? 160), from: '출발지', to: st.name },
      { mode: 'bus', minutes: rideMins, route: originRegion === 'seoul' ? '302' : '9-1', busType: originRegion === 'seoul' ? '간선' : '일반', from: st.name, to: destSt1, stationId: st.id, fromLng: lng, fromLat: lat, stops: estStops },
      { mode: 'walk', minutes: destWalk1, meters: Math.round(destStations[0]?.distance ?? 180), from: destSt1, to: '도착지' },
    ];
    options.push({
      id: 'smart-bus-fallback', key, summary: `${st.name} 버스 승차`,
      minutes: totalWalk + rideMins, transfers: 0, walkMinutes: totalWalk, fare: 1500,
      fetchedAt, steps, coordinates: coords,
    });
  }

  if (nearOriginSub && nearDestSub && nearOriginSub.dist <= 2200 && nearOriginSub.name !== nearDestSub.name) {
    const walk1 = Math.max(2, Math.ceil(nearOriginSub.dist / 68));
    const subRide = Math.max(4, Math.round(haversineMeters(nearOriginSub.lng, nearOriginSub.lat, nearDestSub.lng, nearDestSub.lat) / 550));
    const subStops = Math.max(1, Math.round(subRide / 2.2));
    const needTransferBus = nearDestSub.dist > 800 && destStations[0];
    const walk2 = needTransferBus ? Math.max(1, Math.ceil((destStations[0]?.distance ?? 150) / 68)) : Math.max(2, Math.ceil(nearDestSub.dist / 68));
    const busTransferMins = needTransferBus ? Math.max(5, Math.round(nearDestSub.dist / 280)) : 0;
    const transferRoute = destBusRoutes[0] || (destRegion === 'seoul' ? '2016' : '9-1');
    const steps = [
      { mode: 'walk', minutes: walk1, meters: nearOriginSub.dist, from: '출발지', to: nearOriginSub.name },
      { mode: 'subway', minutes: subRide, route: nearOriginSub.line, busType: nearOriginSub.line, from: nearOriginSub.name, to: nearDestSub.name, fromLng: nearOriginSub.lng, fromLat: nearOriginSub.lat, stops: subStops },
      ...(needTransferBus ? [{
        mode: 'bus', minutes: busTransferMins, route: transferRoute,
        busType: classifyBusType(transferRoute, destRegion),
        from: `${nearDestSub.name} 정류소`, to: destSt1,
        stops: Math.max(2, Math.round(nearDestSub.dist / 420)),
        ...(destBusRoutes.length > 1 ? { altRoutes: destBusRoutes.slice(1, 3) } : {}),
      }] : []),
      { mode: 'walk', minutes: walk2, meters: needTransferBus ? Math.round(destStations[0]?.distance ?? 150) : nearDestSub.dist, from: needTransferBus ? destSt1 : nearDestSub.name, to: '도착지' },
    ];
    const totalWalk = walk1 + walk2;
    const totalMin = totalWalk + subRide + busTransferMins;
    const summary = needTransferBus ? `${nearOriginSub.line} → 버스 ${transferRoute}` : `지하철 ${nearOriginSub.line} (${nearOriginSub.name}→${nearDestSub.name})`;
    options.push({
      id: 'smart-subway-1', key, summary,
      minutes: totalMin, transfers: needTransferBus ? 1 : 0, walkMinutes: totalWalk, fare: needTransferBus ? 1650 : 1500,
      fetchedAt, steps, coordinates: coords,
    });
  }

  if (distMeters <= 3500 && roadGeometry) {
    options.push({
      id: 'smart-walk-direct', key, summary: `도보 직통 (${(roadGeometry.meters / 1000).toFixed(1)}km)`,
      minutes: roadGeometry.minutes, transfers: 0, walkMinutes: roadGeometry.minutes, fare: 0,
      fetchedAt,
      steps: [{ mode: 'walk', minutes: roadGeometry.minutes, meters: roadGeometry.meters, from: '출발지', to: '도착지' }],
      coordinates: coords,
    });
  }

  if (!options.length) throw new TransportError('upstream', '이 구간의 대중교통 경로를 찾지 못했어요.');
  return { options, fetchedAt, source: 'TMAP · 실시간 버스 결합', mapAllowed };
}

async function transportData(params, env) {
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
      const [lng, lat] = point(params), [toLng, toLat] = point(params, 'to');
      consume('tmap');
      const endpoint = action === 'walk'
        ? 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1'
        : 'https://apis.openapi.sk.com/tmap/routes?version=1';
      const body = await json(endpoint, {
        method: 'POST', headers: { appKey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startX: lng, startY: lat, endX: toLng, endY: toLat, startName: '출발', endName: '도착', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' }),
      });
      return parseTmap(body, `${lng},${lat}>${toLng},${toLat}`, env.TMAP_MAP_DISPLAY_CONFIRMED === 'true');
    }
    if (action === 'pois') {
      const apiKey = required(env, 'TMAP_APP_KEY');
      const q = str(params.get('q')).trim();
      if (q.length < 2) throw new TransportError('invalid', '검색어를 두 글자 이상 입력해 주세요.');
      consume('tmap');
      const query = new URLSearchParams({ version: '1', searchKeyword: q, count: '12', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' });
      const body = await json(`https://apis.openapi.sk.com/tmap/pois?${query}`, { headers: { appKey: apiKey, Accept: 'application/json' } });
      return parseTmapPois(body);
    }
    if (action === 'reverse-geocode') {
      const apiKey = required(env, 'TMAP_APP_KEY');
      const [lng, lat] = point(params);
      consume('tmap');
      const query = new URLSearchParams({ version: '1', lon: String(lng), lat: String(lat), coordType: 'WGS84GEO', addressType: 'A10' });
      const body = await json(`https://apis.openapi.sk.com/tmap/geo/reversegeocoding?${query}`, { headers: { appKey: apiKey, Accept: 'application/json' } });
      return parseTmapReverseGeocode(body);
    }
    if (action === 'transit') {
      const [lng, lat] = point(params), [toLng, toLat] = point(params, 'to');
      const key = `${lng},${lat}>${toLng},${toLat}`;
      return buildSmartTransitOptions(lng, lat, toLng, toLat, key, transitMapAllowed, env);
    }
    if (action === 'transit-live') {
      const region = params.get('region') === 'gyeonggi' ? 'gyeonggi' : 'seoul';
      const targetRoute = str(params.get('route'));
      const stationName = str(params.get('stationName'));
      const arrivalApiKey = required(env, region === 'seoul' ? 'SEOUL_BUS_SERVICE_KEY' : 'GYEONGGI_BUS_SERVICE_KEY');
      let stationId = str(params.get('station'));
      let resolvedName = stationName || '승차 정류소';
      let resolvedNumber = stationId;
      const validDirectId = region === 'seoul' ? /^\d{5}$/.test(stationId) : /^\d{9}$/.test(stationId);
      if (!validDirectId) {
        const [lng, lat] = point(params);
        const stations = (await resolveStations(region, lng, lat, env))
          .filter(s => (region === 'seoul' ? /^\d{5}$/ : /^\d{9}$/).test(s.id));
        if (!stations.length) throw new TransportError('upstream', '승차 지점 주변 500m 안에 조회 가능한 정류소가 없어요.');
        const cleanTarget = stationName.replace(/\s+/g, '');
        const best = (cleanTarget ? stations.find(s => s.name.replace(/\s+/g, '').includes(cleanTarget) || cleanTarget.includes(s.name.replace(/\s+/g, ''))) : undefined) || stations[0];
        stationId = best.id; resolvedName = best.name; resolvedNumber = best.number || best.id;
      }
      const arrQuery = new URLSearchParams();
      arrQuery.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', arrivalApiKey);
      arrQuery.set(region === 'seoul' ? 'resultType' : 'format', 'json');
      arrQuery.set(region === 'seoul' ? 'arsId' : 'stationId', stationId);
      const arrEndpoint = region === 'seoul' ? 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
      consume(region);
      const arrBody = await json(`${arrEndpoint}?${arrQuery}`, {});
      const arrivals = parseArrivals(arrBody, region);
      const { matched, others } = matchRouteArrivals(arrivals, targetRoute);
      return {
        stationName: resolvedName, stationNumber: resolvedNumber, route: targetRoute,
        matched, others: others.slice(0, 8), fetchedAt: new Date().toISOString(),
        source: region === 'seoul' ? '서울 TOPIS' : '경기 GBIS',
      };
    }
    const region = params.get('region');
    if (region !== 'seoul' && region !== 'gyeonggi') throw new TransportError('unsupported', '서울·경기 버스를 지원해요. 지역을 선택하세요.');
    if (action === 'stations') {
      const [lng, lat] = point(params);
      return resolveStations(region, lng, lat, env);
    }
    const apiKey = required(env, region === 'seoul' ? 'SEOUL_BUS_SERVICE_KEY' : 'GYEONGGI_BUS_SERVICE_KEY');
    const query = new URLSearchParams();
    query.set(region === 'seoul' ? 'ServiceKey' : 'serviceKey', apiKey);
    query.set(region === 'seoul' ? 'resultType' : 'format', 'json');
    const id = params.get('station') || '';
    if (!(region === 'seoul' ? /^\d{5}$/ : /^\d{9}$/).test(id)) throw new TransportError('invalid', region === 'seoul' ? '정류소 번호 5자리를 확인하세요.' : '경기 정류소 ID 9자리를 확인하세요.');
    query.set(region === 'seoul' ? 'arsId' : 'stationId', id);
    const endpoint = region === 'seoul' ? 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid' : 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
    consume(region);
    const body = await json(`${endpoint}?${query}`, {});
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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const fail = (status, code, message) => { res.statusCode = status; res.end(JSON.stringify({ code, message })); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return fail(405, 'invalid', 'GET 요청만 지원해요.'); }
  const ip = String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'local');
  const now = Date.now();
  if (limits.size > 2000) for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
  const limit = limits.get(ip);
  if (limit && limit.reset > now && limit.count >= 60) { res.setHeader('Retry-After', '60'); return fail(429, 'quota', '조회가 잦아요. 1분 후 다시 확인하세요.'); }
  limits.set(ip, limit && limit.reset > now ? { ...limit, count: limit.count + 1 } : { reset: now + 60000, count: 1 });
  try {
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const env = { ...DEFAULT_ENV, ...process.env };
    const data = await transportData(params, env);
    res.statusCode = 200;
    res.end(JSON.stringify({ data }));
  } catch (error) {
    if (error instanceof TransportError) {
      return fail(error.code === 'invalid' ? 400 : error.code === 'quota' ? 429 : error.code === 'upstream' ? 502 : 503, error.code, error.message);
    }
    return fail(502, 'upstream', '정보를 가져오지 못했어요. 잠시 후 다시 확인하세요.');
  }
}
