import { useEffect, useRef, useState } from 'react';
import { BusFront, ExternalLink, LocateFixed, MapPin, RefreshCw, TrainFront, X } from 'lucide-react';
import { hasCoordinates, walkingKey, type Stop, type TransitLeg } from '../domain';
import {
  arrivalFresh, coordinates, kakaoDirections, naverDirections,
  transportRequest,
  type BusResult, type BusStation, type TransportStatus,
} from '../transport';
import type { UserLocation } from './MapView';
import Modal from './Modal';
import TransitOptions from './TransitOptions';
import { appliedTransitFor, originLegId, savedTransitOption, transitLegs } from '../transitCandidates';
import { useTransitOptions } from '../useTransitOptions';

export default function BusPanel({
  stops, initialStop, departures, region: routeRegion, userLocation, locating, locationError, onLocate, onApplyTransit, readonly = false, initialTab = 'routes', onClose,
}: {
  stops: Stop[]; initialStop?: string; departures: string[]; region: string;
  userLocation?: UserLocation | null; locating?: boolean; locationError?: string; onLocate?: () => void;
  onApplyTransit?: (stopId: string, leg: TransitLeg) => boolean;
  readonly?: boolean; initialTab?: 'routes' | 'station'; onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [activeLegId, setActiveLegId] = useState(initialStop || '');
  const [applyError, setApplyError] = useState('');

  const [region, setRegion] = useState<'seoul' | 'gyeonggi'>(routeRegion.includes('경기') ? 'gyeonggi' : 'seoul');
  const [stopId, setStopId] = useState(stops.find(s => s.id === initialStop && hasCoordinates(s))?.id || stops.find(hasCoordinates)?.id || '');
  const [stations, setStations] = useState<BusStation[]>([]), [station, setStation] = useState<BusStation | null>(null);
  const [result, setResult] = useState<BusResult | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<TransportStatus | null>(null), [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null), locked = useRef(false);
  const stop = stops.find(s => s.id === stopId);

  const legs = transitLegs(stops, userLocation, departures);
  const activeLeg = legs.find(leg => leg.id === activeLegId) ?? legs[0] ?? null;
  const candidates = useTransitOptions(activeLeg, tab === 'routes');
  const saved = activeLeg && activeLeg.id !== originLegId ? appliedTransitFor(activeLeg.from, activeLeg.to) : undefined;

  useEffect(() => {
    if (tab !== 'station') return;
    const controller = new AbortController();
    void transportRequest<TransportStatus>({ action: 'status' }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setStatus(data); }).catch(() => {});
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [tab]);
  useEffect(() => () => request.current?.abort(), []);

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

  return <Modal title="실시간 경로 · 대중교통 안내" onClose={onClose} wide>
    <div className="bus-panel-tabs" role="group" aria-label="대중교통 안내 보기 방식">
      <button type="button" aria-pressed={tab === 'routes'} className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>
        <TrainFront size={15} aria-hidden="true" /> 구간별 경로 후보
      </button>
      <button type="button" aria-pressed={tab === 'station'} className={tab === 'station' ? 'active' : ''} onClick={() => setTab('station')}>
        <BusFront size={15} aria-hidden="true" /> 주변 정류소
      </button>
    </div>

    {tab === 'routes' ? <div className="route-legs-panel">
      <div className="user-location-bar">
        <div>
          <strong>내 위치에서 출발</strong>
          <p>{userLocation ? userLocation.address || '현재 위치를 확인했어요.' : '내 위치에서 첫 장소까지 경로를 찾을 수 있어요.'}</p>
        </div>
        {onLocate && <button type="button" className="secondary small" disabled={locating || !stops[0] || !hasCoordinates(stops[0])}
          onClick={() => { setActiveLegId(originLegId); onLocate(); }}>
          <LocateFixed size={15} aria-hidden="true" /> {locating ? '위치 확인 중…' : userLocation ? '내 위치 갱신' : '내 위치 확인'}
        </button>}
      </div>
      {locationError && <p className="transport-error" role="status">{locationError}</p>}
      {!activeLeg ? <p className="journey-source">출발지와 도착지의 지도 위치를 지정해 주세요.</p> : <section className="leg-route-section">
        <div className="leg-route-header">
          <label className="candidate-leg-select"><span>이동 구간</span>
            <select value={activeLeg.id} onChange={event => { setActiveLegId(event.target.value); setApplyError(''); }}>
              {legs.map(leg => <option key={leg.id} value={leg.id}>{leg.label}</option>)}
            </select>
          </label>
          <button type="button" className="icon-button" aria-label="경로 후보 다시 조회" disabled={candidates.loading}
            onClick={candidates.refresh}><RefreshCw size={15} aria-hidden="true" /></button>
        </div>
        {candidates.loading && <p className="transport-loading" role="status"><span className="spinner" /> 대중교통 후보를 찾고 있어요…</p>}
        {candidates.error && <p className="transport-error" role="status">{candidates.error}</p>}
        {applyError && <p className="transport-error" role="status">{applyError}</p>}
        {candidates.result && <TransitOptions key={`${activeLeg.id}:${walkingKey(activeLeg.from, activeLeg.to)}`} result={candidates.result}
          leg={activeLeg} routeRegion={routeRegion} saved={saved}
          onApply={!readonly && onApplyTransit && activeLeg.id !== originLegId ? option => {
            setApplyError(onApplyTransit(activeLeg.id, savedTransitOption(option)) ? '' : '경로를 적용하지 못했어요. 구간을 확인해 주세요.');
          } : undefined} />}
        <div className="leg-external-row">
          <a href={naverDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">네이버 길찾기 <ExternalLink size={12} /></a>
          <a href={kakaoDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">카카오 길찾기 <ExternalLink size={12} /></a>
        </div>
      </section>}
    </div> : <>
      <p className="bus-context">선택한 장소 반경 500m 정류소에 지금 오는 모든 버스예요.</p>
      <div className="bus-controls"><label>지역<select value={region} onChange={e => { reset(); setRegion(e.target.value as typeof region); }}><option value="seoul">서울</option><option value="gyeonggi">경기</option></select></label><label>주변 장소<select value={stopId} onChange={e => { reset(); setStopId(e.target.value); }}>{stops.filter(hasCoordinates).map(s => <option key={s.id} value={s.id}>{s.name || '이름 없는 장소'}</option>)}</select></label></div>
      {status && !connected && <p className="connection-state"><span />{region === 'seoul' ? '서울' : '경기'} 버스 API 미연결</p>}
      <div className="bus-action-row"><button className="secondary" disabled={busy || !stop || !hasCoordinates(stop)} onClick={() => void run()}><MapPin size={16} /> 주변 정류소 찾기</button>{busy && <button className="icon-button" aria-label="버스 조회 취소" onClick={() => { request.current?.abort(); setBusy(false); locked.current = false; }}><X size={18} /></button>}</div>
      {!stops.some(hasCoordinates) && <p className="journey-source">장소의 지도 위치를 먼저 지정하세요.</p>}
      {error && <p className="transport-error" role="status">{error}</p>}
      {stations.length > 0 && <div className="station-list" aria-label="주변 정류소">{stations.map(s => <button key={s.id} className={station?.id === s.id ? 'selected' : ''} disabled={busy} onClick={() => void run(s)}><BusFront size={18} /><span><strong>{s.name}</strong><small>{s.number || s.id}{Number.isFinite(s.distance) ? ` · ${Math.round(s.distance!)}m` : ''}</small></span><span>도착 조회</span></button>)}</div>}
      {busy && <p className="transport-loading" role="status"><span className="spinner" /> 정보를 가져오는 중</p>}
      {result && <section className="arrival-results" aria-label="버스 도착 조회 결과"><div className="arrival-heading"><div><h3>{station?.name}</h3><p>{result.source} · {new Date(result.fetchedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })} 조회</p></div><button className="icon-button" aria-label="버스 도착 새로고침" disabled={busy || fresh} onClick={() => station && void run(station)}><RefreshCw size={17} /></button></div>
        <p className={`arrival-age ${fresh ? '' : 'stale'}`} role="status">{fresh ? '조회 시점 기준 · 1분 후 새로고침 가능' : '이전 조회 정보 · 다시 확인하세요'}</p>
        {!result.arrivals.length ? <p className="journey-source">제공된 도착 정보가 없어요. 운행 종료 또는 제공처 상황일 수 있어요.</p> : result.arrivals.map((a, i) => <article className="arrival-row" key={`${a.route}:${i}`}><div className="arrival-route"><strong>{a.route}</strong>{a.direction && <small>{a.direction} 방면</small>}</div><div><strong>{a.first}</strong><small>다음 차 {a.second}{a.stopsAway ? ` · ${a.stopsAway}정류장 전` : ''}</small></div></article>)}
      </section>}
    </>}
  </Modal>;
}
