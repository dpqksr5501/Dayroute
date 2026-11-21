import { useEffect, useRef, useState } from 'react';
import type { Stop, TransitStep } from '../domain';
import { transitDepartureTime } from '../transitCandidates';
import { transitLiveParams, transitLiveRegion, transportRequest, type TransitLiveResult } from '../transport';

export default function TransitArrivals({ step, from, routeRegion }: { step: TransitStep; from: Stop; routeRegion?: string }) {
  const request = useRef<AbortController | null>(null);
  const [result, setResult] = useState<TransitLiveResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!result) return;
    const delay = Math.max(0, Date.parse(result.fetchedAt) + 60000 - Date.now());
    const timer = window.setTimeout(() => setStale(true), delay);
    return () => window.clearTimeout(timer);
  }, [result]);

  if (step.mode !== 'bus' && step.mode !== 'subway') return null;
  if (!step.route || (step.mode === 'bus' ? !step.stationId && !step.from : !step.from)) return null;

  const load = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const data = await transportRequest<TransitLiveResult>(
        transitLiveParams(step, from, transitLiveRegion(step, from, routeRegion)), controller.signal,
      );
      if (!controller.signal.aborted) {
        setStale(Date.now() - Date.parse(data.fetchedAt) >= 60000);
        setResult(data);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '도착정보를 조회하지 못했어요.');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  };

  return <div className="candidate-arrivals">
    <button type="button" className="nv-arrival-btn" disabled={loading} onClick={() => void load()}>
      {loading ? '조회 중…' : result ? '도착정보 새로고침' : '도착정보'}
    </button>
    {loading && <span className="candidate-arrival-note" role="status">도착정보를 불러오는 중이에요.</span>}
    {error && <p className="transport-error" role="status">{error}</p>}
    {result && <div className="transit-live-result" role="status">
      <small className="transit-live-source">
        {result.stationName}{result.stationNumber ? ` (${result.stationNumber})` : ''} · {result.source} · {transitDepartureTime(result.fetchedAt)} 조회
      </small>
      {stale ? <p className="candidate-arrival-note">이전 조회 결과예요. 도착정보를 새로고침해 주세요.</p>
        : result.matched.length ? <ul className="candidate-arrival-times">
          {result.matched.map((arrival, index) => <li key={`${arrival.route}:${arrival.direction}:${index}`}>
            <span>{arrival.route}{arrival.direction ? ` · ${arrival.direction}` : ''}</span>
            <strong>{arrival.first}</strong>
            {arrival.second && arrival.second !== '정보 없음' && <small>{step.mode === 'bus' ? '다음 ' : ''}{arrival.second}</small>}
          </li>)}
        </ul> : <p className="candidate-arrival-note">{result.route} 도착 예정 정보가 없어요.</p>}
    </div>}
  </div>;
}
