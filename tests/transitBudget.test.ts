import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSharedTransitBudget, reserveTransitRequest } from '../server/transitBudget.ts';

test('free-plan counter admits ten requests and resets at the Seoul date boundary', async () => {
  const before = Date.parse('2026-11-20T14:59:57Z');
  const after = Date.parse('2026-11-20T15:00:00Z');
  const unexpectedFetch: typeof fetch = async () => assert.fail('local counter should not fetch');
  for (let i = 0; i < 10; i++) assert.equal(await reserveTransitRequest({}, unexpectedFetch, before), 0);
  assert.equal(await reserveTransitRequest({}, unexpectedFetch, before), 3);
  assert.equal(await reserveTransitRequest({}, unexpectedFetch, after), 0);
});

test('a configured shared quota uses one authenticated atomic operation with no itinerary data', async () => {
  const env = { KV_REST_API_URL: 'https://quota-test.upstash.io', KV_REST_API_TOKEN: 'dummy' };
  const now = Date.parse('2026-11-20T14:59:59Z');
  let calls = 0;
  const redis: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), `${env.KV_REST_API_URL}/`);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer dummy');
    assert.equal(init?.redirect, 'error');
    const command = JSON.parse(String(init?.body));
    assert.equal(command[0], 'EVAL');
    assert.deepEqual(command.slice(2), [2, 'dayroute:production:tmap-transit:2026-11-20', 'dayroute:production:tmap-transit:pause', 10, 1]);
    return Response.json({ result: 0 });
  };
  assert.equal(hasSharedTransitBudget(env), true);
  assert.equal(await reserveTransitRequest(env, redis, now), 0);
  assert.equal(calls, 1);

  await assert.rejects(reserveTransitRequest(env, async () => new Response(null, { status: 503 }), now));
  const wrongHost = { ...env, KV_REST_API_URL: 'https://quota-test.upstash.io.example.com' };
  assert.equal(hasSharedTransitBudget(wrongHost), false);
  await assert.rejects(reserveTransitRequest(wrongHost, redis, now));
  assert.equal(calls, 1);
});
