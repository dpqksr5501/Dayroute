import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoute } from '../src/domain.ts';
import { loadRoutes, saveRoutes, STORAGE_KEY } from '../src/storage.ts';

test('first edit migrates previous routes and photos without rewriting the legacy copy', async () => {
  const photo = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const first = { ...makeRoute(), title: '이전 코스', coverPhoto: photo };
  const second = { ...makeRoute(), title: '같이 보관한 코스' };
  const original = JSON.stringify({ schemaVersion: 1, routes: [first, second] });
  let legacyReads = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { assert.equal(key, STORAGE_KEY); legacyReads++; return original; },
    setItem() { assert.fail('the original library must never be rewritten'); },
  } });

  const initial = await loadRoutes();
  const stale = await loadRoutes();
  assert.equal(initial.revision, null);
  assert.deepEqual(initial.routes, [first, second]);

  const edited = [{ ...first, title: '첫 수정' }, initial.routes[1]];
  const failedMigration = await saveRoutes([{ ...first, coverPhoto: 'invalid' }, second], initial);
  assert.deepEqual(failedMigration, { ok: false, reason: 'invalid' });
  assert.deepEqual((await loadRoutes()).routes, initial.routes);

  const [winner, conflict] = await Promise.all([saveRoutes(edited, initial), saveRoutes([second], stale)]);
  assert.equal(winner.ok, true);
  assert.deepEqual(conflict, { ok: false, reason: 'conflict' });

  const readsAfterMigration = legacyReads;
  const current = await loadRoutes();
  assert.deepEqual(current.routes, edited);
  assert.deepEqual(await saveRoutes(current.routes, current), { ok: true, revision: current.revision });
  const invalid = [{ ...edited[0], coverPhoto: 'X'.repeat(5_000_000) }, current.routes[1]];
  assert.deepEqual(await saveRoutes(invalid, current), { ok: false, reason: 'invalid' });
  assert.deepEqual((await loadRoutes()).routes, edited);

  const [update, staleDelete] = await Promise.all([
    saveRoutes([current.routes[0], { ...current.routes[1], title: '두 번째 수정' }], current),
    saveRoutes([current.routes[0]], current),
  ]);
  assert.equal(update.ok, true);
  assert.deepEqual(staleDelete, { ok: false, reason: 'conflict' });
  const latest = await loadRoutes();
  assert.deepEqual(latest.routes.map(route => route.title), ['첫 수정', '두 번째 수정']);
  assert.equal(latest.routes[0].coverPhoto, photo);
  assert.equal(legacyReads, readsAfterMigration);

  assert.equal((await saveRoutes([latest.routes[1]], latest)).ok, true);
  assert.deepEqual((await loadRoutes()).routes, [latest.routes[1]]);
  Reflect.deleteProperty(globalThis, 'localStorage');
});
