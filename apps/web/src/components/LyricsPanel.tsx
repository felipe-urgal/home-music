import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';

type LyricsLine = {
  time: number | null;
  text: string;
};

type LyricsResponse = {
  source: 'lrc' | 'txt';
  synchronized: boolean;
  lines: LyricsLine[];
};

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
};

export function LyricsPanel({ track, currentTime, offlineMode }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedTrackId, setLoadedTrackId] = useState<string | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setOpen(false);
    setLyrics(null);
    setLoadedTrackId(null);
  }, [track.id]);

  useEffect(() => {
    if (!open || offlineMode || loadedTrackId === track.id) return;

    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/tracks/${track.id}/lyrics`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar a letra.');
        return response.json() as Promise<LyricsResponse | null>;
      })
      .then(data => {
        setLyrics(data);
        setLoadedTrackId(track.id);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLyrics(null);
        setLoadedTrackId(track.id);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
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
