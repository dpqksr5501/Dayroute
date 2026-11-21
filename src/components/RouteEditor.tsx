import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, Check, Clock3, Coffee, Copy, ExternalLink, GripVertical, LocateFixed, MapPin,
  Plus, Play, Share2, Trash2, Utensils, Trees, Palette, ShoppingBag, ChevronDown, CalendarDays, BusFront, Navigation, Pencil, RefreshCw } from 'lucide-react';
import { carFor, formatDuration, hasCoordinates, roadPreviewKey, schedule, totalMinutes, walkingFor, walkingKey, type Category, type Route, type Stop, type TransitLeg } from '../domain';
import { carParams, kakaoDirections, naverDirections, reverseGeocodeParams, transportRequest, walkingParams, type WalkingResult } from '../transport';
import type { UserLocation } from './MapView';
import PlacePicker from './PlacePicker';
import RouteCover from './RouteCover';
import CoverPhotoControl from './CoverPhotoControl';
import MapPreviewCredit from './MapPreviewCredit';
import TravelLeg from './TravelLeg';
import BusPanel from './BusPanel';
import TransitOptions from './TransitOptions';
import { appliedTransitFor, originLegId, savedTransitOption, transitIdentity, transitLegs, transitOptionPatch } from '../transitCandidates';
import { useTransitOptions } from '../useTransitOptions';

const MapView = lazy(() => import('./MapView'));
const categoryIcons = { '식사': Utensils, '카페': Coffee, '산책': Trees, '문화': Palette, '쇼핑': ShoppingBag, '기타': MapPin };
const categoryIcon = (category: Category, size = 19) => { const Icon = categoryIcons[category]; return <Icon size={size} />; };

