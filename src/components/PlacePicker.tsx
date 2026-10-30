import { useState } from 'react';
import { Search, MapPin, Plus, ArrowUpRight } from 'lucide-react';
import Modal from './Modal';
import { places } from '../data';
import { makeStop, type Stop } from '../domain';
export default function PlacePicker({ onAdd, onClose }: { onAdd: (s: Stop) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const found = places.filter(p => `${p.name} ${p.address}`.includes(query.trim()));
  return <Modal title="장소 추가" onClose={onClose}>
    <div className="search-field"><Search size={19} /><input autoFocus placeholder="서울숲, 행궁동, 양평…" value={query} onChange={e => setQuery(e.target.value)} aria-label="기본 장소 검색" /></div>
    <div className="picker-heading"><span>기본 장소</span><small>서울·경기 · 저장 목록</small></div>
    <div className="place-results">{found.length ? found.map(p => <button className="place-result" key={p.name} onClick={() => onAdd(makeStop(p))}>
      <span className={`category-icon cat-${p.category}`}><MapPin size={20} /></span><span><strong>{p.name}</strong><small>{p.address}</small></span><Plus size={18} />
    </button>) : <div className="empty-small">검색 결과 없음</div>}</div>
    <button className="manual-place" onClick={() => onAdd(makeStop({ name: query.trim().slice(0, 100) }))}><Plus size={18} /><span>직접 추가</span><ArrowUpRight size={18} /></button>
  </Modal>;
}
