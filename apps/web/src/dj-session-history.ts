import type { Track } from '@home-music/shared';
import type { DjDeckId } from './dj-controller-contract';

export const DJ_SESSION_HISTORY_STORAGE_KEY = 'home-music:dj-session-history:v1';
export const DJ_SESSION_AUDIBLE_GAIN_THRESHOLD = 0.05;

export type DjSessionTrack = Pick<Track, 'id' | 'title' | 'artist'>;

export type DjSessionEntry = {
  id: string;
  trackId: string;
  title: string;
  artist: string;
  deck: DjDeckId;
  loadedAt: number;
  startedAt: number | null;
  audibleAt: number | null;
  endedAt: number | null;
  playedSeconds: number;
  lastObservedAt: number;
  wasAudible: boolean;
};

export type DjSessionHistoryState = {
  version: 1;
  nextSequence: number;
  entries: DjSessionEntry[];
};

export type DjSessionDeckObservation = {
  deck: DjDeckId;
  track: DjSessionTrack | null;
  playing: boolean;
  outputGain: number;
};

export function createDjSessionHistoryState(): DjSessionHistoryState {
  return {
    version: 1,
    nextSequence: 1,
    entries: []
  };
}

function finishEntry(entry: DjSessionEntry, now: number) {
  const elapsed = entry.wasAudible
    ? Math.max(0, (now - entry.lastObservedAt) / 1_000)
    : 0;

  return {
    ...entry,
    endedAt: now,
    playedSeconds: entry.playedSeconds + elapsed,
    lastObservedAt: now,
    wasAudible: false
  };
}

function updateEntry(
  entry: DjSessionEntry,
  observation: DjSessionDeckObservation,
  now: number
) {
  const audible = observation.playing
    && Number.isFinite(observation.outputGain)
    && observation.outputGain >= DJ_SESSION_AUDIBLE_GAIN_THRESHOLD;
  const elapsed = entry.wasAudible
    ? Math.max(0, (now - entry.lastObservedAt) / 1_000)
    : 0;

  return {
    ...entry,
    startedAt: entry.startedAt ?? (observation.playing ? now : null),
    audibleAt: entry.audibleAt ?? (audible ? now : null),
    playedSeconds: entry.playedSeconds + elapsed,
    lastObservedAt: now,
    wasAudible: audible
  };
}

export function observeDjSession(
  state: DjSessionHistoryState,
  observations: DjSessionDeckObservation[],
  now = Date.now()
): DjSessionHistoryState {
  let nextSequence = state.nextSequence;
  let entries = state.entries.map(entry => ({ ...entry }));

  for (const observation of observations) {
    const activeIndex = entries.findLastIndex(
      entry => entry.deck === observation.deck && entry.endedAt == null
    );
    const active = activeIndex >= 0 ? entries[activeIndex] : null;

    if (!observation.track) {
      if (active) entries[activeIndex] = finishEntry(active, now);
      continue;
    }

    if (active && active.trackId !== observation.track.id) {
      entries[activeIndex] = finishEntry(active, now);
    }

    const matchingIndex = entries.findLastIndex(
      entry => entry.deck === observation.deck
        && entry.trackId === observation.track?.id
        && entry.endedAt == null
    );

    if (matchingIndex >= 0) {
      entries[matchingIndex] = updateEntry(entries[matchingIndex], observation, now);
      continue;
    }

    const audible = observation.playing
      && Number.isFinite(observation.outputGain)
      && observation.outputGain >= DJ_SESSION_AUDIBLE_GAIN_THRESHOLD;

    entries.push({
      id: `${now}-${observation.deck}-${nextSequence}`,
      trackId: observation.track.id,
      title: observation.track.title,
      artist: observation.track.artist,
      deck: observation.deck,
      loadedAt: now,
      startedAt: observation.playing ? now : null,
      audibleAt: audible ? now : null,
      endedAt: null,
      playedSeconds: 0,
      lastObservedAt: now,
      wasAudible: audible
    });
    nextSequence += 1;
  }

  return {
    version: 1,
    nextSequence,
    entries
  };
}

export function finalizeDjSession(
  state: DjSessionHistoryState,
  now = Date.now()
): DjSessionHistoryState {
  return {
    ...state,
    entries: state.entries.map(entry => entry.endedAt == null ? finishEntry(entry, now) : entry)
  };
}

export function djSessionSetlistEntries(state: DjSessionHistoryState) {
  return state.entries
    .filter(entry => entry.audibleAt != null)
    .sort((left, right) => (left.audibleAt ?? 0) - (right.audibleAt ?? 0));
}

export function formatDjSessionDuration(seconds: number) {
  const whole = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function buildDjSessionSetlist(state: DjSessionHistoryState) {
  const entries = djSessionSetlistEntries(state);
  if (!entries.length) return 'Nenhuma faixa tocada nesta sessão.';

  return entries.map((entry, index) => {
    const artist = entry.artist.trim() || 'Artista desconhecido';
    const deck = entry.deck === 'a' ? 'Deck A' : 'Deck B';
    return `${index + 1}. ${artist} — ${entry.title} · ${deck} · ${formatDjSessionDuration(entry.playedSeconds)}`;
  }).join('\n');
}

export function parseDjSessionHistory(value: string | null): DjSessionHistoryState {
  if (!value) return createDjSessionHistoryState();

  try {
    const parsed = JSON.parse(value) as Partial<DjSessionHistoryState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return createDjSessionHistoryState();
    }

    return {
      version: 1,
      nextSequence: Number.isInteger(parsed.nextSequence) && Number(parsed.nextSequence) > 0
        ? Number(parsed.nextSequence)
        : parsed.entries.length + 1,
      entries: parsed.entries.filter((entry): entry is DjSessionEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Partial<DjSessionEntry>;
        return typeof candidate.id === 'string'
          && typeof candidate.trackId === 'string'
          && typeof candidate.title === 'string'
          && typeof candidate.artist === 'string'
          && (candidate.deck === 'a' || candidate.deck === 'b')
          && typeof candidate.loadedAt === 'number'
          && typeof candidate.playedSeconds === 'number'
          && typeof candidate.lastObservedAt === 'number'
          && typeof candidate.wasAudible === 'boolean';
      })
    };
  } catch {
    return createDjSessionHistoryState();
  }
}
