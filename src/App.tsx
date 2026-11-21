import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Check, CheckCheck, Clock3, Copy,
  Heart, LayoutGrid, Link2, MapPin, Plus, Route as RouteIcon, Search, Settings2, Sparkles, Undo2, WifiOff, X, CalendarDays, ExternalLink, FolderHeart } from 'lucide-react';
import { cloneRoute, copyRoute, decodeShare, encodeShare, formatDuration, hasCoordinates, makeRoute, parseLibrary, routeText, totalMinutes, type Route } from './domain';
import { downloadBackup } from './storage';
import { useRouteLibrary } from './useRouteLibrary';
import Modal from './components/Modal';
import RouteEditor from './components/RouteEditor';
import RouteCover from './components/RouteCover';
import MapPreviewCredit from './components/MapPreviewCredit';
import { useRelease } from './useRelease';

function readShared(): { route: Route | null; error: string } {
  const hash = location.hash;
  if (!hash.startsWith('#share=')) return { route: null, error: '' };
  try { return { route: decodeShare(hash.slice(7)), error: '' }; }
  catch { return { route: null, error: '공유 링크를 읽지 못했어요. 코스를 보낸 분에게 다시 받아주세요.' }; }
}
function Brand() { return <span className="brand"><span className="brand-mark"><RouteIcon size={23} strokeWidth={2.2} /></span>dayroute<span className="brand-period">.</span></span>; }
export default function App() {
  const [shared] = useState(readShared);
  const library = useRouteLibrary();
  const { routes } = library;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sharedRoute, setSharedRoute] = useState<Route | null>(shared.route);
  const [section, setSection] = useState<'library' | 'favorites'>('library');
  const [query, setQuery] = useState(''), [region, setRegion] = useState('전체'), [sort, setSort] = useState('updated');
  const [modal, setModal] = useState<'new' | 'settings' | 'share' | null>(null);
  const [newTitle, setNewTitle] = useState(''), [newRegion, setNewRegion] = useState('서울'), [newDate, setNewDate] = useState('');
  const [notice, setNotice] = useState(shared.error), [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [history, setHistory] = useState<Route[][]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const release = useRelease();
  const active = sharedRoute || routes.find(r => r.id === activeId);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const notify = (message: string) => setToast(message);
  const saveStatus = !library.ready ? '보관함 불러오는 중' : library.pending ? '브라우저에 저장하는 중'
    : library.issue ? '저장 확인 필요' : !online ? '오프라인' : library.stored ? '브라우저에 저장됨' : '예시 코스';
  const storageNotice = library.issue || (library.legacyChanged ? '이전 버전의 탭에서 코스가 바뀌었어요. 설정에서 이전 저장본을 백업할 수 있어요.' : '');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const net = () => setOnline(navigator.onLine);
    window.addEventListener('online', net); window.addEventListener('offline', net);
    return () => { window.removeEventListener('online', net); window.removeEventListener('offline', net); };
  }, []);
  const commit = (next: Route[]) => {
    if (next.length > 500) { notify('코스는 최대 500개까지 보관할 수 있어요. 먼저 백업하고 정리해 주세요.'); return false; }
    const previous = library.current();
    if (!library.commit(next)) { notify('저장 상태를 먼저 확인해 주세요. 설정에서 백업·복원할 수 있어요.'); return false; }
    setHistory(h => [...h.slice(-39), previous]);
    return true;
  };
  const undo = async () => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    if (!library.commit(previous)) { notify('되돌린 내용을 저장하지 못했어요.'); return; }
    setHistory(h => h.slice(0, -1));
    if (await library.flush()) notify('이전 상태로 되돌렸어요.');
  };
  useEffect(() => {
    const readLocation = () => {
      const match = /^#route=(.+)$/.exec(location.hash);
      let id: string | null = null;
      try { if (match) id = decodeURIComponent(match[1]); } catch {}
      setActiveId(id);
      const snapshot = readShared(); setSharedRoute(snapshot.route);
      setModal(null); window.scrollTo(0, 0);
    };
    readLocation(); window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);
  const goHome = () => { setActiveId(null); setSharedRoute(null); window.history.pushState(null, '', location.pathname + location.search); window.scrollTo(0, 0); };
  const openRoute = (r: Route) => { setActiveId(r.id); setSharedRoute(null); window.history.pushState(null, '', `#route=${encodeURIComponent(r.id)}`); window.scrollTo(0, 0); };
  const newRoute = () => { setNewTitle(''); setNewDate(''); setNewRegion('서울'); setModal('new'); };
  const duplicate = async (r: Route) => {
    const copy = cloneRoute(r);
    if (!commit([copy, ...library.current()])) return;
    openRoute(copy);
    if (await library.flush()) notify('코스를 복사했어요. 새로운 날짜로 다시 계획해 보세요.');
  };
  const filtered = routes.filter(r => (section !== 'favorites' || r.favorite) && (region === '전체' || (region === '경기' ? r.region.includes('경기') : r.region.includes('서울')))
    && `${r.title} ${r.region} ${r.description} ${r.stops.map(s => s.name).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'ko') : b.updatedAt.localeCompare(a.updatedAt));
  const favoriteCount = routes.filter(r => r.favorite).length;
  const copyText = async (text: string, success: string) => { try { await navigator.clipboard.writeText(text); notify(success); } catch { notify('클립보드에 접근하지 못했어요. 코스 파일로 저장해 주세요.'); } };
  return <div className={`app ${active ? 'editing' : ''}`}>
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <aside className="sidebar">
      <button className="brand-button" onClick={goHome} aria-label="Dayroute 홈"><Brand /></button>
      <nav aria-label="주 메뉴"><button className={!active && section === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => { goHome(); setSection('library'); }}><LayoutGrid size={19} /> 코스 보관함 <span>{routes.length}</span></button>
        <button className={!active && section === 'favorites' ? 'nav-item active' : 'nav-item'} onClick={() => { goHome(); setSection('favorites'); }}><Heart size={19} /> 즐겨찾는 코스 <span>{favoriteCount}</span></button></nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setModal('settings')}><Settings2 size={18} /> 설정과 데이터</button>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-right"><span className="save-status" role="status" aria-label={saveStatus} title={saveStatus}>{!online ? <WifiOff size={16} /> : <CheckCheck size={17} />}</span>
          {history.length > 0 && <button className="icon-button" aria-label="실행 취소" onClick={undo}><Undo2 size={18} /></button>}
          <button className="avatar" aria-label="설정과 데이터 열기" onClick={() => setModal('settings')}>D</button></div>
      </header>
      {(storageNotice || notice) && <div className="notice" role="alert"><span>{storageNotice || notice}</span><button className="text-button" onClick={() => setModal('settings')}>설정 열기</button>{!storageNotice && <button className="icon-button" aria-label="안내 닫기" onClick={() => setNotice('')}><X size={16} /></button>}</div>}
      {release.available && <div className="update-banner"><Sparkles size={17} /><span>새 버전이 준비됐어요. 코스를 저장한 뒤 업데이트할 수 있어요.</span><button className="text-button" onClick={async () => {
        if (!library.ready || !await library.flush()) { notify('먼저 코스를 백업하고 저장 상태를 확인해 주세요.'); return; }
        if (!(await release.apply())) notify('업데이트를 받지 못했어요. 인터넷 연결을 확인해 주세요.');
      }}>저장하고 업데이트</button></div>}
      <main id="main">{!library.ready && !active ? <p className="library-page" role="status">보관함을 불러오는 중이에요.</p> : active ? <RouteEditor key={active.id} route={active} readonly={!!sharedRoute} onBack={goHome}
        onChange={r => commit(library.current().map(x => x.id === r.id ? r : x))} onShare={() => setModal('share')} onDuplicate={() => void duplicate(active)}
        onDelete={async () => {
          if (!commit(library.current().filter(r => r.id !== active.id))) return;
          goHome();
          if (await library.flush()) notify('코스를 삭제했어요. 실행 취소로 복구할 수 있어요.');
        }}
        onSaveCopy={async () => {
          const copy = copyRoute(active);
          if (!commit([copy, ...library.current()])) return;
          openRoute(copy);
          if (await library.flush()) notify('내 보관함에 저장했어요.');
        }} /> : <div className="library-page">
        <div className="page-heading"><h1>{section === 'favorites' ? '즐겨찾기' : '코스 보관함'}<span className="heading-count">{filtered.length}</span></h1><button className="primary" onClick={newRoute} aria-label="새 코스 만들기"><Plus size={18} /> 새 코스</button></div>
        <section className="collection" aria-label="저장한 코스">
          <div className="collection-heading"><select className="sort-select" aria-label="코스 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">최근 수정순</option><option value="title">이름순</option></select></div>
          <div className="collection-filters"><div className="filter-tabs" role="group" aria-label="지역 필터">{['전체', '서울', '경기'].map(r => <button key={r} className={region === r ? 'selected' : ''} aria-pressed={region === r} onClick={() => setRegion(r)}>{r}</button>)}</div><div className="search-field library-search"><Search size={17} /><input aria-label="코스 검색" placeholder="코스, 장소로 검색" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="검색 지우기" onClick={() => setQuery('')}><X size={14} /></button>}</div></div>
          <div className="route-grid">{filtered.map(route => <article className="route-card" key={route.id}>
            <div className="card-cover"><button className="card-image-button" onClick={() => openRoute(route)} aria-label={`${route.title} 열기`}><RouteCover route={route} /></button><span className="region-badge"><MapPin size={12} />{route.region || '지역 미정'}</span><button className={`favorite-button ${route.favorite ? 'is-favorite' : ''}`} aria-label={`${route.title} 즐겨찾기 ${route.favorite ? '해제' : '추가'}`} aria-pressed={route.favorite} onClick={() => commit(routes.map(r => r.id === route.id ? { ...r, favorite: !r.favorite, updatedAt: new Date().toISOString() } : r))}><Heart size={18} fill={route.favorite ? 'currentColor' : 'none'} /></button>{!route.coverPhoto && route.stops.some(hasCoordinates) && <MapPreviewCredit />}</div>
            <div className="card-body"><button className="card-title" onClick={() => openRoute(route)}>{route.title}</button><div className="card-bottom"><div className="card-stats"><span><MapPin size={13} /> {route.stops.length}곳</span><span><Clock3 size={13} /> {formatDuration(totalMinutes(route))}</span>{route.date && <span><CalendarDays size={13} />{route.date.slice(5).replace('-', '.')}</span>}</div><button className="icon-button" aria-label={`${route.title} 복제`} title="코스 복제" onClick={() => duplicate(route)}><Copy size={15} /></button></div></div>
          </article>)}</div>
          {!filtered.length && <div className="empty-library"><FolderHeart size={28} /><h3>{query || region !== '전체' ? '검색 결과가 없어요' : section === 'favorites' ? '즐겨찾는 코스가 없어요' : '저장한 코스가 없어요'}</h3></div>}
        </section>
      </div>}</main>
    </div>
    {modal === 'new' && <Modal title="새 코스" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); const route = { ...makeRoute(), title: newTitle.trim() || '새로운 하루', region: newRegion, date: newDate }; if (commit([route, ...routes])) { setModal(null); openRoute(route); } }}>
      <div className="form-grid"><label className="span-2">코스 이름<input autoFocus required maxLength={100} value={newTitle} placeholder="예: 느긋하게 보내는 토요일" onChange={e => setNewTitle(e.target.value)} /></label><label>지역<select value={newRegion} onChange={e => setNewRegion(e.target.value)}><option>서울</option><option>경기</option><option>기타</option></select></label><label>날짜 · 선택<input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></label></div><div className="modal-footer"><button type="button" className="secondary" onClick={() => setModal(null)}>취소</button><button className="primary" type="submit">코스 만들기 <ArrowRight size={16} /></button></div></form></Modal>}
    {modal === 'settings' && <Modal title="설정과 데이터" onClose={() => setModal(null)}>
      <div className="settings-section"><h3>데이터</h3><p>이 브라우저에 저장돼요. 기기를 바꾸거나 데이터를 지우기 전에 백업하세요.</p><div className="button-row"><button className="secondary" disabled={!library.ready} onClick={() => downloadBackup(library.current())}><ArrowDownToLine size={17} /> 전체 백업</button><button className="secondary" disabled={!library.ready || library.pending} onClick={() => importInput.current?.click()}><ArrowUpFromLine size={17} /> 파일 가져오기</button></div>
        {(library.conflict || (library.dirty && !library.pending)) && <button className="text-button" onClick={() => { downloadBackup(library.current()); library.discardDraft(); location.reload(); }}>이 탭을 백업하고 최신 보관함 불러오기</button>}
        {library.stored && <button className="text-button" onClick={() => notify(library.backupLegacy())}>이전 버전 저장본 백업</button>}
      </div>
      <div className="settings-section"><h3>앱처럼 사용하기</h3><p>휴대폰 브라우저 메뉴에서 ‘홈 화면에 추가’를 선택하세요. 실행하거나 화면으로 돌아왔을 때 새 버전을 확인해요. 지도는 인터넷 연결이 필요해요.</p><span className="version-label">v{__APP_RELEASE__.version} · {import.meta.env.DEV ? '개발 미리보기' : '웹앱'} · {online ? '온라인' : '오프라인'}{release.offlineReady ? ' · 앱 화면 오프라인 준비 완료' : ''}</span><button className="text-button" onClick={() => void release.check()}>새 버전 확인</button><span className="version-label" role="status">{release.lastCheck}</span></div>
      <div className="settings-section"><h3>지도와 장소 정보</h3><p>무료 지도: MapLibre · OpenFreeMap · OpenStreetMap. 지도 화면을 열 때 표시 영역이 지도 제공자에게 요청돼요. 실사 3D·실시간 영업시간·도로 경로 자동 계산은 아직 연결하지 않았어요. 기본 장소 위치는 예시이므로 방문 전에 원문 지도를 확인해 주세요.</p><a href="https://openfreemap.org/" target="_blank" rel="noreferrer" className="inline-link">지도 제공 안내 <ExternalLink size={13} /></a></div>
      <div className="settings-section last"><h3>코스 커버</h3><p>기본은 장소 좌표로 그린 동선이에요. 직접 추가한 사진은 크기를 줄여 이 브라우저에만 저장하고, 코스 파일 백업에도 포함해요.</p></div>
    </Modal>}
    {modal === 'share' && active && <Modal title="코스 공유" onClose={() => setModal(null)}><p className="modal-description">지금 코스의 사본을 공유해요. 이후 수정 사항은 이미 보낸 링크에 반영되지 않아요.</p>
      {isLocal && <div className="share-note"><Link2 size={19} /><span>지금은 내 컴퓨터에서 실행 중이에요.<br />다른 기기에 보내려면 코스 파일이나 일정 텍스트를 이용하세요. 웹 배포 후 링크 공유가 가능해요.</span></div>}
      <div className="share-preview"><RouteCover route={active} decorative /><div><strong>{active.title}</strong><span>{active.region} · {active.stops.length}곳 · 일정 {formatDuration(totalMinutes(active))}</span></div></div>
      <div className="share-buttons"><button className="secondary" onClick={() => void copyText(routeText(active), '일정을 복사했어요. 원하는 곳에 붙여넣어 주세요.')}><Copy size={17} /> 일정 텍스트 복사</button><button className="secondary" onClick={() => downloadBackup([active])}><ArrowDownToLine size={17} /> 이 코스 파일 저장</button>
        {!isLocal && <button className="primary" onClick={() => { const encoded = encodeShare(active); if (encoded.length > 12000) { notify('코스가 길어서 링크 대신 파일로 공유해 주세요.'); return; } void copyText(`${location.origin}/#share=${encoded}`, '보기 전용 링크를 복사했어요. 링크를 가진 사람이 코스를 볼 수 있어요.'); }}><Link2 size={17} /> 보기 전용 링크 복사</button>}</div><p className="fine-print">메모·일정·위치가 포함돼요. 사진은 파일로 공유할 때만 포함돼요.</p>
    </Modal>}
    <input ref={importInput} hidden type="file" accept=".json,application/json" aria-label="백업 파일 가져오기" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      try { if (file.size > 5_000_000) throw new Error('파일은 5MB 이하여야 해요.'); const backup = parseLibrary(await file.text());
        const imported = backup.routes.map(copyRoute);
        const restored = await library.restore(imported);
        setHistory(h => [...(restored.sourceChanged ? [] : h.slice(-39)), restored.previous]);
        setNotice('');
        notify(`${imported.length}개 코스를 가져왔어요. 기존 코스도 그대로 보관돼요.`);
      } catch (err) { notify(err instanceof Error ? err.message : '파일을 가져오지 못했어요.'); }
    }} />
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button aria-label="알림 닫기" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
