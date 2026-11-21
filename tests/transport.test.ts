import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carFor, decodeShare, encodeShare, legMinutes, makeRoute, makeStop, routeText, transitFor, walkingKey } from '../src/domain.ts';
import { firstTransitStep, normalizeRouteName, transportRequest, type TransitOption, type TransitRouteResult, type WalkingResult } from '../src/transport.ts';
import { originLegId, sortTransitOptions, transitArrivalTime, transitCategory, transitDepartureTime, transitLegs } from '../src/transitCandidates.ts';
import handler, { handleTransport, matchRouteArrivals, parseOdsayTransit, parseSubwayArrivals, parseTmapPois, parseTmapReverseGeocode, parseTmapTransit, transportData, TransportError } from '../api/transport.ts';

test('normalizeRouteName and matchRouteArrivals match transit route numbers against station arrivals', () => {
  assert.equal(normalizeRouteName('간선:302'), '302');
  assert.equal(normalizeRouteName('지선 2224번'), '2224');
  assert.equal(normalizeRouteName('수도권 2호선'), '2호선');
  const arrivals = [
    { route: '2224', direction: '건대입구', first: '2분 후', second: '9분 후' },
    { route: '302', direction: '잠실역', first: '4분 후', second: '12분 후', stopsAway: 2 },
    { route: '3020', direction: '다른 방면', first: '1분 후', second: '9분 후' },
  ];
  const { matched, others } = matchRouteArrivals(arrivals, '간선:302');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].route, '302');
  assert.equal(matched[0].first, '4분 후');
  assert.equal(others.length, 2);
  assert.equal(others[0].route, '2224');
});

test('parseTmapTransit normalizes multi-leg itineraries and respects mapAllowed geometry rules', () => {
  const sample = {
    metaData: {
      plan: {
        itineraries: [{
          totalTime: 1320,
          transferCount: 1,
          totalWalkTime: 300,
          fare: { regular: { totalFare: 1500 } },
          legs: [
            { mode: 'WALK', sectionTime: 180, distance: 210, start: { name: '성수카페', lon: 127.055, lat: 37.544 }, end: { name: '성수역', lon: 127.056, lat: 37.545 }, steps: [{ linestring: '127.055,37.544 127.056,37.545' }] },
            { mode: 'BUS', route: '간선:302', sectionTime: 600, distance: 2400, start: { name: '성수역', lon: 127.056, lat: 37.545 }, end: { name: '건대입구역', lon: 127.070, lat: 37.540 }, passStopList: { stationList: [{ stationID: '04112' }, { stationID: '04113' }, { stationID: '04114' }] }, passShape: { linestring: '127.056,37.545 127.063,37.542 127.070,37.540' } },
            { mode: 'SUBWAY', route: '수도권 2호선', sectionTime: 420, distance: 3100, start: { name: '건대입구', lon: 127.070, lat: 37.540 }, end: { name: '잠실', lon: 127.100, lat: 37.513 }, passStopList: { stationList: [{}, {}, {}, {}] }, passShape: { linestring: '127.070,37.540 127.100,37.513' } },
          ],
        }],
      },
    },
  };
  const key = '127.055,37.544>127.1,37.513';
  const restricted = parseTmapTransit(sample, key, false);
  assert.equal(restricted.options.length, 1);
  assert.equal(restricted.options[0].minutes, 22);
  assert.equal(restricted.options[0].transfers, 1);
  assert.equal(restricted.options[0].fare, 1500);
  assert.equal(restricted.options[0].summary, '간선:302 → 수도권 2호선');
  assert.equal(restricted.options[0].coordinates.length, 0);
  assert.equal(firstTransitStep(restricted.options[0])?.route, '간선:302');
  assert.equal(firstTransitStep(restricted.options[0])?.stops, 2);
  assert.equal(firstTransitStep(restricted.options[0])?.stationId, undefined);

  const allowed = parseTmapTransit(sample, key, true);
  assert.ok(allowed.options[0].coordinates.length >= 4);
  assert.equal(allowed.options[0].provider, 'tmap');
  assert.equal(allowed.options[0].steps[1].coordinates?.length, 3);
  assert.equal(restricted.options[0].steps[1].coordinates, undefined);
});

