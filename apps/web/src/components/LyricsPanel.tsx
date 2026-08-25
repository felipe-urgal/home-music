import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Music2 } from 'lucide-react';
import type { LyricsResponse, Track } from '@home-music/shared';

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
  lyrics: LyricsResponse | null;
};

export function LyricsPanel({ track, currentTime, offlineMode, lyrics }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [track.id]);

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
    if (open) activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine, open]);

  if (offlineMode || !lyrics) return null;

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
