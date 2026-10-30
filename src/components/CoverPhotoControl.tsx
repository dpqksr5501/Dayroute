import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { prepareCoverPhoto } from '../coverPhoto';

export default function CoverPhotoControl({ hasPhoto, onChange }: { hasPhoto: boolean; onChange: (photo: string | undefined) => boolean }) {
  const input = useRef<HTMLInputElement>(null), mounted = useRef(true), callback = useRef(onChange); callback.current = onChange;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <>
    <div className="cover-edit-controls">
      <button className="cover-photo-button" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} />{busy ? '처리 중…' : hasPhoto ? '사진 변경' : '사진 추가'}</button>
      {hasPhoto && <button className="cover-photo-button remove-photo" disabled={busy} aria-label="사진 삭제하고 동선으로" title="동선으로 돌아가기" onClick={() => { setError(''); callback.current(undefined); }}><X size={16} /></button>}
    </div>
    {error && <span className="cover-photo-error" role="alert">{error}</span>}
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="커버 사진 선택" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      setBusy(true); setError('');
      try {
        const photo = await prepareCoverPhoto(file);
        if (mounted.current && !callback.current(photo)) setError('사진을 저장하지 못했어요. 저장 공간을 확인해 주세요.');
      } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '사진을 읽지 못했어요.'); }
      finally { if (mounted.current) setBusy(false); }
    }} />
  </>;
}
