import { hasCoordinates, type Stop } from './domain.ts';

export interface SketchPoint { x: number; y: number; indices: number[] }
export interface RouteSketch { points: SketchPoint[]; segments: [SketchPoint, SketchPoint][]; located: number }

/** A proportional diagram of real coordinates, not a road route or a background map. */
export function routeSketch(stops: Stop[]): RouteSketch {
  const located = stops.filter(hasCoordinates);
  if (!located.length) return { points: [], segments: [], located: 0 };
  const project = (lng: number, lat: number) => ({ x: lng * Math.PI / 180,
    y: -Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360)) });
  const raw = located.map(s => project(s.lng, s.lat));
  const minX = Math.min(...raw.map(p => p.x)), maxX = Math.max(...raw.map(p => p.x));
  const minY = Math.min(...raw.map(p => p.y)), maxY = Math.max(...raw.map(p => p.y));
  const spanX = maxX - minX, spanY = maxY - minY;
  const scale = Math.min(spanX > 1e-10 ? 320 / spanX : Infinity, spanY > 1e-10 ? 134 / spanY : Infinity);
  const points: SketchPoint[] = [], indexed = new Map<string, SketchPoint>();
  stops.forEach((stop, i) => {
    if (!hasCoordinates(stop)) return;
    const p = project(stop.lng, stop.lat);
    const x = Number.isFinite(scale) ? 240 + (p.x - (minX + maxX) / 2) * scale : 240;
    const y = Number.isFinite(scale) ? 120 + (p.y - (minY + maxY) / 2) * scale : 120;
    // Coincident/revisited places share a numbered pin rather than obscuring each other.
    let point = points.find(v => Math.hypot(v.x - x, v.y - y) < 27);
    if (point) point.indices.push(i + 1);
    else { point = { x, y, indices: [i + 1] }; points.push(point); }
    indexed.set(stop.id, point);
  });
  const segments: RouteSketch['segments'] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = indexed.get(stops[i - 1].id), b = indexed.get(stops[i].id);
    if (a && b && a !== b) segments.push([a, b]);
  }
  return { points, segments, located: located.length };
}
