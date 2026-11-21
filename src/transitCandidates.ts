import { hasCoordinates, makeStop, transitFor, walkingFor, walkingKey, type Stop, type TransitLeg } from './domain.ts';
import type { TransitOption } from './transport.ts';

export interface TransitLegDescriptor {
  id: string;
  label: string;
  from: Stop;
  to: Stop;
  departure?: string;
}

export const originLegId = 'user-origin';

export function transitLegs(stops: Stop[], location?: { lng: number; lat: number; address?: string } | null, departures?: string[]): TransitLegDescriptor[] {
  const legs: TransitLegDescriptor[] = [];
  const first = stops[0];
  if (location && first && hasCoordinates(first)) {
    legs.push({
      id: originLegId,
      label: `내 위치 → 1. ${first.name || '첫 장소'}`,
      from: makeStop({ id: originLegId, name: location.address || '내 위치', lng: location.lng, lat: location.lat, mode: 'transit' }),
      to: first,
    });
  }
  stops.forEach((from, index) => {
    const to = stops[index + 1];
    if (!to || !hasCoordinates(from) || !hasCoordinates(to)) return;
    legs.push({
      id: from.id, from, to, departure: departures?.[index],
      label: `${index + 1}. ${from.name || '장소'} → ${index + 2}. ${to.name || '장소'}`,
    });
  });
  return legs;
}

export const transitCategories = {
  all: '전체',
  bus: '버스',
  rail: '지하철·열차',
  mixed: '버스 + 철도',
  walk: '도보',
};
export type TransitCategory = keyof typeof transitCategories;

export function transitCategory(option: TransitLeg): Exclude<TransitCategory, 'all'> {
  const bus = option.steps.some(step => step.mode === 'bus');
  const rail = option.steps.some(step => step.mode === 'subway' || step.mode === 'train');
  if (bus && rail) return 'mixed';
  if (bus) return 'bus';
  return rail ? 'rail' : 'walk';
}

export const transitSorts = {
  recommended: '추천순',
  duration: '최소 시간순',
  transfers: '최소 환승순',
  walking: '최소 도보순',
  fare: '낮은 요금순',
};
export type TransitSort = keyof typeof transitSorts;

export function sortTransitOptions(options: TransitOption[], sort: TransitSort): TransitOption[] {
  if (sort === 'recommended') return options;
  const score = (option: TransitOption) => {
    switch (sort) {
      case 'duration': return option.minutes;
      case 'transfers': return option.transfers;
      case 'walking': return option.walkMinutes;
      case 'fare': return option.fare ?? Number.POSITIVE_INFINITY;
    }
  };
  return [...options].sort((a, b) => (score(a) - score(b)) || a.minutes - b.minutes || a.transfers - b.transfers);
}

export function transitIdentity(leg: TransitLeg): string {
  return JSON.stringify([leg.key, leg.provider, leg.minutes, leg.steps.map(step =>
    [step.mode, step.route, step.from, step.to, step.stationId, step.minutes])]);
}

export function savedTransitOption({ id: _id, ...leg }: TransitOption): TransitLeg {
  return leg;
}

export function appliedTransitFor(from: Stop, to: Stop): TransitLeg | undefined {
  const leg = from.transit;
  if (from.mode === 'walk' && leg?.provider && leg.key === walkingKey(from, to)
    && leg.minutes === from.travelMinutes && !walkingFor(from, to) && transitCategory(leg) === 'walk') return leg;
  return transitFor(from, to);
}

export function transitOptionPatch(leg: TransitLeg): Partial<Stop> {
  return transitCategory(leg) === 'walk'
    ? { mode: 'walk', transit: leg, walking: undefined, travelMinutes: leg.minutes }
    : { mode: 'transit', transit: leg, travelMinutes: leg.minutes };
}

const seoulClock = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function transitDepartureTime(fetchedAt: string): string | undefined {
  const date = new Date(fetchedAt);
  return Number.isFinite(date.getTime()) ? seoulClock.format(date) : undefined;
}

export function transitArrivalTime(departure: string | undefined, minutes: number): string | undefined {
  const parts = /^(?:\+(\d+)일 )?(\d{2}):(\d{2})$/.exec(departure ?? '');
  if (!parts) return undefined;
  const total = Number(parts[1] ?? 0) * 1440 + Number(parts[2]) * 60 + Number(parts[3]) + minutes;
  const days = Math.floor(total / 1440);
  const hour = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const minute = String(total % 60).padStart(2, '0');
  return `${days ? `+${days}일 ` : ''}${hour}:${minute}`;
}
