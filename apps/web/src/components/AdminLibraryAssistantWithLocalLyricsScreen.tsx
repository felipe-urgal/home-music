import { useState } from 'react';
import { AudioLines, X } from 'lucide-react';
import { AdminLibraryAssistantScreen } from './AdminLibraryAssistantScreen';
import { AdminLocalLyricsPanel } from './AdminLocalLyricsPanel';
import './admin-library-assistant-local-lyrics.css';

type Props = { onBack: () => void };

export function AdminLibraryAssistantWithLocalLyricsScreen({ onBack }: Props) {
  const [localLyricsOpen, setLocalLyricsOpen] = useState(false);
  const [assistantRevision, setAssistantRevision] = useState(0);

  return (
    <div className="assistant-local-lyrics-shell">
      <AdminLibraryAssistantScreen key={assistantRevision} onBack={onBack} />

      <button
        className="assistant-local-lyrics-shell__trigger"
        type="button"
        onClick={() => setLocalLyricsOpen(true)}
      >
        <AudioLines />
        <span>Lyrics local</span>
      </button>

      {localLyricsOpen && (
        <div className="assistant-local-lyrics-shell__backdrop" role="presentation">
          <section
            className="assistant-local-lyrics-shell__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-local-lyrics-dialog-title"
          >
            <header>
              <div>
                <strong id="assistant-local-lyrics-dialog-title">Lyrics local</strong>
                <small>Fallback opcional com Whisper, sempre sujeito a revisão.</small>
              </div>
              <button type="button" aria-label="Fechar lyrics local" onClick={() => setLocalLyricsOpen(false)}>
                <X />
              </button>
            </header>
            <AdminLocalLyricsPanel
              onReviewReady={() => {
                setAssistantRevision(current => current + 1);
                setLocalLyricsOpen(false);
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
