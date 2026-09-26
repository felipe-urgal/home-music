import { Cable, ChevronLeft, LoaderCircle } from 'lucide-react';
import { useWebMidiController } from '../useWebMidiController';

type AccountMidiControllersProps = {
  onBack: () => void;
};

function statusText(status: ReturnType<typeof useWebMidiController>['status']) {
  switch (status) {
    case 'connecting': return 'Conectando…';
    case 'connected': return 'Conectado';
    case 'denied': return 'Permissão negada';
    case 'error': return 'Falha ao conectar';
    default: return 'Desconectado';
  }
}

export function AccountMidiControllers({ onBack }: AccountMidiControllersProps) {
  const midi = useWebMidiController();

  return (
    <section className="my-account-card" aria-labelledby="midi-controller-title">
      <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}>
        <ChevronLeft />
      </button>

      <div className="my-account-card__heading">
        <span className="my-account-card__icon"><Cable /></span>
        <div>
          <strong id="midi-controller-title">Controlador MIDI</strong>
          <small>Conecte um controlador compatível pelo navegador.</small>
        </div>
      </div>

      {!midi.supported ? (
        <p className="my-account-card__note">
          Web MIDI não está disponível neste navegador ou contexto seguro.
        </p>
      ) : (
        <>
          <div className="my-account-links">
            <div>
              <span>
                <strong>Status</strong>
                <small>{statusText(midi.status)}</small>
              </span>
            </div>
          </div>

          {midi.status !== 'connected' ? (
            <button
              className="primary-action my-account-action"
              type="button"
              disabled={midi.status === 'connecting'}
              onClick={() => void midi.connect()}
            >
              {midi.status === 'connecting' && <LoaderCircle className="my-account-spinner" />}
              {midi.status === 'connecting' ? 'Conectando…' : 'Conectar controlador'}
            </button>
          ) : (
            <>
              <label>
                <span>Entrada MIDI</span>
                <select
                  value={midi.selectedInputId ?? ''}
                  onChange={event => midi.selectInput(event.target.value || null)}
                >
                  <option value="">Nenhuma</option>
                  {midi.inputs.map(port => (
                    <option key={port.id} value={port.id} disabled={port.state !== 'connected'}>
                      {port.name}{port.manufacturer ? ` — ${port.manufacturer}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Saída MIDI</span>
                <select
                  value={midi.selectedOutputId ?? ''}
                  onChange={event => midi.selectOutput(event.target.value || null)}
                >
                  <option value="">Nenhuma</option>
                  {midi.outputs.map(port => (
                    <option key={port.id} value={port.id} disabled={port.state !== 'connected'}>
                      {port.name}{port.manufacturer ? ` — ${port.manufacturer}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={midi.diagnosticsEnabled}
                  onChange={event => midi.setDiagnosticsEnabled(event.target.checked)}
                />
                <span>Diagnóstico local</span>
              </label>

              {midi.diagnosticsEnabled && midi.lastMessage && (
                <p className="my-account-card__note" aria-live="polite">
                  Último evento: status {midi.lastMessage.status}, canal {midi.lastMessage.channel + 1},
                  {' '}data1 {midi.lastMessage.data1}, data2 {midi.lastMessage.data2}.
                </p>
              )}

              <button className="my-account-action" type="button" onClick={midi.disconnect}>
                Desconectar
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
