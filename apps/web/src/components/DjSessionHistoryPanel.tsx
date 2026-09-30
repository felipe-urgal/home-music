import { useEffect, useMemo, useState } from 'react';
import { Clipboard, Download, History, RotateCcw } from 'lucide-react';
import type { DualDeckMixerState } from '../dual-deck-mixer';
import { crossfaderGains } from '../dual-deck-mixer';
import {
  buildDjSessionSetlist,
  createDjSessionHistoryState,
  DJ_SESSION_HISTORY_STORAGE_KEY,
  djSessionSetlistEntries,
  formatDjSessionDuration,
  observeDjSession,
  parseDjSessionHistory,
  type DjSessionHistoryState
} from '../dj-session-history';
import type { DjDeckId } from '../dj-controller-contract';
import type { DjDeckPanelState } from './DjModeScreen';

type DjSessionHistoryPanelProps = {
  decks: Record<DjDeckId, DjDeckPanelState>;
  mixer: DualDeckMixerState;
};

function readStoredHistory() {
  if (typeof window === 'undefined') return createDjSessionHistoryState();
  return parseDjSessionHistory(window.sessionStorage.getItem(DJ_SESSION_HISTORY_STORAGE_KEY));
}

function saveHistory(state: DjSessionHistoryState) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DJ_SESSION_HISTORY_STORAGE_KEY, JSON.stringify(state));
}

function downloadSetlist(content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'home-music-dj-setlist.txt';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DjSessionHistoryPanel({ decks, mixer }: DjSessionHistoryPanelProps) {
  const [history, setHistory] = useState<DjSessionHistoryState>(readStoredHistory);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    const gains = crossfaderGains(mixer.crossfader);
    const observations: DjDeckId[] = ['a', 'b'];

    setHistory(current => {
      const next = observeDjSession(current, observations.map(deck => ({
        deck,
        track: decks[deck].track
          ? {
              id: decks[deck].track.id,
              title: decks[deck].track.title,
              artist: decks[deck].track.artist
            }
          : null,
        playing: Boolean(decks[deck].snapshot?.playing),
        outputGain: mixer.channelVolumes[deck] * gains[deck]
      })));
      saveHistory(next);
      return next;
    });
  }, [
    decks.a.snapshot?.trackId,
    decks.a.snapshot?.playing,
    decks.a.track?.id,
    decks.b.snapshot?.trackId,
    decks.b.snapshot?.playing,
    decks.b.track?.id,
    mixer.channelVolumes.a,
    mixer.channelVolumes.b,
    mixer.crossfader
  ]);

  const setlistEntries = useMemo(() => djSessionSetlistEntries(history), [history]);
  const setlist = useMemo(() => buildDjSessionSetlist(history), [history]);

  const copySetlist = async () => {
    try {
      await navigator.clipboard.writeText(setlist);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 1_500);
    } catch {
      setCopyStatus('error');
    }
  };

  const reset = () => {
    if (!window.confirm('Limpar o histórico desta sessão DJ?')) return;
    const next = createDjSessionHistoryState();
    saveHistory(next);
    setHistory(next);
    setCopyStatus('idle');
  };

  return (
    <details className="dj-session-history">
      <summary title="Histórico da sessão DJ">
        <History aria-hidden="true" />
        <span>Sessão</span>
        {setlistEntries.length > 0 && <small>{setlistEntries.length}</small>}
      </summary>

      <div className="dj-session-history__panel">
        <header>
          <div>
            <strong>Histórico da sessão</strong>
            <span>{setlistEntries.length} {setlistEntries.length === 1 ? 'faixa tocada' : 'faixas tocadas'}</span>
          </div>
          <button type="button" onClick={reset} disabled={history.entries.length === 0}>
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
        </header>

        <div className="dj-session-history__list">
          {setlistEntries.length === 0 ? (
            <p>Nenhuma faixa entrou no master ainda.</p>
          ) : setlistEntries.map((entry, index) => (
            <div key={entry.id} className="dj-session-history__item">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{entry.title}</strong>
                <small>{entry.artist || 'Artista desconhecido'}</small>
              </div>
              <em>{entry.deck === 'a' ? 'A' : 'B'}</em>
              <time>{formatDjSessionDuration(entry.playedSeconds)}</time>
            </div>
          ))}
        </div>

        <footer>
          <button type="button" onClick={() => void copySetlist()} disabled={setlistEntries.length === 0}>
            <Clipboard aria-hidden="true" />
            {copyStatus === 'copied' ? 'Copiado' : copyStatus === 'error' ? 'Falhou' : 'Copiar setlist'}
          </button>
          <button type="button" onClick={() => downloadSetlist(setlist)} disabled={setlistEntries.length === 0}>
            <Download aria-hidden="true" />
            Exportar .txt
          </button>
        </footer>
      </div>
    </details>
  );
}
