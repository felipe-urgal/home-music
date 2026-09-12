import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, LocateFixed, Music2 } from 'lucide-react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { useTrackLyrics } from '../useTrackLyrics';

type LyricsPanelProps = {
  track: Track;
  currentTime: number;
  offlineMode: boolean;
};

export function findActiveLyricsLineIndex(lyrics: LyricsResponse | null, currentTime: number) {
  if (!lyrics?.synchronized) return -1;

  let index = -1;
  for (let position = 0; position < lyrics.lines.length; position += 1) {
    const time = lyrics.lines[position].time;
    if (time != null && time <= currentTime + 0.15) index = position;
    if (time != null && time > currentTime + 0.15) break;
  }
  return index;
}

export function useLyricsAutoFollow<T extends HTMLElement>(
  lyrics: LyricsResponse | null,
  currentTime: number,
  enabled: boolean,
  resetKey: string
) {
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollContainerRef = useRef<T | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const activeLine = useMemo(
    () => findActiveLyricsLineIndex(lyrics, currentTime),
    [currentTime, lyrics]
  );

  useEffect(() => {
    setAutoFollow(true);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || !autoFollow) return;

    function centerActiveLine() {
      const container = scrollContainerRef.current;
      const activeLineElement = activeLineRef.current;
      if (!container || !activeLineElement) return;

      const edgeSpace = Math.max(0, (container.clientHeight - activeLineElement.clientHeight) / 2);
      container.style.setProperty('--lyrics-follow-edge-space', `${edgeSpace}px`);

      const containerRect = container.getBoundingClientRect();
      const lineRect = activeLineElement.getBoundingClientRect();
      const targetTop = container.scrollTop
        + (lineRect.top - containerRect.top)
        - ((container.clientHeight - lineRect.height) / 2);

      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      });
    }

    centerActiveLine();
    if (typeof ResizeObserver === 'undefined') return;

    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(centerActiveLine);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeLine, autoFollow, enabled]);

  function pauseAutoFollowOnKey(event: KeyboardEvent<T>) {
    if (
      event.key === 'ArrowUp'
      || event.key === 'ArrowDown'
      || event.key === 'PageUp'
      || event.key === 'PageDown'
      || event.key === 'Home'
      || event.key === 'End'
    ) {
      setAutoFollow(false);
    }
  }

  function resumeAutoFollow() {
    setAutoFollow(true);
    scrollContainerRef.current?.focus();
  }

  return {
    activeLine,
    activeLineRef,
    autoFollow,
    pauseAutoFollow: () => setAutoFollow(false),
    pauseAutoFollowOnKey,
    resumeAutoFollow,
    scrollContainerRef
  };
}

export function LyricsPanel({ track, currentTime, offlineMode }: LyricsPanelProps) {
  const [open, setOpen] = useState(false);
  const lyrics = useTrackLyrics(track, offlineMode);
  const follow = useLyricsAutoFollow<HTMLDivElement>(lyrics, currentTime, open, track.id);

  useEffect(() => {
    setOpen(false);
  }, [track.id]);

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
        <div
          ref={follow.scrollContainerRef}
          className="lyrics-panel__content"
          tabIndex={lyrics.synchronized ? 0 : undefined}
          aria-label={lyrics.synchronized ? 'Letra sincronizada' : undefined}
          onKeyDown={follow.pauseAutoFollowOnKey}
        >
          {lyrics.synchronized && !follow.autoFollow && (
            <button
              type="button"
              className="lyrics-panel__follow"
              onClick={follow.resumeAutoFollow}
            >
              <LocateFixed aria-hidden="true" />
              Acompanhar reprodução
            </button>
          )}
          <div
            className={lyrics.synchronized ? 'lyrics-panel__lines is-synchronized' : 'lyrics-panel__lines'}
            onWheel={follow.pauseAutoFollow}
            onTouchMove={follow.pauseAutoFollow}
          >
            {lyrics.lines.map((line, index) => (
              <p
                key={`${line.time ?? 'plain'}-${index}`}
                ref={index === follow.activeLine ? follow.activeLineRef : null}
                className={index === follow.activeLine ? 'is-active' : ''}
                aria-current={index === follow.activeLine ? 'true' : undefined}
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
