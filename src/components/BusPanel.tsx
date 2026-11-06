import { useEffect, useRef, useState } from 'react';
import { BusFront, MapPin, RefreshCw, X } from 'lucide-react';
import { hasCoordinates, type Stop } from '../domain';
import { arrivalFresh, coordinates, transportRequest, type BusResult, type BusStation, type TransportStatus } from '../transport';
import Modal from './Modal';

export default function BusPanel({ stops, initialStop, region: routeRegion, onClose }: { stops: Stop[]; initialStop?: string; region: string; onClose: () => void }) {
  const [region, setRegion] = useState<'seoul' | 'gyeonggi'>(routeRegion.includes('경기') ? 'gyeonggi' : 'seoul');
  const [stopId, setStopId] = useState(initialStop || stops.find(hasCoordinates)?.id || '');
  const [stations, setStations] = useState<BusStation[]>([]), [station, setStation] = useState<BusStation | null>(null);
  const [result, setResult] = useState<BusResult | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<TransportStatus | null>(null), [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null), locked = useRef(false);
  const stop = stops.find(s => s.id === stopId);
  useEffect(() => {
    const controller = new AbortController();
    void transportRequest<TransportStatus>({ action: 'status' }, controller.signal).then(setStatus).catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => { controller.abort(); request.current?.abort(); clearInterval(timer); };
  }, []);
  const reset = () => { request.current?.abort(); locked.current = false; setBusy(false); setStations([]); setStation(null); setResult(null); setError(''); };
  const run = async (stationChoice?: BusStation) => {
    if (locked.current || !stop || !hasCoordinates(stop)) return;
    locked.current = true;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    if (stationChoice) { setStation(stationChoice); setResult(null); }
    try {
      if (stationChoice) {
        const data = await transportRequest<BusResult>({ action: 'arrivals', region, station: stationChoice.id }, controller.signal);
        if (!controller.signal.aborted) { setResult(data); setNow(Date.now()); }
      } else {
        setStation(null); setResult(null);
        const data = await transportRequest<BusStation[]>({ action: 'stations', region, ...coordinates(stop) }, controller.signal, 300000);
        if (!controller.signal.aborted) { setStations(data); if (!data.length) setError('500m 안에 조회 가능한 정류소가 없어요. 지역과 장소 위치를 확인하세요.'); }
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '조회하지 못했어요.'); }
    finally { if (request.current === controller) { setBusy(false); locked.current = false; } }
  };
  const connected = status && status[region];
  const fresh = result ? arrivalFresh(result, now) : false;
  return <Modal title="버스 도착" onClose={onClose} wide>
    <p className="bus-context">지금 정류소에 오는 버스예요. 데이트 날짜의 예상 시간과는 달라요.</p>
    <div className="bus-controls"><label>지역<select value={region} onChange={e => { reset(); setRegion(e.target.value as typeof region); }}><option value="seoul">서울</option><option value="gyeonggi">경기</option></select></label><label>주변 장소<select value={stopId} onChange={e => { reset(); setStopId(e.target.value); }}>{stops.filter(hasCoordinates).map(s => <option key={s.id} value={s.id}>{s.name || '이름 없는 장소'}</option>)}</select></label></div>
    {status && !connected && <p className="connection-state"><span />{region === 'seoul' ? '서울' : '경기'} 버스 API 미연결</p>}
    <div className="bus-action-row"><button className="secondary" disabled={busy || !stop || !hasCoordinates(stop)} onClick={() => void run()}><MapPin size={16} /> 주변 정류소 찾기</button>{busy && <button className="icon-button" aria-label="버스 조회 취소" onClick={() => { request.current?.abort(); setBusy(false); locked.current = false; }}><X size={18} /></button>}</div>
    {!stops.some(hasCoordinates) && <p className="journey-source">장소의 지도 위치를 먼저 지정하세요.</p>}
    {error && <p className="transport-error" role="status">{error}</p>}
    {stations.length > 0 && <div className="station-list" aria-label="주변 정류소">{stations.map(s => <button key={s.id} className={station?.id === s.id ? 'selected' : ''} disabled={busy} onClick={() => void run(s)}><BusFront size={18} /><span><strong>{s.name}</strong><small>{s.number || s.id}{Number.isFinite(s.distance) ? ` · ${Math.round(s.distance!)}m` : ''}</small></span><span>도착 조회</span></button>)}</div>}
    {busy && <p className="transport-loading" role="status"><span className="spinner" /> 정보를 가져오는 중</p>}
    {result && <section className="arrival-results" aria-label="버스 도착 조회 결과"><div className="arrival-heading"><div><h3>{station?.name}</h3><p>{result.source} · {new Date(result.fetchedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })} 조회</p></div><button className="icon-button" aria-label="버스 도착 새로고침" disabled={busy || fresh} onClick={() => station && void run(station)}><RefreshCw size={17} /></button></div>
      <p className={`arrival-age ${fresh ? '' : 'stale'}`} role="status">{fresh ? '조회 시점 기준 · 1분 후 새로고침 가능' : '이전 조회 정보 · 다시 확인하세요'}</p>
      {!result.arrivals.length ? <p className="journey-source">제공된 도착 정보가 없어요. 운행 종료 또는 제공처 상황일 수 있어요.</p> : result.arrivals.map((a, i) => <article className="arrival-row" key={`${a.route}:${i}`}><div><strong>{a.route}</strong>{a.direction && <small>{a.direction} 방면</small>}</div><div><strong>{a.first}</strong><small>다음 차 {a.second}{a.stopsAway ? ` · ${a.stopsAway}정류장 전` : ''}</small></div></article>)}
    </section>}
  </Modal>;
}
