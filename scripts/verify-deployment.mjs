import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const base = new URL(args.find(arg => !arg.startsWith('--')) || 'https://dayroute-eight.vercel.app');
assert.equal(base.protocol, 'https:', 'Use the HTTPS deployment URL');
assert.ok(!base.username && !base.password && base.href === `${base.origin}/`, 'Use the site origin only');

async function fetchPath(path) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, 'Expected a same-origin URL');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  assert.equal(response.status, 200, `${url.pathname}${url.search}`);
  return response;
}

async function jsonPath(path) {
  const response = await fetchPath(path);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  return response.json();
}

const [page, version, health] = await Promise.all([
  fetchPath('/'), jsonPath('/version.json'), jsonPath('/api/transport?action=status'),
]);

const csp = page.headers.get('content-security-policy') || '';
assert.match(csp, /(?:^|;\s*)script-src 'self'(?:;|$)/);
assert.match(csp, /(?:^|;\s*)worker-src 'self'(?:;|$)/);
assert.ok(typeof version.build === 'string' && version.build, 'Release identifier is missing');
const script = (await page.text()).match(/<script\b[^>]*\bsrc="(\/assets\/[^"?#]+\.js)"/i)?.[1];
assert.ok(script, 'The app bundle is missing');
const assets = await fetchPath(script);
assert.match(assets.headers.get('content-type') || '', /^(?:application|text)\/javascript\b/);
await assets.body?.cancel();

for (const key of ['walking', 'walkingMap', 'car', 'pois', 'transit', 'transitMap', 'transitSharedBudget', 'seoul', 'gyeonggi', 'subway']) {
  assert.equal(typeof health.data?.[key], 'boolean', `Missing transport capability: ${key}`);
}
if (!args.includes('--preview')) {
  for (const key of ['transit', 'transitSharedBudget', 'seoul', 'subway']) assert.equal(health.data[key], true, `Production capability is disabled: ${key}`);
}
console.log(`${base.origin} · ${version.build} · app bundle, CSP and transport endpoint OK`);

if (args.includes('--arrivals')) {
  const checks = [
    { label: '성동13', source: '서울 TOPIS', params: { mode: 'bus', region: 'seoul', route: '성동13', station: '04862' } },
    { label: '2호선', source: '서울 실시간 지하철', params: { mode: 'subway', route: '2호선', stationName: '성수역(2호선)' } },
  ];
  await Promise.all(checks.map(async ({ label, params, source }) => {
    const query = new URLSearchParams({ action: 'transit-live', ...params });
    const { data } = await jsonPath(`/api/transport?${query}`);
    assert.equal(data?.source, source);
    assert.equal(data?.route, label);
    assert.ok(Number.isFinite(Date.parse(data.fetchedAt)) && Array.isArray(data.matched));
    console.log(`${label} · ${data.matched[0]?.first || '현재 도착 예정 정보 없음'} · ${source}`);
  }));
}
