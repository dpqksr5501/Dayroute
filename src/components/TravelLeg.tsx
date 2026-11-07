import { useEffect, useRef, useState } from 'react';
import { BusFront, Car, ChevronDown, ExternalLink, Footprints, RefreshCw, TrainFront, X } from 'lucide-react';
import { carFor, hasCoordinates, transitFor, walkingFor, type Stop, type TransitLeg, type TravelMode, type WalkingLeg } from '../domain';
import {
  arrivalFresh, carParams, firstTransitStep, kakaoDirections, naverDirections,
  transitLiveParams, transitParams, transportRequest, walkingParams,
  type TransitLiveResult, type TransitOption, type TransitRouteResult, type WalkingResult,
} from '../transport';

const icons = { walk: Footprints, transit: TrainFront, car: Car };
const names = { walk: '도보', transit: '대중교통', car: '자동차' };
const stepLabels = { walk: '도보', bus: '버스', subway: '지하철', train: '열차' };

function stripOption(opt: TransitOption): TransitLeg {
  const { key, summary, minutes, transfers, walkMinutes, fare, fetchedAt, steps, coordinates } = opt;
  return { key, summary, minutes, transfers, walkMinutes, ...(fare !== undefined ? { fare } : {}), fetchedAt, steps, coordinates };
}
function inferRegion(stop: Stop, routeRegion?: string, stepLng?: number, stepLat?: number): 'seoul' | 'gyeonggi' {
  if (routeRegion?.includes('경기')) return 'gyeonggi';
  const lng = stepLng ?? stop.lng, lat = stepLat ?? stop.lat;
  if (lng !== null && lat !== null && (lng < 126.76 || lng > 127.19 || lat < 37.42 || lat > 37.70)) return 'gyeonggi';
  return 'seoul';
}

