import maplibregl from './mapRuntime';
import { mapPreviewPlan, previewKey, type PreviewPlan } from './mapPreviewPlan';
import type { Stop, Theme } from './domain';

const WIDTH = 480, HEIGHT = 300, CACHE_LIMIT = 32, QUEUE_LIMIT = 24;
const cache = new Map<string, string>();
interface Job { key: string; plan: PreviewPlan; theme: Theme; signals: AbortSignal[]; promise: Promise<string>; resolve: (image: string) => void; reject: (err: Error) => void }
const pending = new Map<string, Job>(), queue: Job[] = [];
let renderer: maplibregl.Map | null = null, element: HTMLDivElement | null = null;
let working = false, disposeTimer: number | undefined, failedUntil = 0;

function dispose() { renderer?.remove(); renderer = null; element?.remove(); element = null; }
function getRenderer() {
  if (disposeTimer) clearTimeout(disposeTimer);
  if (renderer) return renderer;
  element = document.createElement('div'); element.setAttribute('aria-hidden', 'true');
  Object.assign(element.style, { position: 'fixed', left: '-10000px', top: '0', width: `${WIDTH}px`, height: `${HEIGHT}px`, pointerEvents: 'none' });
  document.body.append(element);
  try {
    renderer = new maplibregl.Map({ container: element, style: 'https://tiles.openfreemap.org/styles/positron', interactive: false,
      attributionControl: false, center: [127, 37.5], zoom: 8, pitch: 0, bearing: 0, pixelRatio: 1,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false, powerPreference: 'low-power' },
    });
    // Errors are handled by the render deadline; failed jobs use the existing coordinate diagram.
    renderer.on('error', () => {});
    return renderer;
  } catch (err) { dispose(); throw err; }
}

function paint(map: maplibregl.Map, plan: PreviewPlan, theme: Theme): string {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(map.getCanvas(), 0, 0, WIDTH, HEIGHT);
  const color = theme === 'town' ? '#9b754b' : theme === 'river' ? '#477b89' : '#426d4d';
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.setLineDash([5, 5]);
  for (const [a, b] of plan.segments) { const p = map.project(a), q = map.project(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
  ctx.setLineDash([]);
  const groups: { x: number; y: number; numbers: number[] }[] = [];
  for (const pin of plan.pins) {
    const p = map.project(pin.coordinate), group = groups.find(g => Math.hypot(g.x - p.x, g.y - p.y) < 30);
    if (group) group.numbers.push(pin.number); else groups.push({ x: p.x, y: p.y, numbers: [pin.number] });
  }
  for (const p of groups) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 19, 0, Math.PI * 2); ctx.fillStyle = '#ffffffb3'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.fillStyle = p.numbers.includes(1) ? color : '#fffef9'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = p.numbers.includes(1) ? '#fff' : color;
    ctx.font = `600 ${p.numbers.length > 2 ? 10 : 13}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.numbers.length > 2 ? `${p.numbers[0]}+${p.numbers.length - 1}` : p.numbers.join('·'), p.x, p.y + 0.5);
  }
  return canvas.toDataURL('image/webp', 0.84);
}

function render(job: Job): Promise<string> {
  const map = getRenderer();
  return new Promise((resolve, reject) => {
    let failed = false;
    const onError = () => { failed = true; };
    const timeout = window.setTimeout(() => { clean(); reject(new Error('Map preview timed out')); }, 14000);
    const clean = () => { clearTimeout(timeout); map.off('idle', complete); map.off('error', onError); };
    const complete = () => {
      clean();
      if (failed) { reject(new Error('Map data unavailable')); return; }
      try { resolve(paint(map, job.plan, job.theme)); } catch (err) { reject(err); }
    };
    map.on('error', onError);
    map.once('idle', complete);
    // jump to the overview without animated flights between different courses.
    map.fitBounds(job.plan.bounds!, { padding: { top: 64, right: 48, bottom: 48, left: 48 }, maxZoom: 15.3, pitch: 0, bearing: 0, duration: 0 });
    map.triggerRepaint();
  });
}

async function drain() {
  if (working) return; working = true;
  while (queue.length) {
    const job = queue.shift()!;
    if (job.signals.every(s => s.aborted)) { pending.delete(job.key); job.resolve(''); continue; }
    try {
      if (Date.now() < failedUntil) throw new Error('Map preview temporarily unavailable');
      const image = await render(job);
      if (job.signals.some(s => !s.aborted)) { cache.set(job.key, image); while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!); }
      job.resolve(image);
    } catch (err) { failedUntil = Date.now() + 30000; dispose(); job.reject(err instanceof Error ? err : new Error('Map unavailable')); }
    finally { pending.delete(job.key); }
  }
  working = false;
  disposeTimer = window.setTimeout(dispose, 20000);
}

export function requestMapThumbnail(stops: Stop[], theme: Theme, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.resolve('');
  const key = previewKey(stops, theme), cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached); }
  const existing = pending.get(key);
  if (existing) { existing.signals.push(signal); return existing.promise; }
  const plan = mapPreviewPlan(stops); if (!plan.bounds) return Promise.resolve('');
  // Fast scrolling must not build an unbounded background render queue.
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].signals.every(s => s.aborted)) {
    const stale = queue.splice(i, 1)[0]; pending.delete(stale.key); stale.resolve('');
  }
  if (queue.length >= QUEUE_LIMIT) return Promise.reject(new Error('Preview queue full'));
  let resolve!: Job['resolve'], reject!: Job['reject'];
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const job: Job = { key, plan, theme, signals: [signal], promise, resolve, reject };
  pending.set(key, job); queue.push(job); void drain(); return promise;
}
