import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>('[autofocus], input:not([type="hidden"]), textarea')?.focus();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); closeRef.current(); }}
    onClick={e => { if (e.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }} aria-label={title}>
    <div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={21} /></button></div>
    {children}
  </dialog>;
}
