import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute } from '../src/domain.ts';
import { loadRoutes, saveRoutes, STORAGE_KEY } from '../src/storage.ts';

test('photo save failures leave previously saved routes intact', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const original = JSON.stringify({ schemaVersion: 1, routes: [makeRoute()] });
  let saved = original, reject = false, writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === STORAGE_KEY ? saved : null,
    setItem: (_key: string, value: string) => { if (reject) throw new Error('QuotaExceededError'); saved = value; writes++; },
  } });
  try {
    assert.equal(loadRoutes().routes.length, 1);
    reject = true;
    assert.equal(saveRoutes([{ ...makeRoute(), coverPhoto: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }], original).ok, false);
    assert.equal(saved, original);
    reject = false;
    assert.equal(saveRoutes(Array.from({ length: 30 }, () => ({ ...makeRoute(), coverPhoto: 'A'.repeat(180_000) })), original).ok, false);
    assert.equal(saved, original);
    const newer = [makeRoute()];
    assert.equal(saveRoutes(newer, original).ok, true);
    const latest = saved;
    assert.deepEqual(saveRoutes([makeRoute()], original), { ok: false, reason: 'conflict' });
    assert.equal(saved, latest);
    assert.deepEqual(saveRoutes(newer, latest), { ok: true, raw: latest });
    assert.equal(writes, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
