import { useId, useState } from 'react';
import { BusFront, Check, ChevronDown, Footprints, MapPin, TrainFront } from 'lucide-react';
import type { Stop } from '../domain';
import type { TransitOption } from '../transport';
import TransitArrivals from './TransitArrivals';

const modes = { walk: '도보', bus: '버스', subway: '지하철', train: '열차' };
const modeIcons = { walk: Footprints, bus: BusFront, subway: TrainFront, train: TrainFront };

export default function TransitCandidateCard({ option, from, routeRegion, arrival, recommended, applied, previewed, onApply, onPreview }: {
  option: TransitOption;
  from: Stop;
  routeRegion?: string;
  arrival?: string;
  recommended: boolean;
  applied: boolean;
  previewed: boolean;
  onApply?: () => void;
  onPreview?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const transitSteps = option.steps.filter(step => step.mode !== 'walk');

  return <article className={`nv-candidate-card ${previewed ? 'selected' : ''}`}>
    <div className="nv-card-head">
      <div className="nv-head-left">
        <div className="candidate-badges">
          {recommended && <span className="candidate-badge">추천 경로</span>}
          {applied && <span className="candidate-applied"><Check size={12} aria-hidden="true" /> 일정에 적용됨</span>}
        </div>
        <div className="nv-time-row">
          <strong className="nv-total-min">{option.minutes}<span>분</span></strong>
          {arrival && <span className="nv-arrival-clock">{arrival} 도착 예상</span>}
          {option.fare !== undefined && <span className="nv-fare">{option.fare === 0 ? '무료' : `${option.fare.toLocaleString('ko-KR')}원`}</span>}
        </div>
      </div>
      {onPreview && <button type="button" className="secondary small nv-select-btn" aria-pressed={previewed} onClick={onPreview}>
        <MapPin size={13} aria-hidden="true" /> {previewed ? '지도에 표시 중' : '지도에서 보기'}
      </button>}
    </div>
    <div className="nv-progress-bar" aria-hidden="true">
      {option.steps.map((step, index) => {
        const Icon = modeIcons[step.mode];
        return <div key={index} className={`nv-bar-seg mode-${step.mode}`} style={{ flexGrow: Math.max(0.5, step.minutes) }}
          title={`${modes[step.mode]} ${step.minutes}분`}>
          <Icon size={12} /><span>{step.minutes}분</span>
        </div>;
      })}
    </div>
    {transitSteps.length ? <ol className="candidate-boarding" aria-label="승차 및 하차 지점">
      {transitSteps.map((step, index) => <li key={index}>
        <span className={`candidate-line mode-${step.mode}`}>{step.route || modes[step.mode]}</span>
        <div className="candidate-stations">
          <p><strong>{step.from || '승차 지점'}</strong><span aria-hidden="true"> → </span>{step.to || '하차 지점'}</p>
          <TransitArrivals step={step} from={from} routeRegion={routeRegion} />
        </div>
      </li>)}
    </ol> : <p className="nv-walk-only-desc">
      출발지에서 목적지까지 도보로 이동
      {option.steps.length === 1 && option.steps[0].meters !== undefined ? ` · ${option.steps[0].meters.toLocaleString('ko-KR')}m` : ''}
    </p>}
    <div className="nv-card-foot">
      <span className="nv-foot-meta">도보 {option.walkMinutes}분 · {option.transfers ? `환승 ${option.transfers}회` : '환승 없음'}</span>
      <button type="button" className="nv-detail-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>
        경로 상세 <ChevronDown size={13} aria-hidden="true" />
      </button>
      {onApply && !applied && <button type="button" className="primary small nv-select-btn" onClick={onApply}>일정에 적용</button>}
    </div>
    <ol id={detailId} className="nv-expanded-steps" hidden={!expanded}>
      {option.steps.map((step, index) => <li key={index}>
        <strong>{modes[step.mode]}{step.route ? ` ${step.route}` : ''}</strong>
        <span>{step.from || '출발'} → {step.to || '도착'} · {step.minutes}분{step.stops ? ` · ${step.stops}정거장` : step.meters ? ` · ${step.meters}m` : ''}</span>
      </li>)}
    </ol>
  </article>;
}
