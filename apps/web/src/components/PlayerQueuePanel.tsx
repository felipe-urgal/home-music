import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, ListMusic } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { playerArtworkTrack } from '../player-presentation';
import { Artwork } from './Artwork';

const QUEUE_PAGE_SIZE = 10;
const TOUCH_DRAG_EDGE_PX = 80;
const TOUCH_DRAG_SCROLL_STEP_PX = 18;

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
  const queueLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const touchDragIndexRef = useRef<number | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const visibleStart = Math.max(0, currentIndex);
  const visibleEnd = Math.min(queue.length, visibleStart + visibleQueueCount);
  const visibleQueue = queue.slice(visibleStart, visibleEnd);
  const hasMoreQueueItems = visibleEnd < queue.length;
  const remainingQueueCount = Math.max(0, queue.length - visibleStart - 1);

  useEffect(() => {
    setVisibleQueueCount(QUEUE_PAGE_SIZE);
    setShowQueue(false);
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

  function dropQueue(event: DragEvent, to: number) {
    event.preventDefault();
    if (dragFrom != null) onReorderQueue(dragFrom, to);
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
    onReorderQueue(from, to);
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

  return (
    <section className="queue-panel queue-panel--player">
      <button type="button" className="queue-panel__toggle" aria-expanded={showQueue} onClick={() => setShowQueue(value => !value)}>
        <span><ListMusic aria-hidden="true" /> A seguir <small>· {remainingQueueCount} músicas</small></span>
        {showQueue ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>
      <div className={`queue-panel__content ${showQueue ? 'is-open' : ''}`}>
        <div className="queue-label">Fila · {queue.length} músicas · arraste ou use as setas</div>
        <div className="queue-list">
          {visibleQueue.map((track, visibleIndex) => {
            const queueIndex = visibleStart + visibleIndex;
            const isCurrent = track.id === current.id;
            const isDragging = dragFrom === queueIndex;
            return (
              <div className={`queue-item queue-item--reorder ${isCurrent ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''}`} key={track.id} data-queue-index={queueIndex} draggable={!isCurrent} onDragStart={() => setDragFrom(queueIndex)} onDragOver={event => event.preventDefault()} onDrop={event => dropQueue(event, queueIndex)} onDragEnd={() => setDragFrom(null)}>
                <button type="button" className="queue-drag-handle" aria-label={isCurrent ? 'Faixa atual' : `Arrastar ${track.title}`} disabled={isCurrent} onPointerDown={event => beginTouchReorder(event, queueIndex)} onPointerMove={moveTouchReorder} onPointerUp={finishTouchReorder} onPointerCancel={finishTouchReorder}>
                  <GripVertical className="queue-drag" aria-hidden="true" />
                </button>
                <button className="queue-item__main" onClick={() => onPlayTrack(track, queue)}>
                  <Artwork track={playerArtworkTrack(track, offlineMode)} />
                  <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                </button>
                <div className="queue-reorder-buttons">
                  <button aria-label="Mover para cima" disabled={queueIndex === 0} onClick={() => onReorderQueue(queueIndex, queueIndex - 1)}><ChevronUp /></button>
                  <button aria-label="Mover para baixo" disabled={queueIndex === queue.length - 1} onClick={() => onReorderQueue(queueIndex, queueIndex + 1)}><ChevronDown /></button>
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
