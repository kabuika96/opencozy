import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { Minus, Plus, Minimize } from 'lucide-react';

type Point = { x: number; y: number };
type View = Point & { scale: number };
type Gesture = { points: Point[]; view: View; distance: number; started: number; multi: boolean; moved: boolean };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const center = (points: Point[]): Point => points.length > 1 ? { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 } : points[0]!;

export function ZoomSurface({ label, aspectRatio, fit = 'contain', resetKey, onSwipe, children }: {
  label: string; aspectRatio: number; fit?: 'contain' | 'width'; resetKey?: string | number;
  onSwipe?(direction: 'next' | 'previous'): void;
  children(size: { width: number; height: number; renderScale: number }): ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const live = useRef(view);
  const [renderScale, setRenderScale] = useState(1);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);
  const width = fit === 'width' ? size.width : Math.min(size.width, size.height * aspectRatio);
  const height = width / aspectRatio;
  const bounded = (next: View): View => {
    const scale = Math.max(1, Math.min(4, next.scale));
    const constrain = (value: number, content: number, available: number) => content <= available ? (available - content) / 2 : Math.max(available - content, Math.min(0, value));
    return { scale, x: constrain(next.x, width * scale, size.width), y: constrain(next.y, height * scale, size.height) };
  };
  const update = (next: View) => { live.current = bounded(next); setView(live.current); };
  const reset = () => { update({ scale: 1, x: 0, y: 0 }); setRenderScale(1); lastTap.current = null; };
  const zoom = (scale: number, point: Point = { x: size.width / 2, y: size.height / 2 }) => {
    const current = live.current, target = Math.max(1, Math.min(4, scale));
    if (target === 1) { reset(); return; }
    update({ scale: target, x: point.x - (point.x - current.x) * target / current.scale, y: point.y - (point.y - current.y) * target / current.scale });
    setRenderScale(target);
  };
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { reset(); pointers.current.clear(); gesture.current = null; }, [size.width, size.height, aspectRatio, resetKey]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoom(live.current.scale * Math.exp(-event.deltaY * .01), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else update({ ...live.current, x: live.current.x - event.deltaX, y: live.current.y - event.deltaY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [size.width, size.height, width, height]);
  const localPoint = (event: PointerEvent): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const begin = (multi: boolean) => {
    const points = Array.from(pointers.current.values()).slice(0, 2);
    gesture.current = points.length ? { points, view: live.current, distance: points.length > 1 ? Math.max(1, distance(points[0]!, points[1]!)) : 0, started: performance.now(), multi: multi || points.length > 1, moved: false } : null;
  };
  const end = (event: PointerEvent, canceled: boolean) => {
    if (!pointers.current.has(event.pointerId)) return;
    const current = gesture.current, point = localPoint(event);
    pointers.current.delete(event.pointerId);
    if (!canceled && current && !current.multi && pointers.current.size === 0) {
      const start = current.points[0]!, dx = point.x - start.x, dy = point.y - start.y;
      if (live.current.scale === 1 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        lastTap.current = null; onSwipe?.(dx < 0 ? 'next' : 'previous');
      } else if (!current.moved && distance(point, start) < 8 && performance.now() - current.started < 300) {
        const previous = lastTap.current;
        if (previous && performance.now() - previous.time < 350 && distance(previous.point, point) < 28) {
          zoom(live.current.scale > 1 ? 1 : 2.5, point); lastTap.current = null;
        } else lastTap.current = { point, time: performance.now() };
      } else lastTap.current = null;
    } else lastTap.current = null;
    if (pointers.current.size) begin(true);
    else { gesture.current = null; setRenderScale(live.current.scale); }
  };
  return <div className="lh-zoom-surface">
    <div ref={viewport} className="lh-zoom-viewport" role="region" aria-label={label} tabIndex={0}
      onPointerDown={event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        pointers.current.set(event.pointerId, localPoint(event));
        event.currentTarget.setPointerCapture(event.pointerId); begin(pointers.current.size > 1);
      }}
      onPointerMove={event => {
        if (!pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, localPoint(event));
        const current = gesture.current, points = Array.from(pointers.current.values()).slice(0, 2);
        const start = center(current.points), point = center(points);
        if (distance(point, start) > 8) current.moved = true;
        if (points.length > 1 && current.distance) {
          const scale = Math.max(1, Math.min(4, current.view.scale * distance(points[0]!, points[1]!) / current.distance));
          update({ scale, x: point.x - (start.x - current.view.x) * scale / current.view.scale, y: point.y - (start.y - current.view.y) * scale / current.view.scale });
        } else update({ ...current.view, x: current.view.x + point.x - start.x, y: current.view.y + point.y - start.y });
      }}
      onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
      onKeyDown={event => {
        if (event.key === '+' || event.key === '=') zoom(live.current.scale + .5);
        else if (event.key === '-') zoom(live.current.scale - .5);
        else if (event.key === '0') reset();
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) update({ ...live.current, x: live.current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: live.current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) });
        else return;
        event.preventDefault();
      }}>
      <div className="lh-zoom-content" style={{ width, height, transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}>
        {width > 0 && height > 0 ? children({ width, height, renderScale }) : null}
      </div>
    </div>
    <div className="lh-zoom-controls" aria-label="Zoom controls">
      <button aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(view.scale - .5)}><Minus size={18} /></button>
      <output aria-label="Zoom level">{Math.round(view.scale * 100)}%</output>
      <button aria-label="Zoom in" disabled={view.scale >= 4} onClick={() => zoom(view.scale + .5)}><Plus size={18} /></button>
      <button aria-label="Fit to screen" onClick={reset}><Minimize size={18} /></button>
    </div>
    <small className="lh-gesture-hint">{onSwipe ? 'Pinch to zoom · Swipe pages at 100%' : 'Pinch or double-tap to zoom'}</small>
  </div>;
}
