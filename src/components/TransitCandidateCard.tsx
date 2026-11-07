import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { TransitOption } from '../transport';

function formatArrivalClock(minutesFromNow: number): string {
  const target = new Date(Date.now() + minutesFromNow * 60000);
  const h = target.getHours(), m = String(target.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${m} 도착`;
}

export default function TransitCandidateCard({
  option,
  index,
  selected = false,
  actionLabel,
  onSelect,
  onOpenArrivals,
}: {
  option: TransitOption;
  index: number;
  selected?: boolean;
  actionLabel?: string;
  onSelect?: () => void;
  onOpenArrivals?: (stationId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const transitSteps = option.steps.filter(s => s.mode !== 'walk');
  const lastTransit = transitSteps[transitSteps.length - 1];
  const alightStop = lastTransit?.to || option.steps[option.steps.length - 1]?.from || '도착 정류소';
  const totalStepMins = Math.max(1, option.steps.reduce((acc, s) => acc + Math.max(1, s.minutes), 0));

  return (
    <article className={`nv-candidate-card ${selected ? 'selected' : ''}`}>
      <div className="nv-card-head">
        <div className="nv-head-left">
          {index === 0 && <span className="nv-optimal-badge">최적</span>}
          <div className="nv-time-row">
            <strong className="nv-total-min">{option.minutes}<span>분</span></strong>
            <span className="nv-divider">|</span>
            <span className="nv-arrival-clock">{formatArrivalClock(option.minutes)}</span>
            {option.fare !== undefined && (
              <>
                <span className="nv-divider">|</span>
                <span className="nv-fare">{option.fare > 0 ? `${option.fare.toLocaleString('ko-KR')}원` : '무료'}</span>
              </>
            )}
          </div>
        </div>
        {onSelect && (
          <button
            type="button"
            className={selected ? 'secondary small nv-select-btn active' : 'primary small nv-select-btn'}
            onClick={onSelect}
          >
            {selected ? <><Check size={13} /> {actionLabel || '적용됨'}</> : (actionLabel || '이 경로 선택')}
          </button>
        )}
      </div>

      {/* Naver Map-style Proportional Horizontal Progress Bar */}
      <div className="nv-progress-bar" aria-label="구간별 이동 시간 비율">
        {option.steps.map((s, idx) => {
          const flex = Math.max(1.2, (s.minutes / totalStepMins) * 10);
          const icon = s.mode === 'walk' ? '🚶' : s.mode === 'subway' ? '🚇' : '🚌';
          return (
            <div
              key={`${option.id}:bar:${idx}`}
              className={`nv-bar-seg mode-${s.mode}`}
              style={{ flex }}
              title={`${s.route || (s.mode === 'walk' ? '도보' : '이동')} ${s.minutes}분`}
            >
              {idx === 0 || s.mode !== 'walk' ? <span className="nv-bar-icon">{icon}</span> : null}
              <span className="nv-bar-min">{s.minutes}분</span>
            </div>
          );
        })}
      </div>

      {/* Vertical Boarding / Transfer / Alighting Timeline */}
      {transitSteps.length > 0 ? (
        <div className="nv-timeline">
          {transitSteps.map((s, idx) => {
            const isFirst = idx === 0;
            const badgeText = s.mode === 'subway'
              ? (s.busType || s.route || '지하철')
              : (s.busType || '일반');
            const stationTitle = s.from || (isFirst ? '출발 정류소' : '환승 정류소');

            return (
              <div key={`${option.id}:step:${idx}`} className={`nv-tl-item mode-${s.mode}`}>
                <div className="nv-tl-left">
                  <span className={`nv-type-badge mode-${s.mode}`}>
                    {s.mode === 'subway' ? '🚇' : '🚌'} {badgeText}
                  </span>
                </div>
                <div className="nv-tl-body">
                  <div className="nv-tl-title-row">
                    <strong className="nv-station-name">{stationTitle}</strong>
                    {isFirst && onOpenArrivals && (
                      <button
                        type="button"
                        className="nv-arrival-btn"
                        onClick={() => onOpenArrivals(s.stationId)}
                      >
                        도착정보
                      </button>
                    )}
                  </div>

                  {/* Primary & Secondary Live Bus Arrival Rows or Route Box Badges */}
                  {isFirst && s.live ? (
                    <div className="nv-live-rows">
                      <div className="nv-live-line">
                        <span className="nv-bus-num">{s.mode === 'subway' ? '🚇' : '🚌'} <strong>{s.route}</strong></span>
                        <span className="nv-live-eta">{s.live}</span>
                        {s.stopsAway && <span className="nv-live-stops">{s.stopsAway}정류장</span>}
                        <span className="nv-seat-badge">여유</span>
                      </div>
                      {s.live2 && (
                        <div className="nv-live-line">
                          <span className="nv-bus-num">{s.mode === 'subway' ? '🚇' : '🚌'} <strong>{s.route}</strong></span>
                          <span className="nv-live-eta">{s.live2}</span>
                          {s.stopsAway2 && <span className="nv-live-stops">{s.stopsAway2}정류장</span>}
                          <span className="nv-seat-badge">여유</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="nv-route-chips">
                      {s.route && <span className={`nv-route-box mode-${s.mode}`}>{s.route}</span>}
                      {s.altRoutes && s.altRoutes.map(alt => (
                        <span key={alt} className={`nv-route-box mode-${s.mode}`}>{alt}</span>
                      ))}
                      {s.altRoutes && s.altRoutes.length > 0 && (
                        <span className="nv-route-count">포함 {1 + s.altRoutes.length}대</span>
                      )}
                      {s.live && <span className="nv-live-eta">{s.live}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Final Alighting Row */}
          <div className="nv-tl-item nv-tl-alight">
            <div className="nv-tl-left">
              <span className="nv-alight-label"><i className="nv-alight-dot" /> 하차</span>
            </div>
            <div className="nv-tl-body">
              <strong className="nv-station-name">{alightStop}</strong>
            </div>
          </div>
        </div>
      ) : (
        <p className="nv-walk-only-desc">🚶 출발지에서 목적지까지 도보 직통 이동 ({option.walkMinutes}분)</p>
      )}

      <div className="nv-card-foot">
        <button type="button" className="nv-detail-toggle" onClick={() => setExpanded(!expanded)}>
          상세보기 <ChevronRight size={13} className={expanded ? 'rotate-90' : ''} />
        </button>
        <span className="nv-foot-meta">도보 총 {option.walkMinutes}분 · 환승 {option.transfers}회</span>
      </div>

      {expanded && (
        <ol className="nv-expanded-steps">
          {option.steps.map((s, sIdx) => (
            <li key={`${option.id}:exp:${sIdx}`}>
              <strong>{s.mode === 'walk' ? '🚶 도보' : s.mode === 'subway' ? `🚇 ${s.route}` : `🚌 ${s.route}`}</strong>
              <span>{s.from || '출발'} → {s.to || '도착'} ({s.minutes}분{s.stops ? ` · ${s.stops}정류장` : s.meters ? ` · ${s.meters}m` : ''})</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
