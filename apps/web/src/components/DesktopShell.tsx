import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import type { Track } from '@home-music/shared';
import {
  Folder,
  GripVertical,
  ListMusic,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  RefreshCw
} from 'lucide-react';
import { useDesktopLayout } from '../useDesktopLayout';
import type { LibraryTab } from '../useLibraryNavigation';
import { useTrackLyrics } from '../useTrackLyrics';
import { Artwork } from './Artwork';

const DESKTOP_QUEUE_PREVIEW_SIZE = 32;
const DESKTOP_QUEUE_LOAD_THRESHOLD_PX = 120;
const DESKTOP_SIDEBAR_EXPANDED_WIDTH = 236;
const DESKTOP_SIDEBAR_COLLAPSED_WIDTH = 74;
const DESKTOP_CONTEXT_MIN_WIDTH = 280;
const DESKTOP_CONTEXT_MAX_WIDTH = 520;
const DESKTOP_CONTEXT_DEFAULT_WIDTH = 340;

type DesktopLayoutStyle = CSSProperties & {
  '--desktop-sidebar-width'?: string;
  '--desktop-context-width'?: string;
};

export type DesktopSection = 'player' | 'library' | 'users' | 'account';
type DesktopContextTab = 'queue' | 'lyrics';

type DesktopShellProps = {
  active: DesktopSection;
  activeLibraryTab?: LibraryTab;
  current?: Track | null;
  playing: boolean;
  libraryCount: number;
  queue: Track[];
  currentIndex: number;
  offlineMode?: boolean;
  canRefreshLibrary?: boolean;
  libraryRefreshing?: boolean;
  onRefreshLibrary?: () => void;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenLibraryTab?: (tab: LibraryTab) => void;
  onPlayTrack?: (track: Track, context: Track[]) => void;
  onReorderQueue?: (from: number, to: number) => void;
  sidebarUtilities?: ReactNode;
  surfaceClassName: string;
  children: ReactNode;
};

type NavigationButtonProps = {
  active: boolean;
  label: string;
  icon: ReactNode;
  nested?: boolean;
  onClick: () => void;
};