test('parseOdsayTransit normalizes ODSay subPaths and station metadata', () => {
  const sample = {
    result: {
      path: [{
        info: { totalTime: 18, busTransitCount: 1, subwayTransitCount: 0, payment: 1500 },
        subPath: [
          { trafficType: 3, sectionTime: 4, distance: 250 },
          { trafficType: 2, sectionTime: 11, distance: 3200, stationCount: 5, startName: '성수동구두테마공원', endName: '뚝섬역', startX: 127.057, startY: 37.543, endX: 127.047, endY: 37.547, startArsID: '04-215', lane: [{ busNo: '2016' }] },
          { trafficType: 3, sectionTime: 3, distance: 180 },
        ],
      }],
    },
  };
  const parsed = parseOdsayTransit(sample, '127.057,37.543>127.047,37.547', true);
  assert.equal(parsed.options.length, 1);
  assert.equal(parsed.options[0].summary, '2016');
  assert.equal(parsed.options[0].transfers, 0);
  assert.equal(parsed.options[0].walkMinutes, 7);
  const first = firstTransitStep(parsed.options[0]);
  assert.equal(first?.stationId, '04215');
  assert.equal(first?.from, '성수동구두테마공원');
});

test('nearby TMAP transit legs reuse the pedestrian result and keep the walking category', async () => {
  const endpoints = { lng: '127.0151', lat: '37.2819', toLng: '127.0144', toLat: '37.2835' };
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/transit/routes') return Response.json({ result: { status: 11, message: '출발지와 도착지가 너무 가까움' } });
    assert.equal(url.pathname, '/tmap/routes/pedestrian');
    return Response.json({
      features: [
        { geometry: { type: 'Point' }, properties: { totalTime: 233, totalDistance: 252 } },
        { geometry: { type: 'LineString', coordinates: [[127.0151, 37.2819], [127.0144, 37.2835]] } },
      ],
    });
  };
  const env = { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' };
  const [result, walk] = await Promise.all([
    transportData(new URLSearchParams({ action: 'transit', ...endpoints }), env, fetcher),
    transportData(new URLSearchParams({ action: 'walk', ...endpoints }), env, fetcher),
  ]) as [TransitRouteResult, WalkingResult];
  assert.equal(result.nearby, true);
  assert.equal(result.source, 'TMAP 도보');
  assert.equal(result.options.length, 1);
  assert.equal(transitCategory(result.options[0]), 'walk');
  assert.equal(result.options[0].minutes, 4);
  assert.equal(result.options[0].steps[0].meters, 252);
  assert.equal(result.fetchedAt, walk.fetchedAt);
  assert.equal(result.mapAllowed, false);
  assert.deepEqual(result.options[0].coordinates, []);
  assert.deepEqual(calls.sort(), ['/tmap/routes/pedestrian', '/transit/routes']);
});

test('nearby TMAP transit legs leave the candidate list empty without a pedestrian entitlement', async () => {
  const params = new URLSearchParams({ action: 'transit', lng: '127.016', lat: '37.2819', toLng: '127.0144', toLat: '37.2835' });
  const result = await transportData(params, { TMAP_APP_KEY: 'test-key', TMAP_TRANSIT_CONFIRMED: 'true' }, async input => {
    assert.equal(new URL(String(input)).pathname, '/transit/routes');
    return Response.json({ result: { status: 11 } });
  }) as TransitRouteResult;
  assert.equal(result.nearby, true);
  assert.deepEqual(result.options, []);
});

test('transit-live stitches boarding station lookup with live arrival matching', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('getStationByPos')) {
      return new Response(JSON.stringify({
        msgHeader: { headerCd: '0' },
        msgBody: { itemList: [
          { arsId: '04113', stationNm: '성수역3번출구', dist: 48 },
          { arsId: '04112', stationNm: '성수역3번출구', dist: 3 },
        ] },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      msgHeader: { headerCd: '0' },
      msgBody: { itemList: [
        { rtNm: '302', adirection: '잠실', arrmsg1: '3분 20초후[1번째 전]', arrmsg2: '11분후[5번째 전]' },
        { rtNm: '2016', adirection: '효창공원', arrmsg1: '6분후', arrmsg2: '15분후' },
      ] },
    }), { status: 200 });
  };
  const params = new URLSearchParams({
    action: 'transit-live',
    mode: 'bus',
    region: 'seoul',
    route: '간선:302',
    stationName: '성수역 3번 출구',
    stationPoint: 'true',
    lng: '127.056',
    lat: '37.545',
  });
  const env = { SEOUL_BUS_SERVICE_KEY: 'test-key' };
  const res = await transportData(params, env, fakeFetch) as {
    stationName: string; stationNumber?: string; matched: { route: string; first: string }[]; others: { route: string }[];
    fetchedAt: string;
  };
  assert.equal(calls.length, 2);
  assert.equal(res.stationName, '성수역3번출구');
  assert.equal(res.stationNumber, '04112');
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].route, '302');
  assert.equal(res.others.length, 1);
  assert.equal(res.others[0].route, '2016');
  assert.ok(calls[1].includes('arsId=04112'));

  const nearby = await transportData(new URLSearchParams({ action: 'arrivals', region: 'seoul', station: '04112' }), env, fakeFetch) as { fetchedAt: string };
  assert.equal(nearby.fetchedAt, res.fetchedAt);
  params.delete('stationPoint');
  await assert.rejects(transportData(params, env, fakeFetch),
    (error: unknown) => error instanceof TransportError && error.code === 'unsupported');

  params.set('stationName', '다른 정류소');
  await assert.rejects(transportData(params, env, fakeFetch),
    (error: unknown) => error instanceof TransportError && error.code === 'unsupported');
  assert.equal(calls.length, 2);
});

