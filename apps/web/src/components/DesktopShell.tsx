import { useEffect, useState, type ReactNode } from 'react';
import type { Track } from '@home-music/shared';
import {
  BarChart3,
  Disc3,
  Folder,
  Heart,
  History,
  ListMusic,
  Music2,
  Radio,
  Upload,
  Users
} from 'lucide-react';
import { useDesktopLayout } from '../useDesktopLayout';
import type { LibraryTab } from '../useLibraryNavigation';
import { useTrackLyrics } from '../useTrackLyrics';
import { Artwork } from './Artwork';

const DESKTOP_QUEUE_PREVIEW_SIZE = 32;

export type DesktopSection = 'player' | 'library' | 'statistics';
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
  surfaceClassName,
  children
}: DesktopShellProps) {
  const [contextTab, setContextTab] = useState<DesktopContextTab>('queue');
  const desktopLayout = useDesktopLayout();
  const lyrics = useTrackLyrics(current, offlineMode || !desktopLayout);
  const contextTrack = current ? artworkTrack(current, offlineMode) : null;
  const queueStart = Math.max(0, currentIndex);
  const queuePreview = queue.slice(queueStart, queueStart + DESKTOP_QUEUE_PREVIEW_SIZE);
  const remainingQueueCount = Math.max(0, queue.length - queueStart - queuePreview.length);

  useEffect(() => {
    if (!lyrics && contextTab === 'lyrics') setContextTab('queue');
  }, [contextTab, lyrics]);

  useEffect(() => {
    setContextTab('queue');
  }, [current?.id]);

  return (
    <div className="desktop-layout">
      <aside className="desktop-sidebar" data-testid="desktop-sidebar">
        <div className="desktop-brand">
          <span className="desktop-brand__icon"><Music2 /></span>
          <div>
            <strong>Home Music</strong>
            <small>{offlineMode ? 'Modo offline' : 'Sua biblioteca'}</small>
          </div>
        </div>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <NavigationButton
            active={active === 'player'}
            label="Tocando agora"
            icon={<Radio />}
            onClick={onOpenPlayer}
          />

          {offlineMode || !onOpenLibraryTab ? (
            <NavigationButton
              active={active === 'library'}
              label={offlineMode ? 'Downloads' : 'Biblioteca'}
              icon={<ListMusic />}
              onClick={onOpenLibrary}
            />
          ) : (
            <div className="desktop-nav__group" aria-label="Biblioteca">
              <span className="desktop-nav__group-label">Biblioteca</span>
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'tracks'}
                label="Músicas"
                icon={<Music2 />}
                onClick={() => onOpenLibraryTab('tracks')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'artists'}
                label="Artistas"
                icon={<Users />}
                onClick={() => onOpenLibraryTab('artists')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'albums'}
                label="Álbuns"
                icon={<Disc3 />}
                onClick={() => onOpenLibraryTab('albums')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'folders'}
                label="Pastas"
                icon={<Folder />}
                onClick={() => onOpenLibraryTab('folders')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'favorites'}
                label="Favoritos"
                icon={<Heart />}
                onClick={() => onOpenLibraryTab('favorites')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'playlists'}
                label="Playlists"
                icon={<ListMusic />}
                onClick={() => onOpenLibraryTab('playlists')}
              />
              <NavigationButton
                nested
                active={false}
                label="Rekordbox"
                icon={<Upload />}
                onClick={() => onOpenLibraryTab('playlists')}
              />
              <NavigationButton
                nested
                active={active === 'library' && activeLibraryTab === 'history'}
                label="Histórico"
                icon={<History />}
                onClick={() => onOpenLibraryTab('history')}
              />
            </div>
          )}

          {!offlineMode && onOpenStatistics && (
            <NavigationButton
              active={active === 'statistics'}
              label="Estatísticas"
              icon={<BarChart3 />}
              onClick={onOpenStatistics}
            />
          )}
        </nav>

        <div className="desktop-sidebar__footer">
          <span>{libraryCount.toLocaleString('pt-BR')}</span>
          <small>{libraryCount === 1 ? 'faixa disponível' : 'faixas disponíveis'}</small>
        </div>
      </aside>

      <section className={surfaceClassName} data-desktop-section={active}>
        <div className={`desktop-main-content desktop-main-content--${active}`}>
          {children}
        </div>
      </section>

      <aside className="desktop-context" data-testid="desktop-context" aria-label="Contexto da reprodução">
        <div className="desktop-context__heading">
          <span>Contexto</span>
          <small>{playing ? 'Reproduzindo' : 'Pausado'}</small>
        </div>

        {contextTrack ? (
          <button className="desktop-now-playing" type="button" onClick={onOpenPlayer}>
            <Artwork track={contextTrack} />
            <span className="desktop-now-playing__text">
              <strong>{contextTrack.title}</strong>
              <small>{contextTrack.artist || 'Artista desconhecido'}</small>
            </span>
          </button>
        ) : (
          <div className="desktop-context__empty">Nenhuma faixa selecionada.</div>
        )}

        <div className="desktop-context__summary">
          <span>{queue.length} {queue.length === 1 ? 'faixa na fila' : 'faixas na fila'}</span>
          <span>·</span>
          <span>{libraryCount} {offlineMode ? 'downloads' : 'na biblioteca'}</span>
        </div>

        <div className="desktop-context__tabs" role="tablist" aria-label="Painel contextual">
          <button
            type="button"
            role="tab"
            aria-selected={contextTab === 'queue'}
            className={contextTab === 'queue' ? 'is-active' : ''}
            onClick={() => setContextTab('queue')}
          >
            <ListMusic />
            Fila
          </button>
          {lyrics && (
            <button
              type="button"
              role="tab"
              aria-selected={contextTab === 'lyrics'}
              className={contextTab === 'lyrics' ? 'is-active' : ''}
              onClick={() => setContextTab('lyrics')}
            >
              <Music2 />
              Letra
            </button>
          )}
        </div>

        {contextTab === 'lyrics' && lyrics ? (
          <section className="desktop-lyrics" aria-label="Letra da música" data-testid="desktop-lyrics">
            <div className={lyrics.synchronized ? 'desktop-lyrics__lines is-synchronized' : 'desktop-lyrics__lines'}>
              {lyrics.lines.map((line, index) => (
                <p key={`${line.time ?? 'plain'}-${index}`}>{line.text || '♪'}</p>
              ))}
            </div>
          </section>
        ) : (
          <section className="desktop-queue" aria-label="Fila de reprodução" data-testid="desktop-queue">
            <div className="desktop-queue__header">
              <strong>Próximas</strong>
              <span>{Math.max(0, queue.length - queueStart)}</span>
            </div>
            <div className="desktop-queue__list">
              {queuePreview.length ? queuePreview.map((track, previewIndex) => {
                const queueIndex = queueStart + previewIndex;
                const isCurrent = queueIndex === currentIndex;
                return (
                  <button
                    key={`${track.id}-${queueIndex}`}
                    className={`desktop-queue__item ${isCurrent ? 'is-current' : ''}`}
                    type="button"
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => onPlayTrack?.(track, queue)}
                  >
                    <Artwork track={artworkTrack(track, offlineMode)} />
                    <span>
                      <strong>{track.title}</strong>
                      <small>{track.artist || 'Artista desconhecido'}</small>
                    </span>
                  </button>
                );
              }) : (
                <div className="desktop-queue__empty">A fila está vazia.</div>
              )}
            </div>
            {remainingQueueCount > 0 && (
              <small className="desktop-queue__remaining">+ {remainingQueueCount} faixas depois</small>
            )}
          </section>
        )}

        <button className="desktop-context__action" type="button" onClick={onOpenLibrary}>
          {offlineMode ? 'Abrir downloads' : 'Abrir biblioteca'}
        </button>
      </aside>
    </div>
  );
}