export default function RouteEditor({ route, onChange, onBack, onShare, onDuplicate, onDelete, readonly = false, onSaveCopy }: {
  route: Route; onChange: (r: Route) => boolean; onBack: () => void; onShare: () => void;
  onDuplicate: () => void; onDelete: () => void; readonly?: boolean; onSaveCopy?: () => void;
}) {
  const latestRoute = useRef(route); latestRoute.current = route;
  const [adding, setAdding] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null), [picking, setPicking] = useState<string | null>(null);
  const [preview, setPreview] = useState(readonly), [mobileMap, setMobileMap] = useState(() => route.stops.length > 0 && window.matchMedia('(max-width: 760px)').matches);
  const [tour, setTour] = useState(false), [details, setDetails] = useState(false);
  const [busPanel, setBusPanel] = useState<{ stopId?: string; nearby?: boolean } | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null), [locating, setLocating] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);

  const [activeLegId, setActiveLegId] = useState(() => route.stops[0]?.id || originLegId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [selectedTransit, setSelectedTransit] = useState<{ id: string; route: TransitLeg } | null>(null);
  const [roadCoordinates, setRoadCoordinates] = useState<Record<string, [number, number][]>>({});
  const [applyError, setApplyError] = useState('');

  const locateMe = () => {
    if (locating) return;
    if (!navigator.geolocation) {
      setLocationError('이 브라우저에서 위치 확인을 사용할 수 없어요.');
      return;
    }
    setLocationError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      const { longitude: lng, latitude: lat } = pos.coords;
      setUserLocation({ lng, lat });
      setActiveLegId(originLegId);
      setDrawerOpen(true);
      setLocating(false);
      void transportRequest<{ address: string }>(reverseGeocodeParams(lng, lat), new AbortController().signal)
        .then(result => setUserLocation(current => result.address && current?.lng === lng && current.lat === lat
          ? { lng, lat, address: result.address } : current)).catch(() => {});
    }, error => {
      setLocating(false);
      setLocationError(error.code === 1 ? '브라우저에서 위치 권한을 허용한 뒤 다시 시도해 주세요.' : '내 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };
  const applyTransit = (stopId: string, leg: TransitLeg) => {
    const stops = latestRoute.current.stops;
    const index = stops.findIndex(stop => stop.id === stopId);
    const from = stops[index], to = stops[index + 1];
    return !!from && !!to && leg.key === walkingKey(from, to) && patchStop(stopId, transitOptionPatch(leg));
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const times = schedule(route), departures = schedule(route, true);
  const legs = transitLegs(route.stops, userLocation, departures);
  const activeLeg = legs.find(leg => leg.id === activeLegId) ?? (activeLegId === originLegId ? null : legs[0] ?? null);
  const mapVisible = !narrow || mobileMap;
  const candidates = useTransitOptions(activeLeg, mapVisible && drawerOpen && busPanel === null);
  const activeSavedTransit = activeLeg && activeLeg.id !== originLegId ? appliedTransitFor(activeLeg.from, activeLeg.to) : undefined;
  const previewTransit = activeLeg && selectedTransit?.id === activeLeg.id && selectedTransit.route.key === walkingKey(activeLeg.from, activeLeg.to)
    ? selectedTransit.route : null;

  const roadFrom = activeLeg?.id === originLegId ? null : activeLeg?.from;
  const roadTo = activeLeg?.to;
  const roadKey = roadFrom && roadTo && roadFrom.mode !== 'transit' ? roadPreviewKey(roadFrom, roadTo) : '';
  const roadAlreadySaved = !!(roadFrom && roadTo && (walkingFor(roadFrom, roadTo) ?? carFor(roadFrom, roadTo))?.coordinates.length);
  const roadAlreadyLoaded = !!roadCoordinates[roadKey];
  const roadQuery = roadKey && roadFrom && roadTo ? new URLSearchParams(
    roadFrom.mode === 'walk' ? walkingParams(roadFrom, roadTo) : carParams(roadFrom, roadTo),
  ).toString() : '';
  useEffect(() => {
    if (!mapVisible || !roadQuery || roadAlreadySaved || roadAlreadyLoaded) return;
    const controller = new AbortController();
    void transportRequest<WalkingResult>(Object.fromEntries(new URLSearchParams(roadQuery)), controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setRoadCoordinates(previous => ({
          ...Object.fromEntries(Object.entries(previous).slice(-99)), [roadKey]: result.coordinates,
        }));
      }).catch(() => {});
    return () => controller.abort();
  }, [mapVisible, roadQuery, roadKey, roadAlreadySaved, roadAlreadyLoaded]);

  const patch = (p: Partial<Route>) => {
    const next = { ...latestRoute.current, ...p, updatedAt: new Date().toISOString() };
    if (!onChange(next)) return false;
    latestRoute.current = next;
    return true;
  };
  const patchStop = (id: string, p: Partial<Stop>) => patch({ stops: latestRoute.current.stops.map(s => s.id === id ? { ...s, ...p } : s) });
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= route.stops.length) return;
    const stops = [...route.stops]; stops.splice(to, 0, stops.splice(from, 1)[0]); patch({ stops });
  };
  useEffect(() => {
    if (!tour || !route.stops.length) return;
    const located = route.stops.filter(hasCoordinates);
    if (!located.length) { setTour(false); return; }
    let i = 0; setSelected(located[0].id);
    const id = window.setInterval(() => {
      i++;
      if (i >= located.length) { setTour(false); clearInterval(id); }
      else setSelected(located[i].id);
    }, 3800);
    return () => clearInterval(id);
  }, [tour, route.stops]);
  const current = route.stops.find(s => s.id === selected);
  return <>
    <div className="editor-toolbar"><button className="text-button" onClick={onBack}><ArrowLeft size={17} /> 코스 보관함</button>
      <div className="toolbar-actions">{readonly ? <span className="badge">공유받은 코스 · 보기 전용</span> : <>
        <button className="icon-button desktop-only" aria-label="코스 복제" onClick={onDuplicate}><Copy size={18} /></button>
        <button className="icon-button" aria-label="코스 삭제" title="코스 삭제" onClick={onDelete}><Trash2 size={17} /></button>
        <button className="secondary small" onClick={() => { setPreview(!preview); setPicking(null); }}>{preview ? <Pencil size={16} /> : <Play size={16} />}{preview ? '편집하기' : '미리보기'}</button>
      </>}<button className="primary small" onClick={readonly ? onSaveCopy : onShare}>{readonly ? <Plus size={16} /> : <Share2 size={16} />}{readonly ? '내 보관함에 저장' : '공유하기'}</button></div>
    </div>
    <div className="editor-layout">
      <section className={`itinerary-pane ${mobileMap ? 'mobile-hidden' : ''}`} aria-label="코스 일정">
        <div className="editor-cover"><RouteCover route={route} />{!route.coverPhoto && route.stops.some(hasCoordinates) && <MapPreviewCredit />}{!preview && !readonly && <CoverPhotoControl hasPhoto={!!route.coverPhoto} onChange={photo => onChange({ ...latestRoute.current, coverPhoto: photo, updatedAt: new Date().toISOString() })} />}</div>
        <div className="itinerary-content">
          {preview ? <h1 className="route-heading">{route.title}</h1> : <input className="route-title-input" aria-label="코스 제목" value={route.title} maxLength={100} onChange={e => patch({ title: e.target.value })} />}
          {preview && route.description && <p className="route-description">{route.description}</p>}
          <div className="route-meta"><span><CalendarDays size={15} />{route.date ? route.date.replaceAll('-', '.') : '날짜 미정'}</span><span><MapPin size={15} />{route.stops.length}곳</span><span title="체류 시간과 구간별 예상 이동 시간을 합친 계획이에요"><Clock3 size={15} />일정 {formatDuration(totalMinutes(route))}</span></div>
          <button className="bus-entry" onClick={() => setBusPanel({ stopId: selected ?? route.stops[0]?.id })}><BusFront size={18} /><span>실시간 경로 · 대중교통 후보</span><span>내 위치 · 도보+버스/지하철</span></button>
          {!preview && <><button className="details-toggle" aria-expanded={details} onClick={() => setDetails(!details)}><CalendarDays size={15} /> 코스 설정 <ChevronDown size={15} className={details ? 'rotate' : ''} /></button>
            {details && <div className="route-settings form-grid"><label>날짜<input type="date" value={route.date} onChange={e => patch({ date: e.target.value })} /></label><label>시작 시간<input type="time" value={route.startTime} onChange={e => patch({ startTime: e.target.value || '12:00' })} /></label>
              <label>지역<input value={route.region} maxLength={100} placeholder="서울 · 성수" onChange={e => patch({ region: e.target.value })} /></label><label>색상<select value={route.theme} onChange={e => patch({ theme: e.target.value as Route['theme'] })}><option value="forest">세이지</option><option value="town">샌드</option><option value="river">블루</option></select></label><label className="span-2">소개<textarea rows={2} aria-label="코스 소개" value={route.description} maxLength={1000} onChange={e => patch({ description: e.target.value })} /></label></div>}</>}
          <div className="timeline-title"><h2>장소 <span>{route.stops.length}</span></h2></div>
          {!route.stops.length && <div className="empty-stops"><MapPin size={30} /></div>}
          <div className="timeline">{route.stops.map((stop, i) => {
            return <div className="stop-wrapper" key={stop.id} onDragOver={e => { if (!preview) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!preview) { const raw = e.dataTransfer.getData('text/dayroute-index'); const from = Number(raw); if (raw && Number.isInteger(from) && from >= 0 && from < route.stops.length) move(from, i); } }}>
              <span className="timeline-number">{i + 1}</span>
              <article className={`stop-card ${selected === stop.id ? 'selected' : ''}`}>
                <div className="stop-card-head">
                  {!preview && <span className="drag-handle" draggable onDragStart={e => { e.dataTransfer.setData('text/dayroute-index', String(i)); e.dataTransfer.effectAllowed = 'move'; }} title="드래그하여 순서 변경"><GripVertical size={17} /></span>}
                  <button className="stop-summary" onClick={() => { setSelected(stop.id); if (!preview) setExpanded(expanded === stop.id ? null : stop.id); }} aria-expanded={preview ? undefined : expanded === stop.id}>
                    <span className={`category-icon cat-${stop.category}`}>{categoryIcon(stop.category)}</span><span><small>{times[i]} <span>· {stop.category}</span></small><strong>{stop.name || '이름 없는 장소'}</strong></span>
                  </button>
                  {!preview && <button className="icon-button" aria-label={`${stop.name || '장소'} 편집`} onClick={() => { setExpanded(expanded === stop.id ? null : stop.id); setSelected(stop.id); }}><ChevronDown size={17} className={expanded === stop.id ? 'rotate' : ''} /></button>}
                </div>
                {preview && <div className="preview-stop">{(stop.note || stop.address) && <p>{stop.note || stop.address}</p>}<div><span><Clock3 size={13} /> {stop.duration}분</span>{stop.reserved && <span className="reservation"><Check size={13} /> 예약 완료</span>}
                  <a href={`https://map.naver.com/p/search/${encodeURIComponent(stop.address ? `${stop.name} ${stop.address}` : stop.name)}`} target="_blank" rel="noreferrer">지도에서 확인 <ExternalLink size={12} /></a></div></div>}
                {!preview && expanded === stop.id && <div className="stop-form">
                  <div className="form-grid"><label className="span-2">장소 이름<input value={stop.name} maxLength={100} placeholder="가고 싶은 장소" onChange={e => patchStop(stop.id, { name: e.target.value })} /></label>
                    <label>종류<select value={stop.category} onChange={e => patchStop(stop.id, { category: e.target.value as Category })}>{Object.keys(categoryIcons).map(c => <option key={c}>{c}</option>)}</select></label>
                    <label>머무는 시간 (분)<input type="number" min={0} max={1440} value={stop.duration} onChange={e => patchStop(stop.id, { duration: Math.max(0, Math.min(1440, Number(e.target.value))) })} /></label>
                    <label className="span-2">주소<input value={stop.address} maxLength={300} placeholder="주소를 입력해 두면 찾기 편해요" onChange={e => patchStop(stop.id, { address: e.target.value })} /></label>
                    <label className="span-2">우리의 메모<textarea rows={2} value={stop.note} maxLength={2000} placeholder="먹고 싶은 메뉴, 예약 시간, 이곳을 고른 이유…" onChange={e => patchStop(stop.id, { note: e.target.value })} /></label>
                    <label className="checkbox-label"><input type="checkbox" checked={stop.reserved} onChange={e => patchStop(stop.id, { reserved: e.target.checked })} /> 예약 완료</label>
                  </div>
                  <button className={`location-button ${picking === stop.id ? 'active' : ''}`} onClick={() => { setPicking(picking === stop.id ? null : stop.id); setMobileMap(true); }}><MapPin size={16} />{picking === stop.id ? '지도에서 위치를 눌러주세요' : hasCoordinates(stop) ? '지도에서 위치 다시 지정' : '지도에서 위치 지정'}<Navigation size={14} /></button>
                  {hasCoordinates(stop) && <small className="coordinate-label">{stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}</small>}
                  <div className="stop-controls"><div><button className="icon-button" aria-label={`${stop.name} 위로 이동`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={16} /></button><button className="icon-button" aria-label={`${stop.name} 아래로 이동`} disabled={i === route.stops.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={16} /></button></div>
                    <button className="text-button danger" onClick={() => { patch({ stops: route.stops.filter(s => s.id !== stop.id) }); if (picking === stop.id) setPicking(null); }}><Trash2 size={14} /> 삭제</button></div>
                </div>}
              </article>
              {i < route.stops.length - 1 && <TravelLeg from={stop} to={route.stops[i + 1]} region={route.region} readonly={readonly || preview} departure={departures[i]} onPatch={p => patchStop(stop.id, p)} onBus={() => setBusPanel({ stopId: stop.id, nearby: true })} />}
            </div>;
          })}</div>
          {!preview && <button className="add-stop" disabled={route.stops.length >= 100} onClick={() => setAdding(true)}><Plus size={19} /> {route.stops.length >= 100 ? '최대 100곳' : '장소 추가'}</button>}
        </div>
      </section>
      <aside className={`map-pane ${mobileMap ? 'mobile-visible' : ''}`}>
        <Suspense fallback={<div className="map-placeholder"><span className="spinner" /> 지도를 준비하고 있어요</div>}>
          {(!narrow || mobileMap) && <MapView stops={route.stops} selectedId={selected} userLocation={userLocation} locating={locating} onLocate={locateMe} previewTransit={previewTransit} roadCoordinates={roadCoordinates} onSelect={id => { setTour(false); setSelected(id); }} onInteract={() => setTour(false)} onOverview={() => { setSelected(null); setTour(false); }} picking={!!picking} tour={preview} onPick={(lng, lat) => {
            if (picking && !readonly) {
              const targetId = picking, currentStop = latestRoute.current.stops.find(s => s.id === targetId);
              patchStop(targetId, { lng, lat });
              if (currentStop && !currentStop.address.trim()) {
                void transportRequest<{ address: string }>(reverseGeocodeParams(lng, lat), new AbortController().signal)
                  .then(r => {
                    const latest = latestRoute.current.stops.find(stop => stop.id === targetId);
                    if (r.address && latest?.lng === lng && latest.lat === lat && !latest.address.trim()) {
                      patchStop(targetId, { address: r.address });
                    }
                  }).catch(() => {});
              }
            }
            setPicking(null); setMobileMap(false);
          }} />}
        </Suspense>
        {route.stops.length > 0 && <div className="map-leg-strip" role="group" aria-label="이동 구간 선택">
          <button type="button" className={`map-leg-chip ${activeLegId === originLegId ? 'active' : ''}`}
            aria-pressed={activeLegId === originLegId} disabled={locating || !hasCoordinates(route.stops[0])}
            title={!hasCoordinates(route.stops[0]) ? '첫 장소의 지도 위치를 먼저 지정하세요.' : undefined}
            onClick={() => {
              setActiveLegId(originLegId); setDrawerOpen(true); setSelectedTransit(null); setApplyError('');
              if (!userLocation) locateMe();
            }}>
            <LocateFixed size={14} aria-hidden="true" /> {userLocation ? '내 위치 → 첫 장소' : '내 위치 출발'}
          </button>
          {legs.filter(leg => leg.id !== originLegId).map(leg => <button key={leg.id} type="button"
            className={`map-leg-chip ${activeLeg?.id === leg.id ? 'active' : ''}`} aria-pressed={activeLeg?.id === leg.id}
            onClick={() => { setActiveLegId(leg.id); setDrawerOpen(true); setSelectedTransit(null); setApplyError(''); }}>
            {leg.label}
          </button>)}
        </div>}
        {activeLeg ? <section className="map-transit-drawer" aria-label="지도 하단 대중교통 후보">
          <div className="map-drawer-head">
            <div className="map-drawer-title"><BusFront size={15} aria-hidden="true" /><strong>{activeLeg.label}</strong></div>
            <div className="map-drawer-actions">
              {drawerOpen && <button type="button" className="icon-button" aria-label="경로 후보 다시 조회" disabled={candidates.loading}
                onClick={candidates.refresh}><RefreshCw size={14} aria-hidden="true" /></button>}
              <button type="button" className="text-button" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>
                {drawerOpen ? '접기' : '후보 펼치기'} <ChevronDown size={14} className={drawerOpen ? 'rotate' : ''} aria-hidden="true" />
              </button>
            </div>
          </div>
          {drawerOpen && <div className="map-drawer-body">
            {locationError && <p className="transport-error" role="status">{locationError}</p>}
            {candidates.loading && <p className="transport-loading" role="status"><span className="spinner" /> 대중교통 후보를 찾고 있어요…</p>}
            {candidates.error && <p className="transport-error" role="status">{candidates.error}</p>}
            {applyError && <p className="transport-error" role="status">{applyError}</p>}
            {candidates.result && <TransitOptions key={`${activeLeg.id}:${walkingKey(activeLeg.from, activeLeg.to)}`}
              result={candidates.result} leg={activeLeg} routeRegion={route.region} saved={activeSavedTransit} previewed={previewTransit}
              onPreview={option => setSelectedTransit(previewTransit && transitIdentity(previewTransit) === transitIdentity(option)
                ? null : { id: activeLeg.id, route: option })}
              onApply={!readonly && !preview && activeLeg.id !== originLegId ? option => {
                setApplyError(applyTransit(activeLeg.id, savedTransitOption(option)) ? '' : '경로를 적용하지 못했어요. 구간을 확인해 주세요.');
              } : undefined} />}
            <div className="map-drawer-foot">
              <div className="external-map-links">
                <a href={naverDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">네이버 길찾기 <ExternalLink size={12} /></a>
                <a href={kakaoDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">카카오 길찾기 <ExternalLink size={12} /></a>
              </div>
            </div>
          </div>}
        </section> : route.stops.length > 0 && <p className="map-candidate-message" role="status">
          {locating ? '내 위치를 확인하고 있어요…' : locationError || (activeLegId === originLegId && hasCoordinates(route.stops[0])
            ? '내 위치를 확인하면 첫 장소까지의 경로를 볼 수 있어요.' : '이동 구간을 조회하려면 출발지와 도착지의 지도 위치가 필요해요.')}
        </p>}

        <div className="map-tour-control"><div><h3>{current?.name || route.title}</h3><p>{current ? `${times[route.stops.indexOf(current)]} 도착 · ${current.duration}분 머물기` : `${route.stops.length}곳 · ${route.startTime} 출발`}</p></div>
          <div className="map-bottom-actions"><button className="secondary map-bus-btn" aria-label="실시간 경로 및 버스 후보 열기" onClick={() => setBusPanel({ stopId: selected ?? route.stops[0]?.id })}><BusFront size={16} /> 경로·버스</button><button className="primary" disabled={!route.stops.some(hasCoordinates)} onClick={() => setTour(!tour)}><Play size={16} fill="currentColor" />{tour ? '멈추기' : '둘러보기'}</button></div></div>
      </aside>
    </div>
    <div className="mobile-view-tabs" role="group" aria-label="코스 화면"><button aria-pressed={mobileMap} onClick={() => { setMobileMap(true); window.scrollTo(0, 0); }}><MapPin size={17} />지도</button><button aria-pressed={!mobileMap} onClick={() => setMobileMap(false)}><CalendarDays size={17} />일정</button></div>
    {adding && <PlacePicker onClose={() => setAdding(false)} onAdd={stop => { if (patch({ stops: [...latestRoute.current.stops, stop] })) { setAdding(false); setExpanded(stop.id); setSelected(stop.id); } }} />}
    {busPanel && <BusPanel stops={route.stops} initialStop={busPanel.stopId} initialTab={busPanel.nearby ? 'station' : 'routes'} departures={departures} region={route.region} locationError={locationError} userLocation={userLocation} locating={locating} onLocate={locateMe} onApplyTransit={applyTransit} readonly={readonly || preview} onClose={() => setBusPanel(null)} />}
  </>;
}
