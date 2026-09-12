import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { ChevronDown, ChevronRight, ChevronUp, GripHorizontal, GripVertical, ListMusic, X } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { playerArtworkTrack } from '../player-presentation';
import { Artwork } from './Artwork';

const QUEUE_PAGE_SIZE = 10;
const TOUCH_DRAG_EDGE_PX = 80;
const TOUCH_DRAG_SCROLL_STEP_PX = 18;
const QUEUE_SHEET_MIN_HEIGHT_PX = 280;

type QueueSheetStyle = CSSProperties & {
  '--queue-sheet-height'?: string;
};

type PlayerQueuePanelProps = {
  current: Track;
  queue: Track[];
  currentIndex: number;
  offlineMode: boolean;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onReorderQueue: (from: number, to: number) => void;
};

export function PlayerQueuePanel({ current, queue, currentIndex, offlineMode, onPlayTrack, onReorderQueue }: PlayerQueuePanelProps) {
  const [showQueue, setShowQueue] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [visibleQueueCount, setVisibleQueueCount] = useState(QUEUE_PAGE_SIZE);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [sheetHeight, setSheetHeight] = useState(() => typeof window === 'undefined' ? 520 : Math.min(620, Math.round(window.innerHeight * 0.62)));
  const queueLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const touchDragIndexRef = useRef<number | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const sheetResizeRef = useRef<{ y: number; height: number } | null>(null);
  const visibleStart = Math.max(0, currentIndex);
  const visibleEnd = Math.min(queue.length, visibleStart + visibleQueueCount);
  const visibleQueue = queue.slice(visibleStart, visibleEnd);
  const hasMoreQueueItems = visibleEnd < queue.length;
  const remainingQueueCount = Math.max(0, queue.length - visibleStart - 1);
  const sheetStyle: QueueSheetStyle = { '--queue-sheet-height': `${sheetHeight}px` };

  useEffect(() => {
    setVisibleQueueCount(QUEUE_PAGE_SIZE);
    setShowQueue(false);
    setReorderAnnouncement('');
  }, [current.id, queue.length]);

  useEffect(() => {
    const target = queueLoadMoreRef.current;
    if (!target || !hasMoreQueueItems) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleQueueCount(Math.max(QUEUE_PAGE_SIZE, queue.length - visibleStart));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleQueueCount(count => Math.min(queue.length - visibleStart, count + QUEUE_PAGE_SIZE));
      }
    }, { root: null, rootMargin: '320px 0px', threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreQueueItems, queue.length, visibleStart, visibleEnd]);

  function reorderQueue(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const track = queue[from];
    if (!track) return;
    onReorderQueue(from, to);
    setReorderAnnouncement(`${track.title} movida para a posição ${to + 1} de ${queue.length}.`);
  }

  function dropQueue(event: DragEvent, to: number) {
    event.preventDefault();
    if (dragFrom != null) reorderQueue(dragFrom, to);
    setDragFrom(null);
  }

  function beginTouchReorder(event: ReactPointerEvent<HTMLButtonElement>, queueIndex: number) {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    touchPointerIdRef.current = event.pointerId;
    touchDragIndexRef.current = queueIndex;
    setDragFrom(queueIndex);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTouchReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    if (touchPointerIdRef.current !== event.pointerId || touchDragIndexRef.current == null) return;
    event.preventDefault();
    if (event.clientY < TOUCH_DRAG_EDGE_PX) window.scrollBy(0, -TOUCH_DRAG_SCROLL_STEP_PX);
    else if (event.clientY > window.innerHeight - TOUCH_DRAG_EDGE_PX) window.scrollBy(0, TOUCH_DRAG_SCROLL_STEP_PX);

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-queue-index]') as HTMLElement | null;
    if (!target) return;
    const to = Number(target.dataset.queueIndex);
    const from = touchDragIndexRef.current;
    if (!Number.isInteger(to) || to < 0 || to >= queue.length || to === from) return;
    reorderQueue(from, to);
    touchDragIndexRef.current = to;
    setDragFrom(to);
  }

  function finishTouchReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    if (touchPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    touchPointerIdRef.current = null;
    touchDragIndexRef.current = null;
    setDragFrom(null);
  }

  function beginSheetResize(event: ReactPointerEvent<HTMLButtonElement>) {
    sheetResizeRef.current = { y: event.clientY, height: sheetHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeSheet(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = sheetResizeRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const maxHeight = Math.max(QUEUE_SHEET_MIN_HEIGHT_PX, window.innerHeight * 0.9);
    setSheetHeight(Math.max(QUEUE_SHEET_MIN_HEIGHT_PX, Math.min(maxHeight, start.height + (start.y - event.clientY))));
  }

  function finishSheetResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    sheetResizeRef.current = null;
  }

  return (
    <section className="queue-panel queue-panel--player">
      <button type="button" className="queue-panel__toggle" aria-expanded={showQueue} onClick={() => setShowQueue(value => !value)}>
        <span><ListMusic aria-hidden="true" /> A seguir <small>· {remainingQueueCount} músicas</small></span>
        {showQueue ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>
      {showQueue && <button className="queue-sheet-backdrop" type="button" aria-label="Fechar fila" onClick={() => setShowQueue(false)} />}
      <div className={`queue-panel__content ${showQueue ? 'is-open' : ''}`} style={sheetStyle}>
        <div className="queue-sheet__header">
          <button
            className="queue-sheet__handle"
            type="button"
            aria-label="Redimensionar fila"
            onPointerDown={beginSheetResize}
            onPointerMove={resizeSheet}
            onPointerUp={finishSheetResize}
            onPointerCancel={finishSheetResize}
          ><GripHorizontal aria-hidden="true" /></button>
          <strong>A seguir</strong>
          <button className="queue-sheet__close" type="button" aria-label="Fechar fila" onClick={() => setShowQueue(false)}><X aria-hidden="true" /></button>
        </div>
        <div className="queue-label">Fila · {queue.length} músicas · arraste ou use as setas</div>
        <p className="sr-only" role="status" aria-atomic="true">{reorderAnnouncement}</p>
        <div className="queue-list">
          {visibleQueue.map((track, visibleIndex) => {
            const queueIndex = visibleStart + visibleIndex;
            const isCurrent = track.id === current.id;
            const isDragging = dragFrom === queueIndex;
            return (
              <div className={`queue-item queue-item--reorder ${isCurrent ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''}`} key={`${track.id}-${queueIndex}`} data-queue-index={queueIndex} draggable={!isCurrent} onDragStart={() => setDragFrom(queueIndex)} onDragOver={event => event.preventDefault()} onDrop={event => dropQueue(event, queueIndex)} onDragEnd={() => setDragFrom(null)}>
                <button type="button" className="queue-drag-handle" aria-label={isCurrent ? 'Faixa atual' : `Arrastar ${track.title}`} disabled={isCurrent} onPointerDown={event => beginTouchReorder(event, queueIndex)} onPointerMove={moveTouchReorder} onPointerUp={finishTouchReorder} onPointerCancel={finishTouchReorder}>
                  <GripVertical className="queue-drag" aria-hidden="true" />
                </button>
                <button type="button" className="queue-item__main" aria-current={isCurrent ? 'true' : undefined} onClick={() => onPlayTrack(track, queue)}>
                  <Artwork track={playerArtworkTrack(track, offlineMode)} />
                  <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist || 'Artista desconhecido'}</small></span>
                </button>
                <div className="queue-reorder-buttons">
                  <button type="button" aria-label={`Mover ${track.title} para cima`} disabled={queueIndex === 0} onClick={() => reorderQueue(queueIndex, queueIndex - 1)}><ChevronUp aria-hidden="true" /></button>
                  <button type="button" aria-label={`Mover ${track.title} para baixo`} disabled={queueIndex === queue.length - 1} onClick={() => reorderQueue(queueIndex, queueIndex + 1)}><ChevronDown aria-hidden="true" /></button>
                </div>
              </div>
            );
          })}
        </div>
        {hasMoreQueueItems && <div ref={queueLoadMoreRef} className="queue-load-more" aria-hidden="true" />}
      </div>
    </section>
  );
}
