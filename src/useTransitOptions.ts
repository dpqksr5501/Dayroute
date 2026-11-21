import { useEffect, useState } from 'react';
import { transitParams, transportRequest, type TransitRouteResult } from './transport';
import type { TransitLegDescriptor } from './transitCandidates';

interface TransitQuery {
  key: string;
  result?: TransitRouteResult;
  error?: string;
  loading: boolean;
}

export function useTransitOptions(leg: TransitLegDescriptor | null, enabled: boolean) {
  const key = leg ? new URLSearchParams(transitParams(leg.from, leg.to)).toString() : '';
  const [query, setQuery] = useState<TransitQuery>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!key || !enabled) return;
    const controller = new AbortController();
    setQuery(previous => ({ key, loading: true, result: previous?.key === key ? previous.result : undefined }));
    const params = Object.fromEntries(new URLSearchParams(key));
    void transportRequest<TransitRouteResult>(params, controller.signal, 1800000)
      .then(result => {
        if (!controller.signal.aborted) setQuery({ key, result, loading: false });
      })
      .catch(error => {
        if (!controller.signal.aborted) setQuery(previous => ({
          key, result: previous?.key === key ? previous.result : undefined, loading: false,
          error: error instanceof Error ? error.message : '경로를 조회하지 못했어요.',
        }));
      });
    return () => controller.abort();
  }, [key, enabled, revision]);

  const current = query?.key === key ? query : undefined;
  return {
    result: current?.result,
    error: current?.error,
    loading: enabled && !!key && (current?.loading ?? true),
    refresh: () => setRevision(value => value + 1),
  };
}
