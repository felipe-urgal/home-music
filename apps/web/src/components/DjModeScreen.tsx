import { ArrowLeft, Disc3, SlidersHorizontal } from 'lucide-react';

type DjModeScreenProps = {
  onExit: () => void;
};

export function DjModeScreen({ onExit }: DjModeScreenProps) {
  return (
    <section className="dj-mode" aria-label="Modo DJ">
      <header className="dj-mode__header">
        <div className="dj-mode__brand">
          <span className="dj-mode__brand-icon" aria-hidden="true"><Disc3 /></span>
          <div>
            <strong>Modo DJ</strong>
            <small>Dual-deck</small>
          </div>
        </div>

        <button className="dj-mode__exit" type="button" onClick={onExit}>
          <ArrowLeft aria-hidden="true" />
          <span>Sair do modo DJ</span>
        </button>
      </header>

      <div className="dj-mode__workspace">
        <article className="dj-mode__deck" aria-label="Deck A">
          <div className="dj-mode__deck-heading">
            <span>Deck A</span>
            <small>Esquerdo</small>
          </div>
          <div className="dj-mode__deck-empty">
            <Disc3 aria-hidden="true" />
            <strong>Nenhuma faixa carregada</strong>
            <span>Os controles do Deck A entram na próxima etapa.</span>
          </div>
        </article>

        <section className="dj-mode__mixer" aria-label="Mixer">
          <div className="dj-mode__mixer-heading">
            <SlidersHorizontal aria-hidden="true" />
            <span>Mixer</span>
          </div>
          <div className="dj-mode__mixer-placeholder">
            <span>Channel A</span>
            <div aria-hidden="true" />
            <span>Crossfader</span>
            <div aria-hidden="true" />
            <span>Channel B</span>
          </div>
        </section>

        <article className="dj-mode__deck" aria-label="Deck B">
          <div className="dj-mode__deck-heading">
            <span>Deck B</span>
            <small>Direito</small>
          </div>
          <div className="dj-mode__deck-empty">
            <Disc3 aria-hidden="true" />
            <strong>Nenhuma faixa carregada</strong>
            <span>Os controles do Deck B entram na próxima etapa.</span>
          </div>
        </article>
      </div>

      <footer className="dj-mode__bottom-panel">
        <div>
          <strong>Biblioteca</strong>
          <span>Seleção e LOAD A/B entram na etapa dedicada.</span>
        </div>
        <div>
          <strong>Controlador MIDI</strong>
          <span>Status e diagnóstico entram na etapa dedicada.</span>
        </div>
      </footer>
    </section>
  );
}
