import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, CloudOff } from 'lucide-react';
import type { Route } from '../domain';
import { routeSketch } from '../routeSketch';
import { previewKey } from '../mapPreviewPlan';

export default function RouteCover({ route, decorative = false }: { route: Route; decorative?: boolean }) {
  const sketch = useMemo(() => routeSketch(route.stops), [route.stops]);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<{ key: string; image: string; error: boolean }>({ key: '', image: '', error: false });
  const key = previewKey(route.stops, route.theme), enabled = !route.coverPhoto && !decorative && sketch.located > 0;
  const image = preview.key === key ? preview.image : '';
  useEffect(() => {
    if (!enabled || !root.current) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: '150px' });
    observer.observe(root.current); return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !visible) { setPreview(previous => previous.image || previous.error ? { key: '', image: '', error: false } : previous); return; }
    const controller = new AbortController();
    void import('../mapThumbnails').then(m => m.requestMapThumbnail(route.stops, route.theme, controller.signal)).then(image => {
      if (!controller.signal.aborted) setPreview({ key, image, error: false });
    }).catch(() => { if (!controller.signal.aborted) setPreview({ key, image: '', error: true }); });
    return () => controller.abort();
  }, [key, enabled, visible, retry]);
  useEffect(() => {
    if (!preview.error) return;
    const again = () => { if (document.visibilityState === 'visible' && navigator.onLine) setRetry(v => v + 1); };
    window.addEventListener('online', again); document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('online', again); document.removeEventListener('visibilitychange', again); };
  }, [preview.error]);
  return <div ref={root} className={`route-cover tone-${route.theme} ${route.coverPhoto ? 'has-photo' : image ? 'has-map-preview' : ''}`}>
    {route.coverPhoto ? <img src={route.coverPhoto} alt={decorative ? '' : `${route.title} 커버 사진`} loading="lazy" /> : <>
      {image ? <img className="static-map-preview" src={image} alt={`${route.title} 전체 지도 미리보기`} decoding="async" /> : <>
      <svg className="route-sketch" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid meet" role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : `동선 미리보기 · 위치 지정 ${sketch.located}곳`} aria-hidden={decorative || undefined}>
        <g className="sketch-context" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0 80H480M0 160H480M120 0V240M240 0V240M360 0V240" opacity=".06" />
          <rect x="29" y="26" width="65" height="35" rx="8" transform="rotate(-8 60 44)" opacity=".09" />
          <rect x="383" y="167" width="64" height="49" rx="10" transform="rotate(13 415 190)" opacity=".09" />
          <path d="M0 216C70 190 89 229 147 222S233 191 289 213 389 236 480 201" strokeWidth="25" opacity=".045" />
        </g>
        <g className="sketch-paths" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" strokeDasharray="5 6">
          {sketch.segments.map(([a, b], i) => <path key={i} d={`M${a.x},${a.y} L${b.x},${b.y}`} />)}
        </g>
        {sketch.points.map((p, i) => <g key={i} transform={`translate(${p.x},${p.y})`} className={i === 0 ? 'sketch-pin first' : 'sketch-pin'}>
          <circle className="pin-halo" r="23" /><circle className="pin-body" r="16" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={p.indices.length > 2 ? 9 : 12} fontWeight="650">
            {p.indices.length > 2 ? `${p.indices[0]}+${p.indices.length - 1}` : p.indices.join('·')}
          </text>
        </g>)}
      </svg>
      {!sketch.located && <span className="sketch-empty" aria-hidden="true"><MapPin size={27} strokeWidth={1.4} /></span>}
      {enabled && visible && !preview.error && <span className="thumbnail-loading" aria-label="지도 미리보기 불러오는 중"><span className="spinner" /></span>}
      {enabled && preview.key === key && preview.error && <span className="thumbnail-fallback" role="img" aria-label="지도 연결 실패 · 동선 그림 표시" title="지도를 불러오지 못해 동선 그림을 표시해요"><CloudOff size={15} /></span>}
      </>}
    </>}
  </div>;
}
