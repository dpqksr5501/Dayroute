import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStop } from '../src/domain.ts';
import { mapPreviewPlan, previewKey } from '../src/mapPreviewPlan.ts';

test('overview bounds include every located stop and preserve original visit numbers', () => {
  const stops = [makeStop({ lng: 127.04, lat: 37.54 }), makeStop(), makeStop({ lng: 127.32, lat: 37.53 }), makeStop({ lng: 126.98, lat: 37.58 })];
  const plan = mapPreviewPlan(stops);
  assert.deepEqual(plan.bounds, [[126.98, 37.53], [127.32, 37.58]]);
  assert.deepEqual(plan.pins.map(p => p.number), [1, 3, 4]);
  assert.equal(plan.segments.length, 1);
  assert.deepEqual(plan.segments[0], [[127.32, 37.53], [126.98, 37.58]]);
});
test('empty and single-location overviews are valid without fabricated coordinates', () => {
  assert.deepEqual(mapPreviewPlan([makeStop()]), { pins: [], segments: [], bounds: null });
  assert.deepEqual(mapPreviewPlan([makeStop({ lng: 127, lat: 37 })]).bounds, [[127, 37], [127, 37]]);
});
test('thumbnail cache changes with geometry/order/color but ignores notes and titles', () => {
  const a = makeStop({ lng: 127, lat: 37 }), b = makeStop({ lng: 128, lat: 38 });
  assert.equal(previewKey([a, b], 'forest'), previewKey([{ ...a, note: 'changed', name: 'changed' }, b], 'forest'));
  assert.notEqual(previewKey([a, b], 'forest'), previewKey([b, a], 'forest'));
  assert.notEqual(previewKey([a, b], 'forest'), previewKey([a, b], 'river'));
});
