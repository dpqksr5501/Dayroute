import { hasCoordinates, type Stop, type Theme } from './domain.ts';
export type Coordinate = [number, number];
export interface PreviewPlan {
  pins: { coordinate: Coordinate; number: number }[];
  segments: [Coordinate, Coordinate][];
  bounds: [Coordinate, Coordinate] | null;
}
export function mapPreviewPlan(stops: Stop[]): PreviewPlan {
  const pins = stops.flatMap((s, i) => hasCoordinates(s) ? [{ coordinate: [s.lng, s.lat] as Coordinate, number: i + 1 }] : []);
  const segments: PreviewPlan['segments'] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (hasCoordinates(a) && hasCoordinates(b)) segments.push([[a.lng, a.lat], [b.lng, b.lat]]);
  }
  return { pins, segments, bounds: pins.length ? [
    [Math.min(...pins.map(p => p.coordinate[0])), Math.min(...pins.map(p => p.coordinate[1]))],
    [Math.max(...pins.map(p => p.coordinate[0])), Math.max(...pins.map(p => p.coordinate[1]))],
  ] : null };
}
export function previewKey(stops: Stop[], theme: Theme): string {
  return `positron-v1:${theme}:${JSON.stringify(stops.map(s => hasCoordinates(s) ? [s.lng, s.lat] : null))}`;
}
