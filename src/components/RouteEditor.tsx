import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, Check, Clock3, Coffee, Copy, ExternalLink, GripVertical, LocateFixed, MapPin,
  Plus, Play, Share2, Trash2, Utensils, Trees, Palette, ShoppingBag, ChevronDown, CalendarDays, BusFront, Navigation, Pencil, RefreshCw } from 'lucide-react';
import { formatDuration, hasCoordinates, makeStop, schedule, totalMinutes, transitFor, walkingFor, walkingKey, type Category, type Route, type Stop, type TransitLeg } from '../domain';
import { carParams, kakaoDirections, naverDirections, reverseGeocodeParams, transitParams, transportRequest, walkingParams, type TransitOption, type TransitRouteResult, type WalkingResult } from '../transport';
import type { UserLocation } from './MapView';
import PlacePicker from './PlacePicker';
import RouteCover from './RouteCover';
import CoverPhotoControl from './CoverPhotoControl';
import MapPreviewCredit from './MapPreviewCredit';
import TravelLeg from './TravelLeg';
import BusPanel from './BusPanel';
import TransitCandidateCard from './TransitCandidateCard';

const MapView = lazy(() => import('./MapView'));
const categoryIcons = { '식사': Utensils, '카페': Coffee, '산책': Trees, '문화': Palette, '쇼핑': ShoppingBag, '기타': MapPin };
const categoryIcon = (category: Category, size = 19) => { const Icon = categoryIcons[category]; return <Icon size={size} />; };

function stripOption(opt: TransitOption): TransitLeg {
  const { key, summary, minutes, transfers, walkMinutes, fare, fetchedAt, steps, coordinates: coords } = opt;
  return { key, summary, minutes, transfers, walkMinutes, ...(fare !== undefined ? { fare } : {}), fetchedAt, steps, coordinates: coords };
}

