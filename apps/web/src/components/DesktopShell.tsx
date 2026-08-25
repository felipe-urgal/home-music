import type { ReactNode } from 'react';
import type { Track } from '@home-music/shared';
import { BarChart3, Library, Music2, Radio } from 'lucide-react';
import { Artwork } from './Artwork';

export type DesktopSection = 'player' | 'library' | 'statistics';

type DesktopShellProps = {
  active: DesktopSection;
  current?: Track | null;
  playing: boolean;
  libraryCount: number;
  queueCount: number;
  offlineMode?: boolean;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenStatistics?: () => void;
  surfaceClassName: string;
  children: ReactNode;
};

type NavigationButtonProps = {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

function NavigationButton({ active, label, icon, onClick }: NavigationButtonProps) {
  return (
    <button
      className={`desktop-nav__item ${active ? 'is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function DesktopShell({
  active,
  current,
  playing,
  libraryCount,
  queueCount,
  offlineMode = false,
  onOpenPlayer,
  onOpenLibrary,
  onOpenStatistics,
  surfaceClassName,
  children
}: DesktopShellProps) {
  const contextTrack = offlineMode && current?.hasCover ? { ...current, hasCover: false } : current;

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
          <NavigationButton
            active={active === 'library'}
            label={offlineMode ? 'Downloads' : 'Biblioteca'}
            icon={<Library />}
            onClick={onOpenLibrary}
          />
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
          <span>Agora</span>
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

        <div className="desktop-context__stats">
          <div>
            <strong>{queueCount}</strong>
            <span>{queueCount === 1 ? 'faixa na fila' : 'faixas na fila'}</span>
          </div>
          <div>
            <strong>{libraryCount}</strong>
            <span>{offlineMode ? 'downloads' : 'na biblioteca'}</span>
          </div>
        </div>

        <button className="desktop-context__action" type="button" onClick={onOpenLibrary}>
          {offlineMode ? 'Abrir downloads' : 'Abrir biblioteca'}
        </button>
      </aside>
    </div>
  );
}
