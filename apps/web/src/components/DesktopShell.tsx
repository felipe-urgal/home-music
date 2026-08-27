import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import type { Track } from '@home-music/shared';
import {
  BarChart3,
  Disc3,
  Folder,
  GripVertical,
  Heart,
  History,
  ListMusic,
  Music2,
  Radio,
  Upload,
  Users
} from 'lucide-react';
import { useDesktopKeyboardShortcuts } from '../useDesktopKeyboardShortcuts';
import { useDesktopLayout } from '../useDesktopLayout';
import type { LibraryTab } from '../useLibraryNavigation';
import { useTrackLyrics } from '../useTrackLyrics';
import { Artwork } from './Artwork';

const DESKTOP_QUEUE_PREVIEW_SIZE = 32;

export type DesktopSection = 'player' | 'library' | 'statistics' | 'users' | 'account';
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
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenLibraryTab?: (tab: LibraryTab) => void;
  onOpenStatistics?: () => void;
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

export function DesktopShell({
  active,
  activeLibraryTab,
  current,
  playing,
  libraryCount,
  queue,
  currentIndex,
  offlineMode = false,
  onOpenPlayer,
  onOpenLibrary,
  onOpenLibraryTab,
  onOpenStatistics,
  onPlayTrack,
  onReorderQueue,
  sidebarUtilities,
  surfaceClassName,
  children
}: DesktopShellProps) {
  const [contextTab, setContextTab] = useState<DesktopContextTab>('queue');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const desktopLayout = useDesktopLayout();
  const lyrics = useTrackLyrics(current, offlineMode || !desktopLayout);
  const contextTrack = current ? artworkTrack(current, offlineMode) : null;
  const queueStart = currentIndex >= 0 ? currentIndex + 1 : 0;
  const queuePreview = queue.slice(queueStart, queueStart + DESKTOP_QUEUE_PREVIEW_SIZE);
  const remainingQueueCount = Math.max(0, queue.length - queueStart - queuePreview.length);

  const focusLibrarySearch = useCallback(() => {
    if (!onOpenLibraryTab) return;
    onOpenLibraryTab('tracks');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const search = document.querySelector<HTMLInputElement>('.search-box--library input');
        search?.focus();
        search?.select();
      });
    });
  }, [onOpenLibraryTab]);

  useDesktopKeyboardShortcuts({
    enabled: desktopLayout && !offlineMode && Boolean(onOpenLibraryTab),
    onFocusSearch: focusLibrarySearch
  });

  useEffect(() => {
    if (!lyrics && contextTab === 'lyrics') setContextTab('queue');
  }, [contextTab, lyrics]);

  useEffect(() => {
    setContextTab('queue');
  }, [current?.id]);

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

  return (
    <div className="desktop-layout" data-desktop-active={active}>
      <aside className={`desktop-sidebar ${sidebarUtilities ? 'has-utilities' : ''}`} data-testid="desktop-sidebar">
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
              <span className="desktop-nav__group-label">Biblioteca</span>
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'tracks'} label="Músicas" icon={<Music2 />} onClick={() => onOpenLibraryTab('tracks')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'artists'} label="Artistas" icon={<Users />} onClick={() => onOpenLibraryTab('artists')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'albums'} label="Álbuns" icon={<Disc3 />} onClick={() => onOpenLibraryTab('albums')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'folders'} label="Pastas" icon={<Folder />} onClick={() => onOpenLibraryTab('folders')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'favorites'} label="Favoritos" icon={<Heart />} onClick={() => onOpenLibraryTab('favorites')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'playlists'} label="Playlists" icon={<ListMusic />} onClick={() => onOpenLibraryTab('playlists')} />
              <NavigationButton nested active={false} label="Rekordbox" icon={<Upload />} onClick={() => onOpenLibraryTab('playlists')} />
              <NavigationButton nested active={active === 'library' && activeLibraryTab === 'history'} label="Histórico" icon={<History />} onClick={() => onOpenLibraryTab('history')} />
            </div>
          )}

          {!offlineMode && onOpenStatistics && (
            <NavigationButton active={active === 'statistics'} label="Estatísticas" icon={<BarChart3 />} onClick={onOpenStatistics} />
          )}
        </nav>

        {sidebarUtilities && <div className="desktop-sidebar__utilities">{sidebarUtilities}</div>}

        <div className="desktop-sidebar__footer">
          <span>{libraryCount.toLocaleString('pt-BR')}</span>
          <small>{libraryCount === 1 ? 'faixa disponível' : 'faixas disponíveis'}</small>
        </div>
      </aside>

      <section className={surfaceClassName} data-desktop-section={active}>
        <div className={`desktop-main-content desktop-main-content--${active}`}>{children}</div>
      </section>

      <aside className="desktop-context" data-testid="desktop-context" aria-label="Contexto da reprodução">
        <div className="desktop-context__heading">
          <span>Contexto</span>
          {active !== 'player' && <small>{playing ? 'Reproduzindo' : 'Pausado'}</small>}
        </div>

        {contextTrack ? (
          <button className="desktop-now-playing" type="button" onClick={onOpenPlayer}>
            <Artwork track={contextTrack} />
            <span className="desktop-now-playing__text"><strong>{contextTrack.title}</strong><small>{contextTrack.artist || 'Artista desconhecido'}</small></span>
          </button>
        ) : <div className="desktop-context__empty">Nenhuma faixa selecionada.</div>}

        <div className="desktop-context__summary">
          <span>{queue.length} {queue.length === 1 ? 'faixa na fila' : 'faixas na fila'}</span>
          {active !== 'player' && <><span>·</span><span>{libraryCount} {offlineMode ? 'downloads' : 'na biblioteca'}</span></>}
        </div>

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
            <div className="desktop-queue__header"><strong>Próximas</strong><span>{Math.max(0, queue.length - queueStart)}</span></div>
            <div className="desktop-queue__list">
              {queuePreview.length ? queuePreview.map((track, previewIndex) => {
                const queueIndex = queueStart + previewIndex;
                const isCurrent = queueIndex === currentIndex;
                const isDragging = queueIndex === dragFrom;
                const isDragOver = queueIndex === dragOver && dragFrom !== queueIndex;
                return (
                  <div
                    key={`${track.id}-${queueIndex}`}
                    className={`desktop-queue__row ${isCurrent ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`.trim()}
                    data-queue-index={queueIndex}
                    onDragOver={event => {
                      if (!onReorderQueue) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOver(queueIndex);
                    }}
                    onDrop={event => dropQueue(event, queueIndex)}
                  >
                    <button className="desktop-queue__drag-handle" type="button" draggable={!isCurrent && Boolean(onReorderQueue)} disabled={isCurrent || !onReorderQueue} aria-label={isCurrent ? 'Faixa atual' : `Arrastar ${track.title}`} onDragStart={event => beginQueueDrag(event, queueIndex)} onDragEnd={finishQueueDrag}><GripVertical aria-hidden="true" /></button>
                    <button className="desktop-queue__item" type="button" aria-current={isCurrent ? 'true' : undefined} onClick={() => onPlayTrack?.(track, queue)}>
                      <Artwork track={artworkTrack(track, offlineMode)} />
                      <span><strong>{track.title}</strong><small>{track.artist || 'Artista desconhecido'}</small></span>
                    </button>
                  </div>
                );
              }) : <div className="desktop-queue__empty">A fila está vazia.</div>}
            </div>
            {remainingQueueCount > 0 && <small className="desktop-queue__remaining">+ {remainingQueueCount} faixas depois</small>}
          </section>
        )}

        {active !== 'player' && (
          <button className="desktop-context__action" type="button" onClick={onOpenLibrary}>{offlineMode ? 'Abrir downloads' : 'Abrir biblioteca'}</button>
        )}
      </aside>
    </div>
  );
}