function NavigationButton({ active, label, icon, nested = false, onClick }: NavigationButtonProps) {
  return (
    <button
      className={`desktop-nav__item ${nested ? 'desktop-nav__item--nested' : ''} ${active ? 'is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function artworkTrack(track: Track, offlineMode: boolean): Track {
  return offlineMode && track.hasCover ? { ...track, hasCover: false } : track;
}

function clampContextWidth(value: number) {
  return Math.max(DESKTOP_CONTEXT_MIN_WIDTH, Math.min(DESKTOP_CONTEXT_MAX_WIDTH, value));
}

export function DesktopShell({
  active,
  activeLibraryTab,
  current,
  playing,
  libraryCount,
  queue,
  currentIndex,
  offlineMode = false,
  canRefreshLibrary = false,
  libraryRefreshing = false,
  onRefreshLibrary,
  onOpenPlayer,
  onOpenLibrary,
  onOpenLibraryTab,
  onPlayTrack,
  onReorderQueue,
  sidebarUtilities,
  surfaceClassName,
  children
}: DesktopShellProps) {
  const [contextTab, setContextTab] = useState<DesktopContextTab>('queue');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [queueVisibleCount, setQueueVisibleCount] = useState(DESKTOP_QUEUE_PREVIEW_SIZE);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextWidth, setContextWidth] = useState(DESKTOP_CONTEXT_DEFAULT_WIDTH);
  const queueListRef = useRef<HTMLDivElement>(null);
  const queueLoadMoreRef = useRef<HTMLDivElement>(null);
  const contextResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const desktopLayout = useDesktopLayout();
  const lyrics = useTrackLyrics(current, offlineMode || !desktopLayout);
  const contextTrack = current ? artworkTrack(current, offlineMode) : null;
  const queueStart = currentIndex >= 0 ? currentIndex + 1 : 0;
  const queuePreview = queue.slice(queueStart, queueStart + queueVisibleCount);
  const remainingQueueCount = Math.max(0, queue.length - queueStart - queuePreview.length);
  const upcomingCount = Math.max(0, queue.length - queueStart);
  const layoutStyle: DesktopLayoutStyle = {
    '--desktop-sidebar-width': `${sidebarCollapsed ? DESKTOP_SIDEBAR_COLLAPSED_WIDTH : DESKTOP_SIDEBAR_EXPANDED_WIDTH}px`,
    '--desktop-context-width': `${contextWidth}px`
  };

  useEffect(() => {
    if (!lyrics && contextTab === 'lyrics') setContextTab('queue');
  }, [contextTab, lyrics]);

  useEffect(() => {
    setContextTab('queue');
    setQueueVisibleCount(DESKTOP_QUEUE_PREVIEW_SIZE);
  }, [current?.id]);

  useEffect(() => {
    if (contextTab !== 'queue' || remainingQueueCount <= 0 || typeof IntersectionObserver === 'undefined') return;
    const root = queueListRef.current;
    const target = queueLoadMoreRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setQueueVisibleCount(count => count + DESKTOP_QUEUE_PREVIEW_SIZE);
      }
    }, {
      root,
      rootMargin: `0px 0px ${DESKTOP_QUEUE_LOAD_THRESHOLD_PX}px 0px`
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [contextTab, remainingQueueCount]);

  function beginQueueDrag(event: DragEvent<HTMLButtonElement>, queueIndex: number) {
    if (!onReorderQueue) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(queueIndex));
    setDragFrom(queueIndex);
    setDragOver(queueIndex);
  }

  function dropQueue(event: DragEvent<HTMLDivElement>, queueIndex: number) {
    if (!onReorderQueue) return;
    event.preventDefault();
    const transferredIndex = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    const sourceIndex = dragFrom ?? (Number.isInteger(transferredIndex) ? transferredIndex : null);
    if (sourceIndex != null && sourceIndex !== queueIndex) onReorderQueue(sourceIndex, queueIndex);
    setDragFrom(null);
    setDragOver(null);
  }

  function finishQueueDrag() {
    setDragFrom(null);
    setDragOver(null);
  }

  function beginContextResize(event: ReactPointerEvent<HTMLDivElement>) {
    contextResizeStartRef.current = { x: event.clientX, width: contextWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-desktop-context');
  }

  function resizeContext(event: ReactPointerEvent<HTMLDivElement>) {
    const start = contextResizeStartRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setContextWidth(clampContextWidth(start.width + (start.x - event.clientX)));
  }

  function finishContextResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    contextResizeStartRef.current = null;
    document.body.classList.remove('is-resizing-desktop-context');
  }

  function resizeContextWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') {
      setContextWidth(DESKTOP_CONTEXT_MIN_WIDTH);
      return;
    }
    if (event.key === 'End') {
      setContextWidth(DESKTOP_CONTEXT_MAX_WIDTH);
      return;
    }
    setContextWidth(width => clampContextWidth(width + (event.key === 'ArrowLeft' ? 20 : -20)));
  }

  return (
    <div
      className="desktop-layout"
      data-desktop-active={active}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      style={layoutStyle}
    >
      <aside className={`desktop-sidebar ${sidebarUtilities ? 'has-utilities' : ''}`} data-testid="desktop-sidebar">
        <button
          className="desktop-sidebar__collapse"
          type="button"
          aria-label={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
          title={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
          aria-pressed={sidebarCollapsed}
          onClick={() => setSidebarCollapsed(value => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>

        <div className="desktop-brand">
          <span className="desktop-brand__icon"><Music2 /></span>
          <div>
            <strong>Home Music</strong>
            <small>{offlineMode ? 'Modo offline' : 'Sua biblioteca'}</small>
          </div>
        </div>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <NavigationButton active={active === 'player'} label="Tocando agora" icon={<Radio />} onClick={onOpenPlayer} />

          {offlineMode || !onOpenLibraryTab ? (
            <NavigationButton active={active === 'library'} label={offlineMode ? 'Downloads' : 'Biblioteca'} icon={<ListMusic />} onClick={onOpenLibrary} />
          ) : (
            <div className="desktop-nav__group" aria-label="Biblioteca">
              <div className="desktop-nav__group-heading">
                <span className="desktop-nav__group-label">Biblioteca</span>
                {canRefreshLibrary && onRefreshLibrary && (
                  <button
                    className={`desktop-nav__refresh ${libraryRefreshing ? 'is-loading' : ''}`}
                    type="button"
                    aria-label="Atualizar biblioteca"
                    title="Atualizar biblioteca"
                    disabled={libraryRefreshing}
                    onClick={onRefreshLibrary}
                  >
                    <RefreshCw aria-hidden="true" />
                  </button>
                )}
              </div>
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'folders'} label="Pastas" icon={<Folder />} onClick={() => onOpenLibraryTab('folders')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'playlists'} label="Playlists" icon={<ListMusic />} onClick={() => onOpenLibraryTab('playlists')} />
            </div>
          )}
        </nav>

        {sidebarUtilities && <div className="desktop-sidebar__utilities">{sidebarUtilities}</div>}
      </aside>

      <section className={surfaceClassName} data-desktop-section={active}>
        <div className={`desktop-main-content desktop-main-content--${active}`}>{children}</div>
      </section>

      <aside className="desktop-context" data-testid="desktop-context" aria-label="Fila de reprodução">
        <div
          className="desktop-context__resizer"
          role="separator"
          tabIndex={0}
          aria-label="Redimensionar fila"
          aria-orientation="vertical"
          aria-valuemin={DESKTOP_CONTEXT_MIN_WIDTH}
          aria-valuemax={DESKTOP_CONTEXT_MAX_WIDTH}
          aria-valuenow={Math.round(contextWidth)}
          onPointerDown={beginContextResize}
          onPointerMove={resizeContext}
          onPointerUp={finishContextResize}
          onPointerCancel={finishContextResize}
          onKeyDown={resizeContextWithKeyboard}
        >
          <span aria-hidden="true"><GripVertical /></span>
        </div>

        <div className="desktop-context__heading desktop-context__heading--queue">
          <strong>Fila</strong>
          <span>· {queue.length} {queue.length === 1 ? 'faixa' : 'faixas'}</span>
          {active !== 'player' && <small>{playing ? 'Reproduzindo' : 'Pausado'}</small>}
        </div>

        {contextTrack ? (
          <section className="desktop-context__current" aria-label="Em reprodução">
            <strong>Em reprodução</strong>
            <button className="desktop-now-playing" type="button" onClick={onOpenPlayer}>
              <Artwork track={contextTrack} />
              <span className="desktop-now-playing__text"><strong>{contextTrack.title}</strong><small>{contextTrack.artist || 'Artista desconhecido'}</small></span>
            </button>
          </section>
        ) : <div className="desktop-context__empty">Nenhuma faixa selecionada.</div>}

        {lyrics && (
          <div className="desktop-context__tabs" role="tablist" aria-label="Painel contextual">
            <button type="button" role="tab" aria-selected={contextTab === 'queue'} className={contextTab === 'queue' ? 'is-active' : ''} onClick={() => setContextTab('queue')}><ListMusic />Fila</button>
            <button type="button" role="tab" aria-selected={contextTab === 'lyrics'} className={contextTab === 'lyrics' ? 'is-active' : ''} onClick={() => setContextTab('lyrics')}><Music2 />Letra</button>
          </div>
        )}

        {contextTab === 'lyrics' && lyrics ? (
          <section className="desktop-lyrics" aria-label="Letra da música" data-testid="desktop-lyrics">
            <div className={lyrics.synchronized ? 'desktop-lyrics__lines is-synchronized' : 'desktop-lyrics__lines'}>
              {lyrics.lines.map((line, index) => <p key={`${line.time ?? 'plain'}-${index}`}>{line.text || '♪'}</p>)}
            </div>
          </section>
        ) : (
          <section className="desktop-queue" aria-label="Fila de reprodução" data-testid="desktop-queue">
            <div className="desktop-queue__header"><strong>A seguir</strong><span>{upcomingCount}</span></div>
            <div
              ref={queueListRef}
              className="desktop-queue__list"
              onScroll={event => {
                if (remainingQueueCount <= 0 || typeof IntersectionObserver !== 'undefined') return;
                const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
                if (scrollHeight - scrollTop - clientHeight <= DESKTOP_QUEUE_LOAD_THRESHOLD_PX) {
                  setQueueVisibleCount(count => count + DESKTOP_QUEUE_PREVIEW_SIZE);
                }
              }}
            >
              {queuePreview.length ? queuePreview.map((track, previewIndex) => {
                const queueIndex = queueStart + previewIndex;
                const isDragging = queueIndex === dragFrom;
                const isDragOver = queueIndex === dragOver && dragFrom !== queueIndex;
                return (
                  <div
                    key={`${track.id}-${queueIndex}`}
                    className={`desktop-queue__row ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`.trim()}
                    data-queue-index={queueIndex}
                    onDragOver={event => {
                      if (!onReorderQueue) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOver(queueIndex);
                    }}
                    onDrop={event => dropQueue(event, queueIndex)}
                  >
                    <button className="desktop-queue__drag-handle" type="button" draggable={Boolean(onReorderQueue)} disabled={!onReorderQueue} aria-label={`Arrastar ${track.title}`} onDragStart={event => beginQueueDrag(event, queueIndex)} onDragEnd={finishQueueDrag}><GripVertical aria-hidden="true" /></button>
                    <button className="desktop-queue__item" type="button" onClick={() => onPlayTrack?.(track, queue)}>
                      <Artwork track={artworkTrack(track, offlineMode)} />
                      <span><strong>{track.title}</strong><small>{track.artist || 'Artista desconhecido'}</small></span>
                    </button>
                  </div>
                );
              }) : <div className="desktop-queue__empty">Não há próximas faixas.</div>}
              {remainingQueueCount > 0 && (
                <div ref={queueLoadMoreRef} className="desktop-queue__load-sentinel" style={{ minHeight: 1 }} aria-hidden="true" />
              )}
            </div>
            {remainingQueueCount > 0 && <small className="desktop-queue__remaining">+ {remainingQueueCount} faixas · role para carregar</small>}
          </section>
        )}

        {active !== 'player' && (
          <button className="desktop-context__action" type="button" onClick={onOpenLibrary}>{offlineMode ? 'Abrir downloads' : 'Abrir biblioteca'}</button>
        )}
      </aside>
    </div>
  );
}