test('a cancelled browser view leaves a shared request available to another view', async t => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  t.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  let reply!: (response: Response) => void;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { reply = resolve; }));
  const first = new AbortController();
  const second = new AbortController();
  const a = transportRequest({ action: 'pois', q: '병렬 조회 검증' }, first.signal);
  const b = transportRequest({ q: '병렬 조회 검증', action: 'pois' }, second.signal);
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(fetchMock.mock.callCount(), 1);
  reply(Response.json({ data: ['장소'] }));
  assert.deepEqual(await b, ['장소']);
  assert.deepEqual(await transportRequest({ action: 'pois', q: '병렬 조회 검증' }, second.signal), ['장소']);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('the provider response limit rejects an oversized body before parsing', async () => {
  const oversized = new Uint8Array(4_000_001);
  await assert.rejects(transportData(
    new URLSearchParams({ action: 'pois', q: '응답 크기 검사' }),
    { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' },
    async () => new Response(oversized),
  ), (error: unknown) => error instanceof TransportError && error.code === 'upstream' && error.message.includes('너무 커요'));
});

test('subway arrivals use the line ID and keep the provider direction', () => {
  const arrivals = parseSubwayArrivals({ realtimeArrivalList: [
    { subwayId: 1002, trainLineNm: '성수행', updnLine: '내선', arvlMsg2: '3분 후' },
    { subwayId: 1063, trainLineNm: '문산행', arvlMsg2: '5분 후' },
  ] });
  const { matched } = matchRouteArrivals(arrivals, '수도권 2호선');
  assert.deepEqual(matched.map(({ route, direction, first }) => ({ route, direction, first })),
    [{ route: '2호선', direction: '성수행', first: '3분 후' }]);
});

test('the deployment entry point does not suggest bus routes with only an arrival provider configured', async t => {
  const keys = ['TMAP_APP_KEY', 'ODSAY_API_KEY', 'SEOUL_BUS_SERVICE_KEY'];
  const previous = keys.map(key => process.env[key]);
  delete process.env.TMAP_APP_KEY;
  delete process.env.ODSAY_API_KEY;
  process.env.SEOUL_BUS_SERVICE_KEY = 'test-key';
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  let body = '';
  const req = { method: 'GET', url: '/api/transport?action=transit&lng=127.01&lat=37.52&toLng=127.03&toLat=37.55', headers: {} } as IncomingMessage;
  const res = { setHeader() {}, end(value: string) { body = value; } } as unknown as ServerResponse;
  try {
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(body).code, 'unconfigured');
    assert.equal(upstream.mock.callCount(), 0);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test('candidate categories use boarding modes and sorting keeps unknown fares after known fares', () => {
  const option = (id: string, modes: TransitOption['steps'][number]['mode'][], minutes: number, fare?: number): TransitOption => ({
    id, key: 'test', summary: id, minutes, fare, transfers: 0, walkMinutes: 0,
    fetchedAt: '2026-11-21T00:20:00Z', steps: modes.map(mode => ({ mode, minutes: 1 })), coordinates: [],
  });
  const options = [option('bus', ['walk', 'bus'], 18, 1500), option('rail', ['subway', 'train'], 10),
    option('mixed', ['bus', 'subway'], 15, 2000), option('walk', ['walk'], 29, 0)];
  assert.deepEqual(options.map(transitCategory), ['bus', 'rail', 'mixed', 'walk']);
  assert.deepEqual(sortTransitOptions(options, 'fare').map(item => item.id), ['walk', 'bus', 'mixed', 'rail']);
  assert.deepEqual(sortTransitOptions(options, 'duration').map(item => item.id), ['rail', 'mixed', 'bus', 'walk']);
  assert.equal(options[0].id, 'bus');
  assert.equal(transitDepartureTime('2026-11-21T00:20:00Z'), '09:20');
  assert.equal(transitArrivalTime('+1일 23:50', 20), '+2일 00:10');
});

test('the GPS leg points to the actual first stop and regular legs never cross a missing location', () => {
  const first = makeStop({ name: '첫 장소' });
  const second = makeStop({ name: '두 번째 장소', lng: 127.01, lat: 37.52 });
  const third = makeStop({ name: '세 번째 장소', lng: 127.03, lat: 37.55 });
  const location = { lng: 127.02, lat: 37.54 };
  const legs = transitLegs([first, second, third], location, ['09:00', '10:00', '11:00']);
  assert.deepEqual(legs.map(({ id, departure }) => [id, departure]), [[second.id, '10:00']]);
  const withFirstPin = transitLegs([{ ...first, ...location }, second, third], location);
  assert.equal(withFirstPin[0].id, originLegId);
  assert.equal(withFirstPin[0].to.id, first.id);
});

test('domain schedule, share snapshot and routeText integrate saved transit legs', () => {
  const a = makeStop({ name: '성수역', lng: 127.056, lat: 37.545, mode: 'transit', duration: 60, travelMinutes: 15 });
  const b = makeStop({ name: '잠실역', lng: 127.100, lat: 37.513, duration: 90 });
  a.transit = {
    key: walkingKey(a, b),
    summary: '2호선',
    minutes: 24,
    transfers: 0,
    walkMinutes: 4,
    fare: 1500,
    fetchedAt: new Date().toISOString(),
    steps: [{ mode: 'subway', minutes: 20, route: '2호선', from: '성수', to: '잠실', stops: 6 }],
    coordinates: [[127.056, 37.545], [127.100, 37.513]],
  };
  const route = { ...makeRoute(), stops: [a, b] };
  assert.equal(transitFor(a, b)?.minutes, 24);
  assert.equal(legMinutes(route, 0), 24);
  assert.ok(routeText(route).includes('다음 장소까지 24분 (대중교통: 2호선)'));
  const roundtrip = decodeShare(encodeShare(route));
  assert.equal(roundtrip.stops[0].transit?.summary, '2호선');
});

test('parseTmapPois, parseTmapReverseGeocode and carFor support TMAP place search, geocoding and driving legs', () => {
  const pois = parseTmapPois({
    searchPoiInfo: {
      pois: {
        poi: [{
          id: '1001',
          name: '성수 베이커리 카페',
          noorLon: '127.0558',
          noorLat: '37.5445',
          upperBizName: '음식점',
          middleBizName: '카페/디저트',
          newAddressList: { newAddress: [{ fullAddressRoad: '서울특별시 성동구 연무장길 10' }] },
        }],
      },
    },
  });
  assert.equal(pois.length, 1);
  assert.equal(pois[0].category, '카페');
  assert.equal(pois[0].address, '서울특별시 성동구 연무장길 10');

  const geo = parseTmapReverseGeocode({ addressInfo: { fullAddress: '서울특별시 성동구 성수동2가 315-71' } });
  assert.equal(geo.address, '서울특별시 성동구 성수동2가 315-71');

  const a = makeStop({ name: '출발', lng: 127.05, lat: 37.54, mode: 'car', travelMinutes: 20 });
  const b = makeStop({ name: '도착', lng: 127.10, lat: 37.51 });
  a.car = { key: walkingKey(a, b), minutes: 12, meters: 5400, fetchedAt: new Date().toISOString(), coordinates: [] };
  const route = { ...makeRoute(), stops: [a, b] };
  assert.equal(carFor(a, b)?.minutes, 12);
  assert.equal(legMinutes(route, 0), 12);
});

test('transportData fails with unconfigured when provider API keys are absent', async () => {
  const params = new URLSearchParams({
    action: 'walk',
    lng: '127.056',
    lat: '37.545',
    toLng: '127.060',
    toLat: '37.548',
  });
  await assert.rejects(
    () => transportData(params, { TMAP_FREE_PLAN_CONFIRMED: 'true' }, async () => {
      throw new Error('fetch should not be called without an API key');
    }),
    (err: unknown) => err instanceof TransportError && err.code === 'unconfigured',
  );
});

test('transportData distinguishes HTTP 429 quota and 401 unconfigured upstream errors', async () => {
  const poiParams = new URLSearchParams({ action: 'pois', q: '강남역카페429' });
  await assert.rejects(
    () => transportData(
      poiParams,
      { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' },
      async () => new Response('rate limited', { status: 429 }),
    ),
    (err: unknown) => err instanceof TransportError && err.code === 'quota',
  );

  const arrivalParams = new URLSearchParams({ action: 'arrivals', region: 'seoul', station: '04119' });
  await assert.rejects(
    () => transportData(
      arrivalParams,
      { SEOUL_BUS_SERVICE_KEY: 'test-key' },
      async () => new Response('unauthorized', { status: 401 }),
    ),
    (err: unknown) => err instanceof TransportError && err.code === 'unconfigured',
  );
});

test('transportData converts upstream fetch timeouts into upstream TransportError with AbortSignal', async () => {
  let sawSignal = false;
  const params = new URLSearchParams({ action: 'reverse-geocode', lng: '127.0551', lat: '37.5441' });
  await assert.rejects(
    () => transportData(
      params,
      { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' },
      async (_input, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        throw new DOMException('The operation timed out.', 'TimeoutError');
      },
    ),
    (err: unknown) => err instanceof TransportError && err.code === 'upstream',
  );
  assert.equal(sawSignal, true);
});

test('transportData deduplicates concurrent identical inflight upstream requests', async () => {
  let fetchCount = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCount += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return new Response(JSON.stringify({
      searchPoiInfo: { pois: { poi: [{ id: 'p1', name: '성수 서점', noorLon: '127.056', noorLat: '37.545' }] } },
    }), { status: 200 });
  };
  const params = new URLSearchParams({ action: 'pois', q: '성수역서점중복' });
  const env = { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' };
  const [first, second] = await Promise.all([
    transportData(params, env, fakeFetch),
    transportData(params, env, fakeFetch),
  ]) as [{ name: string }[], { name: string }[]];
  assert.equal(fetchCount, 1);
  assert.equal(first[0].name, '성수 서점');
  assert.equal(second[0].name, '성수 서점');
});

test('transportData normalizes cache keys to ignore unknown query parameters', async () => {
  let fetchCount = 0;
  const fakeFetch: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      searchPoiInfo: { pois: { poi: [{ id: 'p2', name: '뚝섬 공원', noorLon: '127.047', noorLat: '37.547' }] } },
    }), { status: 200 });
  };
  const env = { TMAP_APP_KEY: 'test-key', TMAP_FREE_PLAN_CONFIRMED: 'true' };
  const first = await transportData(new URLSearchParams({ action: 'pois', q: '뚝섬캐시정규화', junk: 'a' }), env, fakeFetch) as { name: string }[];
  const second = await transportData(new URLSearchParams({ action: 'pois', q: '뚝섬캐시정규화', junk: 'b' }), env, fakeFetch) as { name: string }[];
  assert.equal(fetchCount, 1);
  assert.equal(first[0].name, '뚝섬 공원');
  assert.equal(second[0].name, '뚝섬 공원');
});

function runMockTransport(reqInit: { method?: string; url?: string; headers?: Record<string, string> }) {
  const headers = new Map<string, string>();
  let body = '';
  const req = {
    method: reqInit.method ?? 'GET',
    url: reqInit.url ?? '/api/transport?action=status',
    headers: reqInit.headers ?? { host: 'dayroute.example' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(chunk?: string) { body = String(chunk || ''); },
  } as unknown as ServerResponse;
  return handleTransport(req, res, {}).then(() => ({ statusCode: res.statusCode, headers, body: JSON.parse(body || '{}') }));
}

test('handleTransport enforces GET, origin/cross-site checks, URL length limits, and security headers', async () => {
  const postRes = await runMockTransport({ method: 'POST' });
  assert.equal(postRes.statusCode, 405);
  assert.equal(postRes.headers.get('allow'), 'GET');
  assert.equal(postRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(postRes.headers.get('cache-control'), 'no-store');

  const malformedOrigin = await runMockTransport({
    headers: { host: 'dayroute.example', origin: 'not-a-valid-url' },
  });
  assert.equal(malformedOrigin.statusCode, 403);

  const foreignOrigin = await runMockTransport({
    headers: { host: 'dayroute.example', origin: 'https://evil.example' },
  });
  assert.equal(foreignOrigin.statusCode, 403);

  const crossSite = await runMockTransport({
    headers: { host: 'dayroute.example', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.statusCode, 403);

  const longUrl = await runMockTransport({
    url: `/api/transport?action=status&pad=${'a'.repeat(2100)}`,
  });
  assert.equal(longUrl.statusCode, 400);

  const okRes = await runMockTransport({
    headers: { host: 'dayroute.example', origin: 'https://dayroute.example', 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.data.walking, false);
});

