import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneRoute, decodeShare, encodeShare, makeRoute, makeStop, MAX_COVER_LENGTH, parseLibrary, validRoute } from '../src/domain.ts';
import { routeSketch } from '../src/routeSketch.ts';

// A real 1x1 WebP header/image, used only for model and round-trip validation.
const photo = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
test('old backups without a cover remain valid; photo backups and clones preserve the photo', () => {
  const legacy = makeRoute();
  assert.equal(validRoute(legacy), true);
  const route = { ...legacy, coverPhoto: photo };
  assert.equal(validRoute(route), true);
  const restored = parseLibrary(JSON.stringify({ schemaVersion: 1, routes: [route] })).routes[0];
  assert.equal(restored.coverPhoto, photo);
  assert.equal(cloneRoute(restored).coverPhoto, photo);
});
test('share links intentionally omit photos while keeping the itinerary', () => {
  const route = { ...makeRoute(), coverPhoto: photo, stops: [makeStop({ name: '우리 장소' })] };
  const decoded = decodeShare(encodeShare(route));
  assert.equal(decoded.coverPhoto, undefined); assert.deepEqual(decoded.stops, route.stops);
});
test('import rejects remote URLs, SVG, fake headers, oversized photo data and non-string covers', () => {
  for (const coverPhoto of ['https://example.com/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/webp;base64,AAAA', photo + 'A'.repeat(MAX_COVER_LENGTH), 123]) {
    assert.equal(validRoute({ ...makeRoute(), coverPhoto }), false);
  }
});
test('empty and coincident locations produce finite, centered sketches', () => {
  assert.deepEqual(routeSketch([makeStop()]), { points: [], segments: [], located: 0 });
  const stops = [makeStop({ lng: 127, lat: 37 }), makeStop({ lng: 127, lat: 37 })];
  const sketch = routeSketch(stops);
  assert.deepEqual(sketch.points, [{ x: 240, y: 120, indices: [1, 2] }]);
  assert.equal(sketch.segments.length, 0);
});
test('sketch preserves north/east ordering, fits its frame and never joins across a missing pin', () => {
  const a = makeStop({ lng: 127, lat: 37 }), b = makeStop({ lng: 127.01, lat: 37.02 });
  const sketch = routeSketch([a, b]);
  assert.equal(sketch.segments.length, 1);
  assert.ok(sketch.points[1].x > sketch.points[0].x && sketch.points[1].y < sketch.points[0].y);
  assert.ok(sketch.points.every(p => p.x >= 79 && p.x <= 401 && p.y >= 52 && p.y <= 188));
  assert.equal(routeSketch([a, makeStop(), b]).segments.length, 0);
});
