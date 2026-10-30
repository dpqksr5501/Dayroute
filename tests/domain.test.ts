import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneRoute, decodeShare, directDistance, encodeShare, makeRoute, makeStop, parseLibrary, schedule, totalMinutes, validRoute } from '../src/domain.ts';

test('duration excludes the final unused travel leg and the schedule crosses midnight', () => {
  const r = { ...makeRoute(), startTime: '23:30', stops: [makeStop({ duration: 60, travelMinutes: 15 }), makeStop({ duration: 30, travelMinutes: 900 })] };
  assert.equal(totalMinutes(r), 105);
  assert.deepEqual(schedule(r), ['23:30', '+1일 00:45']);
});
test('cloning resets the date and identity while preserving the original itinerary', () => {
  const r = { ...makeRoute(), date: '2026-11-07', favorite: true, stops: [makeStop({ note: '우리의 메모' })] };
  const copy = cloneRoute(r);
  assert.notEqual(copy.id, r.id); assert.notEqual(copy.stops[0].id, r.stops[0].id);
  assert.equal(copy.date, ''); assert.equal(copy.favorite, false);
  copy.stops[0].note = '다른 메모'; assert.equal(r.stops[0].note, '우리의 메모');
});
test('Korean and emoji survive share snapshots; later edits do not change an encoded snapshot', () => {
  const r = { ...makeRoute(), title: '우리의 하루 🌳', stops: [makeStop({ name: '서울숲', note: '같이 걷자 💚' })] };
  const encoded = encodeShare(r); assert.deepEqual(decodeShare(encoded), r);
  r.stops[0].name = '바뀐 장소'; assert.equal(decodeShare(encoded).stops[0].name, '서울숲');
});
test('backup rejects invalid coordinates, wrong versions, duplicate IDs and oversized payloads', () => {
  const r = makeRoute();
  assert.equal(parseLibrary(JSON.stringify({ schemaVersion: 1, routes: [r] })).routes.length, 1);
  assert.throws(() => parseLibrary(JSON.stringify({ schemaVersion: 2, routes: [r] })));
  assert.throws(() => parseLibrary(JSON.stringify({ schemaVersion: 1, routes: [r, r] })));
  assert.throws(() => parseLibrary(' '.repeat(5_000_001)));
  assert.equal(validRoute({ ...r, stops: [makeStop({ lng: 181, lat: 30 })] }), false);
  assert.equal(validRoute({ ...r, stops: [makeStop({ lng: 127, lat: null })] }), false);
  assert.equal(validRoute({ ...r, startTime: '25:00' }), false);
  assert.throws(() => decodeShare('not-valid-json'));
});
test('unknown locations do not fabricate connections across missing pins', () => {
  const a = makeStop({ lng: 127, lat: 37 }), b = makeStop({ lng: 127, lat: 38 });
  assert.ok(directDistance([a, b]) > 110 && directDistance([a, b]) < 112);
  assert.equal(directDistance([a, makeStop(), b]), 0);
  assert.equal(directDistance([]), 0);
});
