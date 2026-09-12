import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, LocateFixed, Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { useTrackLyrics } from '../useTrackLyrics';

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
};

export function LyricsPanel({ track, currentTime, offlineMode }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const linesRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lyrics = useTrackLyrics(track, offlineMode);

  useEffect(() => {
    setOpen(false);
    setAutoFollow(true);
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
    if (!open || !autoFollow) return;

    const container = linesRef.current;
    const activeLineElement = activeLineRef.current;
    if (!container || !activeLineElement) return;

    const containerRect = container.getBoundingClientRect();
    const lineRect = activeLineElement.getBoundingClientRect();
    const targetTop = container.scrollTop
      + (lineRect.top - containerRect.top)
      - ((container.clientHeight - lineRect.height) / 2);

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });
  }, [activeLine, autoFollow, open]);

  if (!lyrics) return null;

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
        <div className="lyrics-panel__content">
          {lyrics.synchronized && !autoFollow && (
            <button
              type="button"
              className="lyrics-panel__follow"
              onClick={() => setAutoFollow(true)}
            >
              <LocateFixed aria-hidden="true" />
              Acompanhar reprodução
            </button>
          )}
          <div
            ref={linesRef}
            className={lyrics.synchronized ? 'lyrics-panel__lines is-synchronized' : 'lyrics-panel__lines'}
            onWheel={() => setAutoFollow(false)}
            onTouchMove={() => setAutoFollow(false)}
          >
            {lyrics.lines.map((line, index) => (
              <p
                key={`${line.time ?? 'plain'}-${index}`}
                ref={index === activeLine ? activeLineRef : null}
                className={index === activeLine ? 'is-active' : ''}
                aria-current={index === activeLine ? 'true' : undefined}
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
