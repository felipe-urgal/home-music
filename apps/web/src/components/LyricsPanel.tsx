import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Music2 } from 'lucide-react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { apiFetch } from '../api-client';

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
};

export function LyricsPanel({ track, currentTime, offlineMode }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setLyrics(null);
    setError(null);
    setLoadedTrackId(null);
  }, [track.id]);

  useEffect(() => {
    if (!open || offlineMode || loadedTrackId === track.id) return;

    const controller = new AbortController();
    let disposed = false;
    setLoading(true);
    setError(null);

    apiFetch(`/api/tracks/${track.id}/lyrics`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar a letra.');
        return response.json() as Promise<LyricsResponse | null>;
      })
      .then(data => {
        if (disposed) return;
        setLyrics(data);
        setLoadedTrackId(track.id);
      })
      .catch(reason => {
        if (disposed || (reason instanceof Error && reason.name === 'AbortError')) return;
        setLyrics(null);
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a letra.');
        setLoadedTrackId(track.id);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [loadedTrackId, offlineMode, open, track.id]);

  const activeLine = useMemo(() => {
    if (!lyrics?.synchronized) return -1;
    let index = -1;
    for (let position = 0; position < lyrics.lines.length; position += 1) {
      const time = lyrics.lines[position].time;
      if (time != null && time <= currentTime + 0.15) index = position;
      if (time != null && time > currentTime + 0.15) break;
    }
    return index;
  }, [currentTime, lyrics]);

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine]);

  return (
    <section className="lyrics-panel">
      <button
        type="button"
        className="lyrics-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span><Music2 /> Letra</span>
        {open ? <ChevronUp /> : <ChevronDown />}
      </button>

      {open && (
        <div className="lyrics-panel__content" aria-live="polite">
          {offlineMode ? (
            <p className="lyrics-panel__empty">Letras ficam disponíveis quando o servidor está conectado.</p>
          ) : loading ? (
            <p className="lyrics-panel__empty">Carregando letra…</p>
          ) : error ? (
            <p className="lyrics-panel__empty lyrics-panel__empty--error">{error}</p>
          ) : lyrics ? (
            <div className={lyrics.synchronized ? 'lyrics-panel__lines is-synchronized' : 'lyrics-panel__lines'}>
              {lyrics.lines.map((line, index) => (
                <p
                  key={`${line.time ?? 'plain'}-${index}`}
                  ref={index === activeLine ? activeLineRef : null}
                  className={index === activeLine ? 'is-active' : ''}
                >
                  {line.text || '♪'}
                </p>
              ))}
            </div>
          ) : (
            <p className="lyrics-panel__empty">Nenhuma letra local encontrada para esta música.</p>
          )}
        </div>
      )}
    </section>
  );
}
