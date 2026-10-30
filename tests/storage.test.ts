import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute } from '../src/domain.ts';
import { loadRoutes, persistRoutes, STORAGE_KEY } from '../src/storage.ts';

test('photo save failures leave previously saved routes intact', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const original = JSON.stringify({ schemaVersion: 1, routes: [makeRoute()] });
  let saved = original, reject = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === STORAGE_KEY ? saved : null,
    setItem: (_key: string, value: string) => { if (reject) throw new Error('QuotaExceededError'); saved = value; },
  } });
  try {
    assert.equal(loadRoutes().routes.length, 1);
    reject = true;
    assert.equal(persistRoutes([{ ...makeRoute(), coverPhoto: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }]), false);
    assert.equal(saved, original);
    reject = false;
    assert.equal(persistRoutes(Array.from({ length: 30 }, () => ({ ...makeRoute(), coverPhoto: 'A'.repeat(180_000) }))), false);
    assert.equal(saved, original);
    assert.equal(persistRoutes([makeRoute()]), true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