export default function TravelLeg({ from, to, departure, region, readonly, onPatch, onBus }: {
  from: Stop; to: Stop; departure: string; region?: string; readonly: boolean;
  onPatch: (patch: Partial<Stop>) => boolean; onBus: () => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [viewWalk, setViewWalk] = useState<WalkingLeg | null>(null);
  const [viewCar, setViewCar] = useState<WalkingLeg | null>(null);
  const [viewTransit, setViewTransit] = useState<TransitLeg | null>(null);
  const [options, setOptions] = useState<TransitOption[]>([]);
  const [live, setLive] = useState<TransitLiveResult | null>(null), [liveBusy, setLiveBusy] = useState(false), [liveError, setLiveError] = useState('');
  const request = useRef<AbortController | null>(null), liveRequest = useRef<AbortController | null>(null);
  const signature = `${from.lng},${from.lat}>${to.lng},${to.lat}:${from.mode}`;

  useEffect(() => {
    setError(''); setLiveError(''); setViewWalk(null); setViewCar(null); setViewTransit(null); setOptions([]); setLive(null); setBusy(false); setLiveBusy(false);
    return () => { request.current?.abort(); liveRequest.current?.abort(); };
  }, [signature]);

  const walk = walkingFor(from, to) || viewWalk;
  const car = carFor(from, to) || viewCar;
  const transit = transitFor(from, to) || viewTransit;
  const firstStep = firstTransitStep(transit ?? undefined);
  const Icon = icons[from.mode];
  const minutes = walk?.minutes ?? car?.minutes ?? transit?.minutes ?? from.travelMinutes;
  const badge = walk ? 'TMAP 도보' : car ? 'TMAP 자동차' : transit ? transit.summary : '직접 설정';

  const applyOption = (opt: TransitOption) => {
    const leg = stripOption(opt);
    setLive(null); setLiveError('');
    if (readonly) setViewTransit(leg);
    else if (!onPatch({ transit: leg, travelMinutes: leg.minutes })) setError('조회 결과를 저장하지 못했어요.');
  };
  const queryRoad = async (mode: 'walk' | 'car') => {
    if (request.current && !request.current.signal.aborted && busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const params = mode === 'walk' ? walkingParams(from, to) : carParams(from, to);
      const data = await transportRequest<WalkingResult>(params, controller.signal, 3600000);
      if (controller.signal.aborted) return;
      const leg: WalkingLeg = { key: data.key, minutes: data.minutes, meters: data.meters, coordinates: data.coordinates, fetchedAt: data.fetchedAt };
      if (readonly) { if (mode === 'walk') setViewWalk(leg); else setViewCar(leg); }
      else if (!onPatch(mode === 'walk' ? { walking: leg } : { car: leg, travelMinutes: leg.minutes })) setError('조회 결과를 저장하지 못했어요.');
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '조회하지 못했어요.'); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const queryTransit = async () => {
    if (request.current && !request.current.signal.aborted && busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setLive(null); setLiveError('');
    try {
      const data = await transportRequest<TransitRouteResult>(transitParams(from, to), controller.signal, 1800000);
      if (controller.signal.aborted) return;
      setOptions(data.options);
      if (data.options[0]) applyOption(data.options[0]);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '대중교통 경로를 조회하지 못했어요.'); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const queryLive = async () => {
    if (!firstStep || (liveRequest.current && !liveRequest.current.signal.aborted && liveBusy)) return;
    const controller = new AbortController(); liveRequest.current = controller; setLiveBusy(true); setLiveError('');
    try {
      const reg = inferRegion(from, region, firstStep.fromLng, firstStep.fromLat);
      const data = await transportRequest<TransitLiveResult>(transitLiveParams(firstStep, from, reg), controller.signal, 30000);
      if (!controller.signal.aborted) setLive(data);
    } catch (e) { if (!controller.signal.aborted) setLiveError(e instanceof Error ? e.message : '실시간 도착 정보를 가져오지 못했어요.'); }
    finally { if (liveRequest.current === controller) setLiveBusy(false); }
  };
  const cancel = () => { request.current?.abort(); liveRequest.current?.abort(); setBusy(false); setLiveBusy(false); };

  return <div className="journey-leg">
    <button className="journey-summary" aria-expanded={open} onClick={() => { setOpen(!open); if (open) cancel(); }}>
      <Icon size={17} /><span>{names[from.mode]} <strong>{minutes}분</strong><small>{badge}</small></span><ChevronDown size={16} className={open ? 'rotate' : ''} />
    </button>
    {open && <div className="journey-details">
      <p className="journey-destination">{departure} 출발 · {to.name || '다음 장소'}까지</p>
      {!readonly && <div className="journey-inputs"><label>이동 수단<select aria-label={`${from.name}에서 이동수단`} value={from.mode} onChange={e => onPatch({ mode: e.target.value as TravelMode })}><option value="walk">도보</option><option value="transit">대중교통</option><option value="car">자동차</option></select></label>
        <label>직접 설정 (분)<input aria-label={`${from.name}에서 이동 시간`} type="number" min={0} max={1440} value={from.travelMinutes} onChange={e => onPatch({ travelMinutes: Math.max(0, Math.min(1440, Number(e.target.value))), walking: undefined, car: undefined, transit: undefined })} /></label></div>}
      {from.mode === 'walk' && <>
        {walk && <p className="journey-source">{(walk.meters / 1000).toFixed(1)}km · {new Date(walk.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회<br />도보 예상 시간이에요. {walk.coordinates.length ? '실선은 조회한 도로 경로예요.' : '지도 경로 표시는 제공 조건 확인 후 연결돼요.'}</p>}
        <div className="journey-buttons"><button className="secondary" disabled={busy || !hasCoordinates(from) || !hasCoordinates(to)} onClick={() => void queryRoad('walk')}>{busy ? <span className="spinner" /> : <Footprints size={16} />}{busy ? '조회 중' : walk ? '도보 다시 조회' : '도보 경로 조회'}</button>{busy && <button className="icon-button" aria-label="도보 조회 취소" onClick={cancel}><X size={17} /></button>}</div>
        {(!hasCoordinates(from) || !hasCoordinates(to)) && <p className="journey-source">두 장소의 지도 위치를 먼저 지정하세요.</p>}
      </>}
      {from.mode === 'transit' && <>
        <div className="journey-buttons">
          <button className="secondary" disabled={busy || !hasCoordinates(from) || !hasCoordinates(to)} onClick={() => void queryTransit()}>
            {busy ? <span className="spinner" /> : <TrainFront size={16} />}{busy ? '경로 찾는 중' : transit ? '대중교통 다시 조회' : '대중교통 경로 조회'}
          </button>
          {busy && <button className="icon-button" aria-label="대중교통 조회 취소" onClick={cancel}><X size={17} /></button>}
        </div>
        {(!hasCoordinates(from) || !hasCoordinates(to)) && <p className="journey-source">두 장소의 지도 위치를 먼저 지정하세요.</p>}
        {options.length > 0 && <div className="transit-options" role="group" aria-label="추천 대중교통 후보 경로">
          {options.map((opt, idx) => {
            const active = transit?.summary === opt.summary && transit?.minutes === opt.minutes;
            return <button key={opt.id} type="button" className={`transit-option ${active ? 'selected' : ''}`} onClick={() => applyOption(opt)}>
              <div className="transit-option-head">
                <strong>후보 {idx + 1} · {opt.minutes}분 ({opt.summary})</strong>
                <small>{active ? '선택됨' : '선택'}</small>
              </div>
              <small>환승 {opt.transfers}회 · 도보 {opt.walkMinutes}분{opt.fare ? ` · ${opt.fare.toLocaleString('ko-KR')}원` : ''}</small>
              <div className="candidate-step-flow">
                {opt.steps.map((s, sIdx) => <span key={`${opt.id}:${sIdx}`} className="flow-item">
                  {sIdx > 0 && <span className="flow-arrow">→</span>}
                  <span className={`flow-chip mode-${s.mode}`}>
                    {stepLabels[s.mode]}{s.route ? ` ${s.route}` : ''} {s.minutes}분{s.live ? ` (${s.live})` : ''}
                  </span>
                </span>)}
              </div>
            </button>;
          })}
        </div>}
        {transit && <div className="transit-route-card" aria-label="선택된 대중교통 경로">
          <p className="transit-meta">
            <strong>{transit.summary}</strong> · 환승 {transit.transfers}회 · 도보 {transit.walkMinutes}분
            {transit.fare ? ` · ${transit.fare.toLocaleString('ko-KR')}원` : ''}
          </p>
          <ol className="transit-steps">
            {transit.steps.map((s, idx) => <li key={`${s.mode}:${idx}`} className={`transit-step mode-${s.mode}`}>
              <span className="step-badge">{s.route ? `${stepLabels[s.mode]} ${s.route}` : stepLabels[s.mode]}</span>
              <span className="step-body">
                {s.from || s.to ? `${s.from || '출발'} → ${s.to || '도착'}` : '구간 이동'}
                <small>{s.minutes}분{s.stops ? ` · ${s.stops}정류장` : s.meters ? ` · ${s.meters}m` : ''}{s.live ? ` · 실시간 ${s.live}` : ''}</small>
              </span>
            </li>)}
          </ol>
          {firstStep && <div className="transit-live-box">
            <div className="transit-live-head">
              <span>지금 출발 시 첫 탑승 · <strong>{firstStep.from || '승차 정류장'}</strong> ({firstStep.route || stepLabels[firstStep.mode]})</span>
              <button type="button" className="text-button" disabled={liveBusy || (!!live && arrivalFresh(live))} onClick={() => void queryLive()}>
                {liveBusy ? <span className="spinner" /> : <RefreshCw size={14} />}
                {live ? '새로고침' : '실시간 도착 확인'}
              </button>
            </div>
            {liveError && <p className="transport-error" role="status">{liveError}</p>}
            {live && <div className="transit-live-result" role="status">
              <small className="transit-live-source">{live.stationName}{live.stationNumber ? ` (${live.stationNumber})` : ''} · {live.source} 기준</small>
              {live.matched.length > 0 ? live.matched.map((a, i) => <div className="transit-live-row matched" key={`${a.route}:${i}`}>
                <strong>{a.route}</strong><span><strong>{a.first}</strong> · 다음 {a.second}{a.stopsAway ? ` (${a.stopsAway}정류장 전)` : ''}</span>
              </div>) : <p className="journey-source">현재 이 정류소에서 {live.route || '해당 노선'} 도착 예정 정보가 없어요.{live.others.length > 0 ? ` (주변 정류소 다른 노선: ${live.others.slice(0, 2).map(o => `${o.route} ${o.first}`).join(', ')})` : ''}</p>}
            </div>}
          </div>}
        </div>}
        {!transit && <p className="journey-source">경로 조회로 버스·지하철 노선과 첫 승차 실시간 도착을 확인하거나 외부 지도를 이용하세요.</p>}
      </>}
      {from.mode === 'car' && <>
        {car && <p className="journey-source">{(car.meters / 1000).toFixed(1)}km · {new Date(car.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회<br />자동차 예상 시간이에요.</p>}
        <div className="journey-buttons"><button className="secondary" disabled={busy || !hasCoordinates(from) || !hasCoordinates(to)} onClick={() => void queryRoad('car')}>{busy ? <span className="spinner" /> : <Car size={16} />}{busy ? '조회 중' : car ? '자동차 경로 다시 조회' : '자동차 경로 조회'}</button>{busy && <button className="icon-button" aria-label="자동차 조회 취소" onClick={cancel}><X size={17} /></button>}</div>
        {(!hasCoordinates(from) || !hasCoordinates(to)) && <p className="journey-source">두 장소의 지도 위치를 먼저 지정하세요.</p>}
      </>}
      {error && <p className="transport-error" role="status">{error}</p>}
      <div className="journey-links">
        <button className="text-button" onClick={onBus}><BusFront size={15} /> 주변 버스 도착</button>
        <div className="external-map-links">
          <a href={naverDirections(from, to)} target="_blank" rel="noreferrer">네이버 길찾기 <ExternalLink size={13} /></a>
          <a href={kakaoDirections(from, to)} target="_blank" rel="noreferrer">카카오맵 <ExternalLink size={13} /></a>
        </div>
      </div>
    </div>}
  </div>;
}
