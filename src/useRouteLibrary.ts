import { useEffect, useRef, useState } from 'react';
import type { Route } from './domain';
import { loadRoutes, saveRoutes, type LibrarySnapshot, type SaveResult } from './storage';

export function useRouteLibrary() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [stored, setStored] = useState(false);
  const [issue, setIssue] = useState('');
  const [conflict, setConflict] = useState(false);
  const saved = useRef<LibrarySnapshot>({ routes: [], revision: null });
  const desired = useRef(saved.current.routes);
  const writer = useRef<Promise<boolean> | null>(null);
  const restoring = useRef(false);
  const blocked = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const dirty = desired.current !== saved.current.routes;

  useEffect(() => {
    let active = true;
    void loadRoutes().then(snapshot => {
      if (!active) return;
      saved.current = snapshot;
      desired.current = snapshot.routes;
      blocked.current = !!snapshot.error;
      setRoutes(snapshot.routes);
      setStored(snapshot.revision !== null || typeof snapshot.legacyRaw === 'string');
      setIssue(snapshot.error || '');
      setReady(true);
    });
    const broadcast = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dayroute-library') : null;
    channel.current = broadcast;
    if (broadcast) broadcast.onmessage = event => {
      // A read-only tab may continue browsing. Actual writes check the revision inside the transaction.
      if (saved.current.revision === event.data || writer.current) return;
      setIssue('다른 탭에서 보관함을 수정했어요. 최신 내용을 보려면 새로고침하세요.');
    };
    return () => {
      active = false;
      broadcast?.close();
      channel.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (desired.current === saved.current.routes) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const fail = (reason: Extract<SaveResult, { ok: false }>['reason']) => {
    if (reason === 'conflict') {
      blocked.current = true;
      setConflict(true);
      setIssue('다른 탭에서 보관함을 수정했어요. 이 탭의 변경은 백업한 뒤 최신 보관함을 불러와 주세요.');
    } else {
      setIssue(reason === 'invalid' ? '저장 용량을 초과했거나 코스 정보가 올바르지 않아요. 코스나 사진을 정리해 주세요.'
        : '변경 내용을 저장하지 못했어요. 저장 공간을 확인하고 현재 코스를 백업해 주세요.');
    }
  };

  const publish = (snapshot: LibrarySnapshot, revision: string) => {
    saved.current = snapshot;
    setStored(true);
    setIssue('');
    channel.current?.postMessage(revision);
  };

  const flush = () => {
    if (restoring.current) return Promise.resolve(false);
    if (writer.current) return writer.current;
    if (desired.current === saved.current.routes) return Promise.resolve(!blocked.current);
    if (blocked.current) return Promise.resolve(false);
    setPending(true);
    writer.current = (async () => {
      while (desired.current !== saved.current.routes) {
        const next = desired.current;
        const result = await saveRoutes(next, saved.current);
        if (!result.ok) { fail(result.reason); return false; }
        publish({ routes: next, revision: result.revision }, result.revision);
      }
      return true;
    })().finally(() => { writer.current = null; setPending(false); });
    return writer.current;
  };

  const commit = (next: Route[]) => {
    if (!ready || blocked.current || restoring.current || next.length > 500) return false;
    desired.current = next;
    setRoutes(next);
    void flush();
    return true;
  };

  const restore = async (imported: Route[]) => {
    if (restoring.current) throw new Error('다른 파일을 가져오는 중이에요.');
    restoring.current = true;
    try {
      if (writer.current) await writer.current;
      if (desired.current !== saved.current.routes) throw new Error('이 탭에 저장되지 않은 변경이 있어요. 먼저 백업한 뒤 최신 보관함에서 가져와 주세요.');
      setPending(true);
      const latest = await loadRoutes();
      // A corrupt legacy file can be backed up verbatim before recovery. Preserve an unreadable database.
      if (latest.error && typeof latest.legacyRaw !== 'string') throw new Error(latest.error);
      const next = [...imported, ...latest.routes];
      if (next.length > 500) throw new Error('보관함에는 최대 500개 코스를 저장할 수 있어요.');
      if (latest.error && typeof latest.legacyRaw === 'string') {
        const url = URL.createObjectURL(new Blob([latest.legacyRaw], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dayroute-recovery-original.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const result = await saveRoutes(next, latest);
      if (!result.ok) throw new Error('보관함이 바뀌었거나 저장 공간이 부족해 가져오지 못했어요.');
      const sourceChanged = latest.revision !== saved.current.revision || latest.legacyRaw !== saved.current.legacyRaw;
      desired.current = next;
      publish({ routes: next, revision: result.revision }, result.revision);
      blocked.current = false;
      setConflict(false);
      setRoutes(next);
      return { sourceChanged, previous: latest.routes };
    } finally { restoring.current = false; setPending(false); }
  };

  return { routes, ready, pending, stored, issue, conflict, commit, flush, restore, dirty,
    current: () => desired.current,
    discardDraft: () => { desired.current = saved.current.routes; },
  };
}
