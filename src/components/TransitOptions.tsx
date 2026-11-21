import { useState } from 'react';
import {
  sortTransitOptions, transitArrivalTime, transitCategories, transitCategory, transitDepartureTime, transitIdentity, transitSorts,
  originLegId, type TransitCategory, type TransitLegDescriptor, type TransitSort,
} from '../transitCandidates';
import type { TransitLeg } from '../domain';
import type { TransitOption, TransitRouteResult } from '../transport';
import TransitCandidateCard from './TransitCandidateCard';

export default function TransitOptions({ result, leg, routeRegion, saved, previewed, onApply, onPreview }: {
  result: TransitRouteResult;
  leg: TransitLegDescriptor;
  routeRegion?: string;
  saved?: TransitLeg;
  previewed?: TransitLeg | null;
  onApply?: (option: TransitOption) => void;
  onPreview?: (option: TransitOption) => void;
}) {
  const [category, setCategory] = useState<TransitCategory>('all');
  const [sort, setSort] = useState<TransitSort>('recommended');
  const counts: Record<TransitCategory, number> = { all: result.options.length, bus: 0, rail: 0, mixed: 0, walk: 0 };
  const options = result.options.filter(option => {
    const mode = transitCategory(option);
    counts[mode] += 1;
    return category === 'all' || category === mode;
  });
  const fromHere = leg.id === originLegId;
  const departure = fromHere ? transitDepartureTime(result.fetchedAt) : leg.departure;
  const savedIdentity = saved ? transitIdentity(saved) : '';
  const previewIdentity = previewed ? transitIdentity(previewed) : '';

  return <div className="transit-options-panel">
    <div className="candidate-filters" role="group" aria-label="이동수단 필터">
      {(Object.keys(transitCategories) as TransitCategory[]).map(key => (
        <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>
          {transitCategories[key]} <span>{counts[key]}</span>
        </button>
      ))}
    </div>
    <div className="candidate-toolbar">
      <div className="candidate-context">
        {departure && <strong>{fromHere ? '조회 기준' : '일정 출발'} {departure}</strong>}
        <span>{result.source} · 예상 소요시간</span>
      </div>
      <label className="candidate-sort">
        <span>정렬</span>
        <select value={sort} onChange={event => setSort(event.target.value as TransitSort)}>
          {(Object.keys(transitSorts) as TransitSort[]).map(key => <option key={key} value={key}>{transitSorts[key]}</option>)}
        </select>
      </label>
    </div>
    {!options.length && <p className="candidate-empty" role="status">
      {result.options.length ? '이 이동수단의 경로가 없어요.' : '이 구간의 경로를 찾지 못했어요.'}
    </p>}
    <div className="nv-candidate-list">
      {sortTransitOptions(options, sort).map((option, index) => {
        const identity = transitIdentity(option);
        return <TransitCandidateCard key={`${option.id}:${identity}`} option={option} from={leg.from} routeRegion={routeRegion}
          arrival={transitArrivalTime(departure, option.minutes)} recommended={sort === 'recommended' && index === 0}
          applied={savedIdentity === identity} previewed={previewIdentity === identity}
          onPreview={onPreview && result.mapAllowed && option.steps.some(step => (step.coordinates?.length ?? 0) >= 2) ? () => onPreview(option) : undefined}
          onApply={onApply ? () => onApply(option) : undefined} />;
      })}
    </div>
  </div>;
}
