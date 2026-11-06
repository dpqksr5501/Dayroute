import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeShare, encodeShare, legMinutes, makeRoute, makeStop, routeText, transitFor, walkingKey } from '../src/domain.ts';
import { firstTransitStep, normalizeRouteName } from '../src/transport.ts';
import { matchRouteArrivals, parseOdsayTransit, parseTmapTransit, transportData } from '../server/transport.ts';

test('normalizeRouteName and matchRouteArrivals match transit route numbers against station arrivals', () => {
  assert.equal(normalizeRouteName('간선:302'), '302');
  assert.equal(normalizeRouteName('지선 2224번'), '2224');
  assert.equal(normalizeRouteName('수도권 2호선'), '2호선');
  const arrivals = [
    { route: '2224', direction: '건대입구', first: '2분 후', second: '9분 후' },
    { route: '302', direction: '잠실역', first: '4분 후', second: '12분 후', stopsAway: 2 },
  ];
  const { matched, others } = matchRouteArrivals(arrivals, '간선:302');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].route, '302');
  assert.equal(matched[0].first, '4분 후');
  assert.equal(others.length, 1);
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

  const allowed = parseTmapTransit(sample, key, true);
  assert.ok(allowed.options[0].coordinates.length >= 4);
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

test('transit-live stitches boarding station lookup with live arrival matching', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('getStationByPos')) {
      return new Response(JSON.stringify({
        msgHeader: { headerCd: '0' },
        msgBody: { itemList: [{ arsId: '04112', stationNm: '성수역3번출구', dist: 85 }] },
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
    stationName: '성수역',
    lng: '127.056',
    lat: '37.545',
  });
  const res = await transportData(params, { SEOUL_BUS_SERVICE_KEY: 'test-key' }, fakeFetch) as {
    stationName: string; stationNumber?: string; matched: { route: string; first: string }[]; others: { route: string }[];
  };
  assert.equal(calls.length, 2);
  assert.equal(res.stationName, '성수역3번출구');
  assert.equal(res.stationNumber, '04112');
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].route, '302');
  assert.equal(res.others.length, 1);
  assert.equal(res.others[0].route, '2016');
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
