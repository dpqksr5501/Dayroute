import { useRef, useState } from 'react';
import { Search, MapPin, Plus, ArrowUpRight, Globe } from 'lucide-react';
import Modal from './Modal';
import { places } from '../data';
import { makeStop, type Stop } from '../domain';
import { poiParams, transportRequest, type PoiItem } from '../transport';

export default function PlacePicker({ onAdd, onClose }: { onAdd: (s: Stop) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<PoiItem[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const trimmed = query.trim();
  const found = places.filter(p => `${p.name} ${p.address}`.includes(trimmed));

  const searchRemote = async () => {
    if (trimmed.length < 2 || busy) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const items = await transportRequest<PoiItem[]>(poiParams(trimmed), controller.signal, 1800000);
      if (!controller.signal.aborted) {
        setRemote(items);
        if (!items.length) setError('검색된 장소가 없어요. 다른 키워드로 찾거나 직접 추가해 보세요.');
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '실시간 장소 검색을 하지 못했어요.');
    } finally {
      if (request.current === controller) setBusy(false);
    }
  };

  return <Modal title="장소 추가" onClose={() => { request.current?.abort(); onClose(); }}>
    <form className="search-field" onSubmit={e => { e.preventDefault(); void searchRemote(); }}>
      <Search size={19} />
      <input autoFocus placeholder="서울숲, 행궁동, 성수 카페…" value={query} onChange={e => { setQuery(e.target.value); setError(''); }} aria-label="장소 검색" />
      {trimmed.length >= 2 && <button type="submit" className="text-button" disabled={busy}>{busy ? '검색 중' : '실시간 검색'}</button>}
    </form>
    {error && <p className="transport-error" role="status">{error}</p>}
    {remote.length > 0 && <>
      <div className="picker-heading"><span>실시간 장소 검색</span><small>TMAP POI · 좌표 자동 지정</small></div>
      <div className="place-results">
        {remote.map(p => <button className="place-result" key={p.id} onClick={() => onAdd(makeStop({ name: p.name, address: p.address, category: p.category, lng: p.lng, lat: p.lat }))}>
          <span className={`category-icon cat-${p.category}`}><Globe size={18} /></span>
          <span><strong>{p.name}</strong><small>{p.category} · {p.address}</small></span>
          <Plus size={18} />
        </button>)}
      </div>
    </>}
    <div className="picker-heading"><span>기본 장소</span><small>서울·경기 · 저장 목록</small></div>
    <div className="place-results">{found.length ? found.map(p => <button className="place-result" key={p.name} onClick={() => onAdd(makeStop(p))}>
      <span className={`category-icon cat-${p.category}`}><MapPin size={20} /></span><span><strong>{p.name}</strong><small>{p.address}</small></span><Plus size={18} />
    </button>) : <div className="empty-small">기본 목록에 일치하는 장소 없음</div>}</div>
    <button className="manual-place" onClick={() => onAdd(makeStop({ name: trimmed.slice(0, 100) }))}><Plus size={18} /><span>직접 추가</span><ArrowUpRight size={18} /></button>
  </Modal>;
}
