import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Music2 } from 'lucide-react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { apiFetch } from '../api-client';

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
};

const LYRICS_PROBE_DELAY_MS = 250;

export function LyricsPanel({ track, currentTime, offlineMode }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [resolvedTrackId, setResolvedTrackId] = useState<string | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setOpen(false);
    setLyrics(null);
    setResolvedTrackId(null);
    if (offlineMode) return;

    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => {
      void apiFetch(`/api/tracks/${track.id}/lyrics`, {
        signal: controller.signal,
        cache: 'no-store'
      })
        .then(async response => {
          if (!response.ok) throw new Error('Não foi possível verificar a letra.');
          return response.json() as Promise<LyricsResponse | null>;
        })
        .then(data => {
          if (disposed) return;
          setLyrics(data);
          setResolvedTrackId(track.id);
        })
        .catch(reason => {
          if (disposed || (reason instanceof Error && reason.name === 'AbortError')) return;
          setLyrics(null);
          setResolvedTrackId(track.id);
        });
    }, LYRICS_PROBE_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [offlineMode, track.id]);

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

  if (offlineMode || resolvedTrackId !== track.id || !lyrics) return null;

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
        </div>
      )}
    </section>
  );
}
