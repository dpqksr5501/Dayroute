import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource } from 'maplibre-gl';
import maplibregl from '../mapRuntime';
import { Crosshair, Info, Layers3, Map as MapIcon, RotateCcw } from 'lucide-react';
import { hasCoordinates, type Stop } from '../domain';
import { mapPreviewPlan } from '../mapPreviewPlan';

interface Props { stops: Stop[]; selectedId: string | null; onSelect: (id: string) => void;
  picking?: boolean; onPick?: (lng: number, lat: number) => void; tour?: boolean; onInteract?: () => void; onOverview?: () => void }
export default function MapView({ stops, selectedId, onSelect, picking, onPick, tour, onInteract, onOverview }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ stops, picking, onPick, onSelect, onInteract, onOverview }); latest.current = { stops, picking, onPick, onSelect, onInteract, onOverview };
  const overview = useRef(true), framed = useRef(false), flatFocus = useRef(false);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [tilted, setTilted] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
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
      instance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
      instance.on('pitchend', e => { const in3D = instance.getPitch() > 1; setTilted(in3D); if ('originalEvent' in e && e.originalEvent) flatFocus.current = !in3D; });
      instance.on('movestart', e => { if ('originalEvent' in e && e.originalEvent) { overview.current = false; latest.current.onInteract?.(); } });
      instance.on('touchstart', () => latest.current.onInteract?.());
      instance.on('mousedown', () => latest.current.onInteract?.());
      instance.on('wheel', () => latest.current.onInteract?.());
      instance.on('load', () => {
        const label = instance.getStyle().layers.find(l => l.type === 'symbol')?.id;
        const sources = instance.getStyle().sources;
        const vectorSource = Object.entries(sources).find(([, s]) => s.type === 'vector')?.[0];
        if (vectorSource) instance.addLayer({ id: 'dayroute-buildings', source: vectorSource, 'source-layer': 'building',
          type: 'fill-extrusion', minzoom: 14, filter: ['!=', ['get', 'hide_3d'], true], paint: {
            'fill-extrusion-color': '#c9d3c3', 'fill-extrusion-opacity': 0.8,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          } }, label);
        instance.addSource('dayroute-path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        instance.addLayer({ id: 'dayroute-path-line', type: 'line', source: 'dayroute-path', paint: {
          'line-color': '#52725a', 'line-width': 3, 'line-dasharray': [2, 2], 'line-opacity': 0.85,
        } });
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
    return () => { clearTimeout(timeout); observer.disconnect(); markers.current.forEach(m => m.remove()); instance.remove(); map.current = null; };
  }, []);
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
      return [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[s.lng, s.lat], [next.lng, next.lat]] } }];
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
  return <div className={`map-shell ${tour ? 'tour-map' : ''}`}>
    <div ref={container} className="map-canvas" aria-label="코스 지도" />
    <div className="map-actions"><button className="map-action" onClick={() => { latest.current.onInteract?.(); latest.current.onOverview?.(); fit(); }} aria-label="전체 코스 보기"><RotateCcw size={16} /> 전체</button>
      <button className="map-action" aria-pressed={tilted} onClick={() => { latest.current.onInteract?.(); overview.current = false; flatFocus.current = tilted; map.current?.easeTo({ pitch: !tilted ? 52 : 0, bearing: map.current.getBearing(), duration: reduced ? 0 : 700 }); }}>
        {tilted ? <Layers3 size={16} /> : <MapIcon size={16} />}{tilted ? '3D' : '2D'}</button><button className="map-action" aria-label="지도 안내" aria-expanded={showInfo} onClick={() => setShowInfo(!showInfo)}><Info size={16} /></button></div>
    {picking && <div className="map-pick-message"><Crosshair size={17} /> 지도를 눌러 장소의 위치를 지정하세요</div>}
    {error && <div className="map-error" role="status">{error}</div>}
    {!ready && !error && <div className="map-loading"><span className="spinner" /> 지도를 펼치고 있어요</div>}
    {showInfo && <div className="map-caption">한 손가락: 이동 · 두 손가락: 확대·축소·회전<br />두 손가락을 함께 위아래로: 기울기<br />점선은 방문 순서예요. 건물은 지도 기반 3D예요.</div>}
  </div>;
}
