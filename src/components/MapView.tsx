import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import maplibregl from '../mapRuntime';
import { Box, Crosshair, LocateFixed, RotateCcw } from 'lucide-react';
import { carFor, hasCoordinates, transitFor, walkingFor, type Stop } from '../domain';
import { mapPreviewPlan } from '../mapPreviewPlan';

export interface UserLocation { lng: number; lat: number; address?: string }
interface Props { stops: Stop[]; selectedId: string | null; onSelect: (id: string) => void;
  userLocation?: UserLocation | null; onLocate?: () => void; locating?: boolean;
  picking?: boolean; onPick?: (lng: number, lat: number) => void; tour?: boolean; onInteract?: () => void; onOverview?: () => void }
export default function MapView({ stops, selectedId, onSelect, userLocation, onLocate, locating, picking, onPick, tour, onInteract, onOverview }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const userMarker = useRef<maplibregl.Marker | null>(null);
  const latest = useRef({ stops, picking, onPick, onSelect, onInteract, onOverview }); latest.current = { stops, picking, onPick, onSelect, onInteract, onOverview };
  const overview = useRef(true), framed = useRef(false), flatFocus = useRef(false);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [bearing, setBearing] = useState(0), [in3D, setIn3D] = useState(false);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fit = () => {
    const bounds = mapPreviewPlan(stops).bounds;
    if (!map.current || !bounds) return;
    overview.current = true;
    const node = map.current.getContainer(), gap = Math.max(28, Math.min(72, node.clientWidth * 0.14, node.clientHeight * 0.16));
    const padding = { top: Math.max(85, gap), right: Math.max(85, gap), bottom: Math.max(65, gap), left: gap };
    map.current.fitBounds(bounds, { padding, maxZoom: 15.3, duration: reduced || !framed.current ? 0 : 900, pitch: 0, bearing: 0 });
    framed.current = true;
  };
  const toggle3D = () => {
    const instance = map.current;
    if (!instance) return;
    latest.current.onInteract?.();
    const next3D = instance.getPitch() <= 15;
    flatFocus.current = !next3D;
    instance.easeTo({
      pitch: next3D ? 54 : 0,
      bearing: next3D && Math.abs(instance.getBearing()) < 2 ? -12 : instance.getBearing(),
      zoom: next3D && instance.getZoom() < 14.6 ? 15.2 : instance.getZoom(),
      duration: reduced ? 0 : 750,
    });
  };
  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({ container: container.current, style: 'https://tiles.openfreemap.org/styles/positron',
        center: [127.04, 37.545], zoom: 10, pitch: 0, bearing: 0,
        bounds: mapPreviewPlan(stops).bounds ?? undefined,
        fitBoundsOptions: { padding: 85, maxZoom: 15.3 },
        touchZoomRotate: true, touchPitch: true, dragPan: true, dragRotate: true,
        doubleClickZoom: true, scrollZoom: true, keyboard: true, cooperativeGestures: false,
        attributionControl: { compact: true }, maxPitch: 65, canvasContextAttributes: { antialias: true },
      });
      map.current = instance;
      instance.touchZoomRotate.enableRotation();
      instance.on('rotate', () => setBearing(instance.getBearing()));
      instance.on('pitch', () => setIn3D(instance.getPitch() > 15));
      instance.on('pitchend', e => { const tilted = instance.getPitch() > 15; setIn3D(tilted); if ('originalEvent' in e && e.originalEvent) flatFocus.current = !tilted; });
      instance.on('movestart', e => { if ('originalEvent' in e && e.originalEvent) { overview.current = false; latest.current.onInteract?.(); } });
      instance.on('touchstart', () => latest.current.onInteract?.());
      instance.on('mousedown', () => latest.current.onInteract?.());
      instance.on('wheel', () => latest.current.onInteract?.());
      instance.on('load', () => {
        try { instance.setLight({ anchor: 'viewport', color: '#fffdf8', intensity: 0.38, position: [1.3, 210, 38] }); } catch {}
        const label = instance.getStyle().layers.find(l => l.type === 'symbol')?.id;
        const sources = instance.getStyle().sources;
        const vectorSource = Object.entries(sources).find(([, s]) => s.type === 'vector')?.[0];
        if (vectorSource) instance.addLayer({ id: 'dayroute-buildings', source: vectorSource, 'source-layer': 'building',
          type: 'fill-extrusion', minzoom: 13.5, filter: ['!=', ['get', 'hide_3d'], true], paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#d3ddd0', 24, '#c2cfc0', 60, '#b0c1b2', 120, '#9cb1a1'],
            'fill-extrusion-opacity': 0.86,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          } }, label);
        instance.addSource('dayroute-path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        instance.addLayer({ id: 'dayroute-path-line', type: 'line', source: 'dayroute-path', paint: {
          'line-color': '#52725a', 'line-width': 3, 'line-dasharray': [2, 2], 'line-opacity': 0.85,
        }, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'road'], true], ['!=', ['get', 'transit'], true]] });
        instance.addLayer({ id: 'dayroute-road-casing', type: 'line', source: 'dayroute-path', filter: ['==', ['get', 'road'], true],
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 } });
        instance.addLayer({ id: 'dayroute-road-line', type: 'line', source: 'dayroute-path', filter: ['==', ['get', 'road'], true],
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#315e4c', 'line-width': 5, 'line-opacity': 0.94 } });
        instance.addLayer({ id: 'dayroute-transit-casing', type: 'line', source: 'dayroute-path', filter: ['==', ['get', 'transit'], true],
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 } });
        instance.addLayer({ id: 'dayroute-transit-line', type: 'line', source: 'dayroute-path', filter: ['==', ['get', 'transit'], true],
          layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2b5b84', 'line-width': 5, 'line-opacity': 0.94 } });
        instance.addLayer({ id: 'dayroute-transit-nodes', type: 'circle', source: 'dayroute-path', filter: ['==', ['get', 'transitNode'], true],
          paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#2b5b84', 'circle-stroke-width': 2.2 } });
        setReady(true); setError('');
      });
      instance.on('click', e => { if (latest.current.picking) latest.current.onPick?.(e.lngLat.lng, e.lngLat.lat); });
      instance.on('error', () => { setError('일부 지도 데이터를 불러오지 못했어요. 연결을 확인해 주세요.'); });
      instance.on('idle', () => { if (instance.isStyleLoaded()) setError(''); });
    } catch { setError('이 환경에서 3D 지도를 시작하지 못했어요. 일정은 계속 편집할 수 있어요.'); return; }
    const observer = new ResizeObserver(() => {
      instance.resize();
      const bounds = mapPreviewPlan(latest.current.stops).bounds;
      if (overview.current && bounds && instance.isStyleLoaded()) {
        const node = instance.getContainer(), gap = Math.max(28, Math.min(72, node.clientWidth * 0.14, node.clientHeight * 0.16));
        const padding = { top: Math.max(85, gap), right: Math.max(85, gap), bottom: Math.max(65, gap), left: gap };
        instance.fitBounds(bounds, { padding, maxZoom: 15.3, pitch: 0, bearing: 0, duration: 0 });
      }
    }); observer.observe(container.current);
    const timeout = window.setTimeout(() => { if (!instance.isStyleLoaded()) setError('지도를 불러오는 데 시간이 걸리고 있어요. 인터넷 연결을 확인해 주세요.'); }, 15000);
    return () => { clearTimeout(timeout); observer.disconnect(); userMarker.current?.remove(); markers.current.forEach(m => m.remove()); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    userMarker.current?.remove();
    userMarker.current = null;
    if (userLocation) {
      const el = document.createElement('div');
      el.className = 'map-user-pin';
      el.title = userLocation.address ? `내 위치 · ${userLocation.address}` : '지금 내 위치';
      el.setAttribute('aria-label', '지금 내 위치');
      userMarker.current = new maplibregl.Marker({ element: el }).setLngLat([userLocation.lng, userLocation.lat]).addTo(instance);
      overview.current = false;
      instance.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: Math.max(instance.getZoom(), 14.8), duration: reduced ? 0 : 1000 });
    }
  }, [ready, userLocation?.lng, userLocation?.lat]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    markers.current.forEach(m => m.remove());
    markers.current = stops.flatMap((s, i) => {
      if (!hasCoordinates(s)) return [];
      const button = document.createElement('button'); button.className = `map-pin ${s.id === selectedId ? 'active' : ''}`;
      button.textContent = String(i + 1); button.setAttribute('aria-label', `${s.name} 지도에서 보기`);
      button.onclick = e => { e.stopPropagation(); latest.current.onSelect(s.id); };
      return [new maplibregl.Marker({ element: button }).setLngLat([s.lng, s.lat]).addTo(instance)];
    });
    const features = stops.flatMap((s, i) => {
      const next = stops[i + 1];
      if (!next || !hasCoordinates(s) || !hasCoordinates(next)) return [];
      const walk = walkingFor(s, next) ?? carFor(s, next), transit = transitFor(s, next);
      const road = !!walk?.coordinates.length, transitRoad = !!transit?.coordinates.length;
      const coordinates = road ? walk!.coordinates : transitRoad ? transit!.coordinates : [[s.lng, s.lat], [next.lng, next.lat]];
      const lineFeature = { type: 'Feature' as const, properties: { road, transit: transitRoad }, geometry: { type: 'LineString' as const, coordinates } };
      const nodeFeatures = (transit?.steps || [])
        .filter(step => step.mode !== 'walk' && typeof step.fromLng === 'number' && typeof step.fromLat === 'number')
        .map(step => ({ type: 'Feature' as const, properties: { transitNode: true }, geometry: { type: 'Point' as const, coordinates: [step.fromLng!, step.fromLat!] } }));
      return [lineFeature, ...nodeFeatures];
    });
    (instance.getSource('dayroute-path') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features });
  }, [ready, stops, selectedId]);
  useEffect(() => { if (ready) fit(); }, [ready, stops.map(s => `${s.id}:${s.lng}:${s.lat}`).join('|')]);
  useEffect(() => {
    const selected = stops.find(s => s.id === selectedId);
    if (ready && map.current && selected && hasCoordinates(selected)) {
      overview.current = false;
      map.current.flyTo({ center: [selected.lng, selected.lat], zoom: 15.9,
        pitch: flatFocus.current ? 0 : 52, bearing: map.current.getBearing(), duration: reduced ? 0 : 1400 });
    }
  }, [ready, selectedId]);
  useEffect(() => { if (map.current) map.current.getCanvas().style.cursor = picking ? 'crosshair' : ''; }, [ready, picking]);
  const hasWalkRoad = stops.some((s, i) => (walkingFor(s, stops[i + 1]) ?? carFor(s, stops[i + 1]))?.coordinates.length);
  const hasTransitRoad = stops.some((s, i) => transitFor(s, stops[i + 1])?.coordinates.length);
  return <div className={`map-shell ${tour ? 'tour-map' : ''}`}>
    <div ref={container} className="map-canvas" aria-label="코스 지도" />
    <div className="map-actions">
      {onLocate && <button className={`map-action ${userLocation ? 'active-locate' : ''}`} disabled={locating} onClick={() => { latest.current.onInteract?.(); onLocate(); }} aria-label="지금 내 위치 표시"><LocateFixed size={15} /> {locating ? '위치 확인 중' : '내 위치'}</button>}
      <button className="map-action" onClick={() => { latest.current.onInteract?.(); latest.current.onOverview?.(); fit(); }} aria-label="전체 코스 보기"><RotateCcw size={16} /> 전체</button>
      <button className={`map-action ${in3D ? 'active-mode' : ''}`} onClick={toggle3D} aria-pressed={in3D} aria-label="3D 입체 지도 전환"><Box size={15} /> {in3D ? '3D' : '2D'}</button>
      <button className="map-action map-compass" aria-label="북쪽 방향으로 되돌리기" title="북쪽으로 · 기울기 초기화" onClick={() => { latest.current.onInteract?.(); map.current?.easeTo({ bearing: 0, pitch: 0, duration: reduced ? 0 : 700 }); }}>
        <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true"><text x="10" y="6" textAnchor="middle" fontSize="7" fill="currentColor">N</text><g transform={`rotate(${-bearing} 10 15)`}><path d="M10 8 14 16 10 14Z" fill="#a65f51" /><path d="M10 8 6 16 10 14Z" fill="#ce8c7e" /><path d="M10 22 6 14 10 16Z" fill="#9aa697" /><path d="M10 22 14 14 10 16Z" fill="#71836d" /></g></svg>
      </button>
    </div>
    {stops.length > 1 && <div className="map-route-key">점선 · 장소 연결{hasWalkRoad ? ' / 초록 실선 · 도로' : ''}{hasTransitRoad ? ' / 파란 실선 · 대중교통' : ''}</div>}
    {picking && <div className="map-pick-message"><Crosshair size={17} /> 지도를 눌러 장소의 위치를 지정하세요</div>}
    {error && <div className="map-error" role="status">{error}</div>}
    {!ready && !error && <div className="map-loading"><span className="spinner" /> 지도를 펼치고 있어요</div>}
  </div>;
}
