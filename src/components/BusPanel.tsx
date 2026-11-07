import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BusFront, Check, ExternalLink, LocateFixed, MapPin, RefreshCw, TrainFront, X } from 'lucide-react';
import { hasCoordinates, makeStop, transitFor, walkingFor, type Stop, type TransitLeg } from '../domain';
import {
  arrivalFresh, coordinates, kakaoDirections, naverDirections,
  transitParams, transportRequest,
  type BusResult, type BusStation, type TransitOption, type TransitRouteResult, type TransportStatus,
} from '../transport';
import type { UserLocation } from './MapView';
import Modal from './Modal';

const stepIcons = { walk: '🚶', bus: '🚌', subway: '🚇', train: '🚆' };
const stepNames = { walk: '도보', bus: '버스', subway: '지하철', train: '열차' };

function stripOption(opt: TransitOption): TransitLeg {
  const { key, summary, minutes, transfers, walkMinutes, fare, fetchedAt, steps, coordinates: coords } = opt;
  return { key, summary, minutes, transfers, walkMinutes, ...(fare !== undefined ? { fare } : {}), fetchedAt, steps, coordinates: coords };
}

interface LegDescriptor {
  id: string;
  label: string;
  from: Stop;
  to: Stop;
  isUserOrigin?: boolean;
}

