import { useCallback, useEffect, useRef, useState } from 'react';
export function useRelease() {
  const [available, setAvailable] = useState(false);
  const [lastCheck, setLastCheck] = useState('');
  const [offlineReady, setOfflineReady] = useState(false);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const checking = useRef(false);
  const check = useCallback(async () => {
    if (checking.current || document.visibilityState !== 'visible') return;
    if (!navigator.onLine) { setLastCheck('오프라인이에요. 연결되면 다시 확인해요.'); return; }
    checking.current = true;
    setLastCheck('새 버전을 확인하고 있어요…');
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('No release metadata');
      const next = await response.json();
      if (typeof next.build !== 'string') throw new Error('Invalid release metadata');
      const changed = next.build !== __APP_RELEASE__.build;
      if (changed) setAvailable(true);
      await registration.current?.update();
      if (registration.current?.waiting) setAvailable(true);
      setLastCheck(changed || registration.current?.waiting ? '새 버전이 준비됐어요.' : '최신 버전을 사용하고 있어요.');
    } catch { setLastCheck('업데이트를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { checking.current = false; }
  }, []);
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(r => {
      registration.current = r;
      setOfflineReady(r.active?.state === 'activated');
      if (r.waiting) setAvailable(true);
      r.addEventListener('updatefound', () => {
        const worker = r.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setAvailable(true);
          if (worker.state === 'activated') setOfflineReady(true);
        });
      });
    }).catch(() => { /* Installation is optional. */ });
    void check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); };
  }, [check]);
  const apply = async () => {
    const r = registration.current;
    if (r) {
      try { await r.update(); } catch { return false; }
      if (r.waiting) {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        r.waiting.postMessage('SKIP_WAITING'); return true;
      }
    }
    location.reload(); return true;
  };
  return { available, check, apply, lastCheck, offlineReady };
}