export default function RouteEditor({ route, onChange, onBack, onShare, onDuplicate, onDelete, readonly = false, onSaveCopy }: {
  route: Route; onChange: (r: Route) => boolean; onBack: () => void; onShare: () => void;
  onDuplicate: () => void; onDelete: () => void; readonly?: boolean; onSaveCopy?: () => void;
}) {
  const latestRoute = useRef(route); latestRoute.current = route;
  const [adding, setAdding] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null), [picking, setPicking] = useState<string | null>(null);
  const [preview, setPreview] = useState(readonly), [mobileMap, setMobileMap] = useState(() => route.stops.length > 0 && window.matchMedia('(max-width: 760px)').matches);
  const [tour, setTour] = useState(false), [details, setDetails] = useState(false);
  const [busStop, setBusStop] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null), [locating, setLocating] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);

  // Active leg tab below map: 'user-origin' or stop.id (for leg i -> i+1)
  const [activeLegId, setActiveLegId] = useState<string>(() => route.stops[0]?.id || 'user-origin');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [mapLegOptions, setMapLegOptions] = useState<Record<string, TransitOption[]>>({});
  const [mapLegBusy, setMapLegBusy] = useState<Record<string, boolean>>({});
  const [mapLegError, setMapLegError] = useState<Record<string, string>>({});
  const [selectedUserOptId, setSelectedUserOptId] = useState<string>('');
  const [autoWalkCoords, setAutoWalkCoords] = useState<Record<string, [number, number][]>>({});

  const locateMe = () => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      const lng = pos.coords.longitude, lat = pos.coords.latitude;
      setUserLocation({ lng, lat });
      setActiveLegId('user-origin');
      setDrawerOpen(true);
      setLocating(false);
      void transportRequest<{ address: string }>(reverseGeocodeParams(lng, lat), new AbortController().signal, 3600000)
        .then(r => { if (r.address) setUserLocation({ lng, lat, address: r.address }); }).catch(() => {});
    }, () => { setLocating(false); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  };
  const applyTransit = (stopId: string, leg: TransitLeg) => {
    patchStop(stopId, { mode: 'transit', transit: leg, travelMinutes: leg.minutes });
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Resolve active leg endpoints
  const locatedStops = route.stops.filter(hasCoordinates);
  const getActiveLegEndpoints = (legId: string): { id: string; label: string; from: Stop; to: Stop; isUserOrigin?: boolean } | null => {
    if (legId === 'user-origin') {
      if (!userLocation || !locatedStops[0]) return null;
      return {
        id: 'user-origin',
        label: `내 위치 → 1. ${locatedStops[0].name || '첫 장소'}`,
        from: makeStop({ id: 'user-origin', name: userLocation.address || '지금 내 위치', lng: userLocation.lng, lat: userLocation.lat, mode: 'transit' }),
        to: locatedStops[0],
        isUserOrigin: true,
      };
    }
    const idx = route.stops.findIndex(s => s.id === legId);
    if (idx >= 0 && idx < route.stops.length - 1) {
      const a = route.stops[idx], b = route.stops[idx + 1];
      if (hasCoordinates(a) && hasCoordinates(b)) {
        return { id: a.id, label: `${idx + 1}. ${a.name || '장소'} → ${idx + 2}. ${b.name || '장소'}`, from: a, to: b };
      }
    }
    if (route.stops.length >= 2 && hasCoordinates(route.stops[0]) && hasCoordinates(route.stops[1])) {
      return { id: route.stops[0].id, label: `1. ${route.stops[0].name || '장소'} → 2. ${route.stops[1].name || '장소'}`, from: route.stops[0], to: route.stops[1] };
    }
    return null;
  };

  const activeLeg = getActiveLegEndpoints(activeLegId);
  const activeOptions = activeLeg ? (mapLegOptions[activeLeg.id] || []) : [];
  const activeSavedTransit = activeLeg && !activeLeg.isUserOrigin ? transitFor(activeLeg.from, activeLeg.to) : undefined;
  const previewTransit: TransitLeg | null = activeLeg
    ? (activeLeg.isUserOrigin
      ? (activeOptions.find(o => o.id === selectedUserOptId) || activeOptions[0] || null)
      : (activeSavedTransit || activeOptions[0] || null))
    : null;

  const fetchActiveLeg = async (leg: { id: string; from: Stop; to: Stop; isUserOrigin?: boolean }, signal?: AbortSignal) => {
    setMapLegBusy(prev => ({ ...prev, [leg.id]: true }));
    setMapLegError(prev => ({ ...prev, [leg.id]: '' }));
    try {
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const data = await transportRequest<TransitRouteResult>(transitParams(leg.from, leg.to), combined, 60000);
      if (combined.aborted) return;
      setMapLegOptions(prev => ({ ...prev, [leg.id]: data.options }));
      if (leg.isUserOrigin && data.options[0]) setSelectedUserOptId(data.options[0].id);
    } catch (e) {
      if (!signal?.aborted) setMapLegError(prev => ({ ...prev, [leg.id]: e instanceof Error ? e.message : '경로를 조회하지 못했어요.' }));
    } finally {
      if (!signal?.aborted) setMapLegBusy(prev => ({ ...prev, [leg.id]: false }));
    }
  };

  useEffect(() => {
    if (!activeLeg || !drawerOpen) return;
    const controller = new AbortController();
    void fetchActiveLeg(activeLeg, controller.signal);
    return () => controller.abort();
  }, [activeLeg?.id, activeLeg?.from.lng, activeLeg?.from.lat, activeLeg?.to.lng, activeLeg?.to.lat, drawerOpen]);

  // Automatically fetch real TMAP road/pedestrian geometry for all stop-to-stop legs so map never shows straight lines
  useEffect(() => {
    const controller = new AbortController();
    for (let i = 0; i < route.stops.length - 1; i++) {
      const a = route.stops[i], b = route.stops[i + 1];
      if (!hasCoordinates(a) || !hasCoordinates(b)) continue;
      const wKey = walkingKey(a, b);
      if (autoWalkCoords[wKey] || walkingFor(a, b)?.coordinates.length || transitFor(a, b)?.coordinates.length) continue;
      const dist = Math.hypot(b.lng - a.lng, b.lat - a.lat);
      const params = dist <= 0.045 ? walkingParams(a, b) : carParams(a, b);
      void transportRequest<WalkingResult>(params, controller.signal, 3600000)
        .then(res => {
          if (!controller.signal.aborted && res.coordinates.length >= 2) {
            setAutoWalkCoords(prev => ({ ...prev, [wKey]: res.coordinates }));
          }
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [route.stops.map(s => `${s.id}:${s.lng}:${s.lat}`).join('|')]);

  const times = schedule(route), departures = schedule(route, true);
  const patch = (p: Partial<Route>) => onChange({ ...latestRoute.current, ...p, updatedAt: new Date().toISOString() });
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
          <button className="bus-entry" onClick={() => setBusStop(selected || route.stops[0]?.id || '')}><BusFront size={18} /><span>실시간 경로 · 대중교통 후보</span><span>내 위치 · 도보+버스/지하철</span></button>
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
              {i < route.stops.length - 1 && <TravelLeg from={stop} to={route.stops[i + 1]} region={route.region} readonly={readonly || preview} departure={departures[i]} onPatch={p => patchStop(stop.id, p)} onBus={() => { setActiveLegId(stop.id); setDrawerOpen(true); setBusStop(stop.id); }} />}
            </div>;
          })}</div>
          {!preview && <button className="add-stop" disabled={route.stops.length >= 100} onClick={() => setAdding(true)}><Plus size={19} /> {route.stops.length >= 100 ? '최대 100곳' : '장소 추가'}</button>}
        </div>
      </section>
      <aside className={`map-pane ${mobileMap ? 'mobile-visible' : ''}`}>
        <Suspense fallback={<div className="map-placeholder"><span className="spinner" /> 지도를 준비하고 있어요</div>}>
          {(!narrow || mobileMap) && <MapView stops={route.stops} selectedId={selected} userLocation={userLocation} locating={locating} onLocate={locateMe} previewTransit={previewTransit} autoWalkCoords={autoWalkCoords} onSelect={id => { setTour(false); setSelected(id); }} onInteract={() => setTour(false)} onOverview={() => { setSelected(null); setTour(false); }} picking={!!picking} tour={preview} onPick={(lng, lat) => {
            if (picking && !readonly) {
              const targetId = picking, currentStop = latestRoute.current.stops.find(s => s.id === targetId);
              patchStop(targetId, { lng, lat });
              if (currentStop && !currentStop.address.trim()) {
                void transportRequest<{ address: string }>(reverseGeocodeParams(lng, lat), new AbortController().signal, 3600000)
                  .then(r => { if (r.address) patchStop(targetId, { address: r.address }); }).catch(() => {});
              }
            }
            setPicking(null); setMobileMap(false);
          }} />}
        </Suspense>
        {route.stops.length > 0 && <div className="map-leg-strip" aria-label="순서별 경로 바로가기">
          <button
            type="button"
            className={`map-leg-chip ${activeLeg?.id === 'user-origin' ? 'active' : ''}`}
            onClick={() => {
              if (!userLocation) locateMe();
              setActiveLegId('user-origin');
              setDrawerOpen(true);
            }}
          >
            <LocateFixed size={13} />
            <span>{userLocation ? `내 위치 → 1. ${route.stops[0]?.name || '첫 장소'}` : '지금 내 위치 출발'}</span>
          </button>
          {route.stops.slice(0, -1).map((s, idx) => {
            const next = route.stops[idx + 1];
            const tr = transitFor(s, next), wk = walkingFor(s, next);
            const sub = tr ? `${tr.minutes}분 · ${tr.summary}` : wk ? `도보 ${wk.minutes}분` : '후보 경로 보기';
            return <button
              key={s.id}
              type="button"
              className={`map-leg-chip ${activeLeg?.id === s.id ? 'active' : ''}`}
              onClick={() => { setActiveLegId(s.id); setDrawerOpen(true); }}
            >
              <strong>{idx + 1}→{idx + 2}</strong>
              <span>{s.name || '장소'} → {next.name || '장소'} <em>({sub})</em></span>
            </button>;
          })}
        </div>}

        {/* Inline Naver Map-style Transit Candidate Drawer directly below Map (Image 2 + Image 3) */}
        {route.stops.length > 0 && activeLeg && (
          <section className="map-transit-drawer" aria-label="지도 하단 실시간 대중교통 후보">
            <div className="map-drawer-head">
              <div className="map-drawer-title">
                <BusFront size={15} />
                <strong>{activeLeg.label}</strong>
              </div>
              <div className="map-drawer-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="경로 후보 새로고침"
                  disabled={mapLegBusy[activeLeg.id]}
                  onClick={() => void fetchActiveLeg(activeLeg)}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDrawerOpen(!drawerOpen)}
                >
                  {drawerOpen ? '접기' : '후보 펼치기'} <ChevronDown size={14} className={drawerOpen ? 'rotate' : ''} />
                </button>
              </div>
            </div>

            {drawerOpen && (
              <div className="map-drawer-body">
                {mapLegBusy[activeLeg.id] && (
                  <p className="transport-loading" role="status"><span className="spinner" /> 실시간 버스·지하철 후보를 불러오고 있어요…</p>
                )}
                {mapLegError[activeLeg.id] && (
                  <p className="transport-error" role="status">{mapLegError[activeLeg.id]}</p>
                )}
                {(mapLegOptions[activeLeg.id] || []).length > 0 && (
                  <div className="nv-candidate-list">
                    {(mapLegOptions[activeLeg.id] || []).map((opt, idx) => {
                      const savedTransit = !activeLeg.isUserOrigin ? transitFor(activeLeg.from, activeLeg.to) : undefined;
                      const isSel = activeLeg.isUserOrigin
                        ? (selectedUserOptId ? selectedUserOptId === opt.id : idx === 0)
                        : (savedTransit ? savedTransit.summary === opt.summary && savedTransit.minutes === opt.minutes : idx === 0);
                      return (
                        <TransitCandidateCard
                          key={opt.id}
                          option={opt}
                          index={idx}
                          selected={isSel}
                          actionLabel={activeLeg.isUserOrigin ? (isSel ? '선택됨' : '후보 선택') : (isSel && savedTransit ? '적용됨' : '이 경로 선택')}
                          onSelect={
                            activeLeg.isUserOrigin
                              ? () => setSelectedUserOptId(opt.id)
                              : !readonly && !preview
                                ? () => applyTransit(activeLeg.from.id, stripOption(opt))
                                : undefined
                          }
                          onOpenArrivals={() => setBusStop(activeLeg.isUserOrigin ? (route.stops[0]?.id || '') : activeLeg.from.id)}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="map-drawer-foot">
                  <span>{activeLeg.from.name || '출발'} → {activeLeg.to.name || '도착'}</span>
                  <div className="external-map-links">
                    <a href={naverDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">네이버 지도 <ExternalLink size={12} /></a>
                    <a href={kakaoDirections(activeLeg.from, activeLeg.to)} target="_blank" rel="noreferrer">카카오맵 <ExternalLink size={12} /></a>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <div className="map-tour-control"><div><h3>{current?.name || route.title}</h3><p>{current ? `${times[route.stops.indexOf(current)]} 도착 · ${current.duration}분 머물기` : `${route.stops.length}곳 · ${route.startTime} 출발`}</p></div>
          <div className="map-bottom-actions"><button className="secondary map-bus-btn" aria-label="실시간 경로 및 버스 후보 열기" onClick={() => setBusStop(selected || route.stops[0]?.id || '')}><BusFront size={16} /> 경로·버스</button><button className="primary" disabled={!route.stops.some(hasCoordinates)} onClick={() => setTour(!tour)}><Play size={16} fill="currentColor" />{tour ? '멈추기' : '둘러보기'}</button></div></div>
      </aside>
    </div>
    <div className="mobile-view-tabs" role="group" aria-label="코스 화면"><button aria-pressed={mobileMap} onClick={() => { setMobileMap(true); window.scrollTo(0, 0); }}><MapPin size={17} />지도</button><button aria-pressed={!mobileMap} onClick={() => setMobileMap(false)}><CalendarDays size={17} />일정</button></div>
    {adding && <PlacePicker onClose={() => setAdding(false)} onAdd={stop => { if (patch({ stops: [...latestRoute.current.stops, stop] })) { setAdding(false); setExpanded(stop.id); setSelected(stop.id); } }} />}
    {busStop !== null && <BusPanel stops={route.stops} initialStop={busStop} region={route.region} userLocation={userLocation} locating={locating} onLocate={locateMe} onApplyTransit={applyTransit} readonly={readonly || preview} onClose={() => setBusStop(null)} />}
  </>;
}