export default function BusPanel({
  stops, initialStop, region: routeRegion, userLocation, locating, onLocate, onApplyTransit, readonly = false, onClose,
}: {
  stops: Stop[]; initialStop?: string; region: string;
  userLocation?: UserLocation | null; locating?: boolean; onLocate?: () => void;
  onApplyTransit?: (stopId: string, leg: TransitLeg) => void;
  readonly?: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<'routes' | 'station'>('routes');
  const [legOptions, setLegOptions] = useState<Record<string, TransitOption[]>>({});
  const [legBusy, setLegBusy] = useState<Record<string, boolean>>({});
  const [legError, setLegError] = useState<Record<string, string>>({});
  const [selectedUserOpt, setSelectedUserOpt] = useState<string>('');

  const [region, setRegion] = useState<'seoul' | 'gyeonggi'>(routeRegion.includes('경기') ? 'gyeonggi' : 'seoul');
  const [stopId, setStopId] = useState(initialStop || stops.find(hasCoordinates)?.id || '');
  const [stations, setStations] = useState<BusStation[]>([]), [station, setStation] = useState<BusStation | null>(null);
  const [result, setResult] = useState<BusResult | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState<TransportStatus | null>(null), [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null), locked = useRef(false);
  const stop = stops.find(s => s.id === stopId);

  const locatedStops = stops.filter(hasCoordinates);
  const legs: LegDescriptor[] = [];
  if (userLocation && locatedStops[0]) {
    legs.push({
      id: 'user-origin',
      label: `📍 지금 내 위치 → 1. ${locatedStops[0].name || '첫 장소'}`,
      from: makeStop({ id: 'user-origin', name: userLocation.address || '지금 내 위치', lng: userLocation.lng, lat: userLocation.lat, mode: 'transit' }),
      to: locatedStops[0],
      isUserOrigin: true,
    });
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (hasCoordinates(a) && hasCoordinates(b)) {
      legs.push({
        id: a.id,
        label: `${i + 1}. ${a.name || '장소'} → ${i + 2}. ${b.name || '장소'}`,
        from: a,
        to: b,
      });
    }
  }

  const loadLeg = async (leg: LegDescriptor, signal?: AbortSignal) => {
    setLegBusy(prev => ({ ...prev, [leg.id]: true }));
    setLegError(prev => ({ ...prev, [leg.id]: '' }));
    try {
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const data = await transportRequest<TransitRouteResult>(transitParams(leg.from, leg.to), combined, 60000);
      if (combined.aborted) return;
      setLegOptions(prev => ({ ...prev, [leg.id]: data.options }));
      if (leg.isUserOrigin && data.options[0]) setSelectedUserOpt(data.options[0].id);
    } catch (e) {
      if (!signal?.aborted) setLegError(prev => ({ ...prev, [leg.id]: e instanceof Error ? e.message : '경로를 조회하지 못했어요.' }));
    } finally {
      if (!signal?.aborted) setLegBusy(prev => ({ ...prev, [leg.id]: false }));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void transportRequest<TransportStatus>({ action: 'status' }, controller.signal).then(setStatus).catch(() => {});
    for (const leg of legs) {
      void loadLeg(leg, controller.signal);
    }
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => { controller.abort(); request.current?.abort(); clearInterval(timer); };
  }, [userLocation?.lng, userLocation?.lat, stops.map(s => `${s.id}:${s.lng}:${s.lat}`).join('|')]);

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
    <div className="bus-panel-tabs" role="tablist" aria-label="대중교통 안내 보기 방식">
      <button type="button" role="tab" aria-selected={tab === 'routes'} className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>
        <TrainFront size={15} /> 코스 순서별 경로 · 후보 선택
      </button>
      <button type="button" role="tab" aria-selected={tab === 'station'} className={tab === 'station' ? 'active' : ''} onClick={() => setTab('station')}>
        <BusFront size={15} /> 장소 주변 정류소 전체 버스
      </button>
    </div>

    {tab === 'routes' ? <div className="route-legs-panel">
      <div className="user-location-bar">
        <div>
          <strong>1. 지금 내 위치 기준 출발</strong>
          <p>{userLocation ? (userLocation.address ? `현재 위치: ${userLocation.address}` : `현재 좌표: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`) : '내 위치를 켜면 [지금 내 위치 → 첫 장소] 도보+버스/지하철 후보도 함께 보여드려요.'}</p>
        </div>
        {onLocate && <button type="button" className="secondary small" disabled={locating} onClick={onLocate}>
          <LocateFixed size={15} /> {locating ? '위치 확인 중…' : userLocation ? '내 위치 갱신' : '지금 내 위치 켜기'}
        </button>}
      </div>

      {!legs.length && <p className="journey-source">장소 2곳 이상의 지도 위치를 지정하거나 ‘지금 내 위치 켜기’를 눌러주세요.</p>}

      <div className="sequential-legs-list">
        {legs.map(leg => {
          const opts = legOptions[leg.id] || [];
          const loading = legBusy[leg.id];
          const err = legError[leg.id];
          const savedTransit = !leg.isUserOrigin ? transitFor(leg.from, leg.to) : undefined;
          const savedWalk = !leg.isUserOrigin ? walkingFor(leg.from, leg.to) : undefined;

          return <section key={leg.id} className={`leg-route-section ${leg.isUserOrigin ? 'origin-leg' : ''}`} aria-label={leg.label}>
            <div className="leg-route-header">
              <div>
                <h3>{leg.label}</h3>
                {savedTransit && <small className="leg-saved-badge">일정 적용됨: {savedTransit.summary} ({savedTransit.minutes}분)</small>}
                {!savedTransit && savedWalk && <small className="leg-saved-badge">일정 적용됨: 도보 {savedWalk.minutes}분</small>}
              </div>
              <button type="button" className="icon-button" aria-label={`${leg.label} 경로 새로고침`} disabled={loading} onClick={() => void loadLeg(leg)}>
                <RefreshCw size={15} />
              </button>
            </div>

            {loading && <p className="transport-loading" role="status"><span className="spinner" /> 실시간 버스·지하철·도보 후보 조합을 계산하고 있어요…</p>}
            {err && <p className="transport-error" role="status">{err}</p>}

            {opts.length > 0 && <div className="candidate-list" role="group" aria-label={`${leg.label} 후보 경로`}>
              {opts.map((opt, idx) => {
                const isSelected = leg.isUserOrigin
                  ? (selectedUserOpt ? selectedUserOpt === opt.id : idx === 0)
                  : (savedTransit ? savedTransit.summary === opt.summary && savedTransit.minutes === opt.minutes : idx === 0);

                return <article key={opt.id} className={`candidate-card ${isSelected ? 'selected' : ''}`}>
                  <div className="candidate-top">
                    <div>
                      <span className="candidate-rank">후보 {idx + 1}</span>
                      <strong className="candidate-time">{opt.minutes}분</strong>
                      <span className="candidate-summary">{opt.summary}</span>
                    </div>
                    {!leg.isUserOrigin && !readonly && onApplyTransit ? (
                      <button
                        type="button"
                        className={isSelected && savedTransit ? 'secondary small' : 'primary small'}
                        onClick={() => onApplyTransit(leg.from.id, stripOption(opt))}
                      >
                        {isSelected && savedTransit ? <><Check size={14} /> 적용됨</> : '이 경로 선택'}
                      </button>
                    ) : leg.isUserOrigin ? (
                      <button type="button" className="secondary small" onClick={() => setSelectedUserOpt(opt.id)}>
                        {isSelected ? <><Check size={14} /> 선택됨</> : '후보 보기'}
                      </button>
                    ) : null}
                  </div>

                  <p className="candidate-submeta">
                    환승 {opt.transfers}회 · 총 도보 {opt.walkMinutes}분{opt.fare ? ` · 카드 ${opt.fare.toLocaleString('ko-KR')}원` : ''}
                  </p>

                  {/* Visual Step Sequence: 도보 -> 버스/지하철 -> 도보 */}
                  <div className="candidate-step-flow" aria-label="이동 순서">
                    {opt.steps.map((s, sIdx) => <span key={`${opt.id}:chip:${sIdx}`} className="flow-item">
                      {sIdx > 0 && <ArrowRight size={12} className="flow-arrow" />}
                      <span className={`flow-chip mode-${s.mode}`}>
                        {stepIcons[s.mode]} {s.route ? `${stepNames[s.mode]} ${s.route}` : stepNames[s.mode]} · {s.minutes}분
                        {s.live && <em className="flow-live">{s.live}</em>}
                      </span>
                    </span>)}
                  </div>

                  {/* Step-by-step boarding/alighting details */}
                  <ol className="candidate-step-details">
                    {opt.steps.map((s, sIdx) => <li key={`${opt.id}:detail:${sIdx}`} className={`detail-row mode-${s.mode}`}>
                      <span className="detail-tag">{s.route ? `${stepNames[s.mode]} ${s.route}` : stepNames[s.mode]}</span>
                      <span className="detail-text">
                        {s.from || s.to ? `${s.from || '출발'} → ${s.to || '도착'}` : '도보 이동'}
                        <small>
                          {s.minutes}분{s.stops ? ` (${s.stops}정류장)` : s.meters ? ` (${s.meters}m)` : ''}
                          {s.live ? ` · 실시간: ${s.live}` : ''}
                        </small>
                      </span>
                    </li>)}
                  </ol>
                </article>;
              })}
            </div>}

            <div className="leg-external-row">
              <a href={naverDirections(leg.from, leg.to)} target="_blank" rel="noreferrer">네이버 지도에서 더 많은 후보 보기 <ExternalLink size={12} /></a>
              <a href={kakaoDirections(leg.from, leg.to)} target="_blank" rel="noreferrer">카카오맵 길찾기 <ExternalLink size={12} /></a>
            </div>
          </section>;
        })}
      </div>
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
