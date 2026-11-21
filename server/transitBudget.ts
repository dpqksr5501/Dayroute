const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const DAILY_LIMIT = 10;
const DEFAULT_PAUSE_SECONDS = 900;

type Env = Record<string, string | undefined>;
let localDay = '';
let localCount = 0;
let pausedUntil = 0;

// Check the pause and reserve a request in one Redis operation, even on different instances.
const reserve = `
local pause = redis.call('TTL', KEYS[2])
if pause > 0 then return pause end
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return tonumber(ARGV[2]) end
redis.call('INCR', KEYS[1])
if count == 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 0`;

const namespace = 'dayroute:production:tmap-transit';
const pauseKey = `${namespace}:pause`;

function connection(env: Env) {
  const endpoint = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!endpoint && !token) return undefined;
  if (!endpoint || !token) throw new Error('Incomplete transit quota store configuration');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.upstash.io') || url.username || url.password
    || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid transit quota store endpoint');
  return { url, token };
}

export function hasSharedTransitBudget(env: Env): boolean {
  try { return !!connection(env); } catch { return false; }
}

async function command(store: NonNullable<ReturnType<typeof connection>>, args: (string | number)[], fetcher: typeof fetch) {
  const response = await fetcher(store.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(2000), body: JSON.stringify(args),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Transit quota store did not respond');
  }
  const payload = await response.json() as { result?: unknown; error?: unknown };
  if (payload.error || payload.result === undefined) throw new Error('Invalid transit quota store response');
  return payload.result;
}

export async function reserveTransitRequest(env: Env, fetcher: typeof fetch, now = Date.now()): Promise<number> {
  const seoul = now + KST_OFFSET_MS;
  const day = new Date(seoul).toISOString().slice(0, 10);
  const reset = Math.ceil((DAY_MS - seoul % DAY_MS) / 1000);
  if (pausedUntil > now) return Math.ceil((pausedUntil - now) / 1000);
  const store = connection(env);
  if (store) {
    const wait = await command(store, ['EVAL', reserve, 2, `${namespace}:${day}`, pauseKey, DAILY_LIMIT, reset], fetcher);
    if (typeof wait !== 'number' || !Number.isInteger(wait) || wait < 0 || wait > 86_400) throw new Error('Invalid transit quota store response');
    if (wait) pausedUntil = now + wait * 1000;
    return wait;
  }
  // Keep local development and unconnected deployments operational with a conservative per-instance cap.
  if (localDay !== day) { localDay = day; localCount = 0; }
  if (localCount >= DAILY_LIMIT) return reset;
  localCount++;
  return 0;
}

export async function pauseTransitRequests(env: Env, fetcher: typeof fetch, retryAfter?: number) {
  const seconds = retryAfter ? Math.min(86_400, retryAfter) : DEFAULT_PAUSE_SECONDS;
  pausedUntil = Date.now() + seconds * 1000;
  const store = connection(env);
  if (store) await command(store, ['SET', pauseKey, '1', 'EX', seconds], fetcher);
  return seconds;
}
