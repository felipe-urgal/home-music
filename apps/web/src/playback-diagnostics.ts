export const PLAYBACK_DIAGNOSTICS_ENABLED_KEY = 'home-music:playback-diagnostics:v1:enabled';
export const PLAYBACK_DIAGNOSTICS_LOG_KEY = 'home-music:playback-diagnostics:v1:events';
export const PLAYBACK_DIAGNOSTICS_LIMIT = 150;

export type PlaybackDiagnosticAudioState = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  networkState: number;
  currentTime: number | null;
  duration: number | null;
  errorCode: number | null;
};

export type PlaybackDiagnosticEvent = {
  at: string;
  event: string;
  visibilityState: string;
  trackId: string | null;
  reactPlaying: boolean;
  audio: PlaybackDiagnosticAudioState | null;
  detail: string | null;
};

type DiagnosticInput = Omit<PlaybackDiagnosticEvent, 'at'> & { at?: string };

function finite(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

export function snapshotPlaybackAudio(audio: HTMLAudioElement): PlaybackDiagnosticAudioState {
  return {
    paused: audio.paused,
    ended: audio.ended,
    readyState: audio.readyState,
    networkState: audio.networkState,
    currentTime: finite(audio.currentTime),
    duration: finite(audio.duration),
    errorCode: audio.error?.code ?? null
  };
}

export function playbackDiagnosticsEnabled(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    return storage.getItem(PLAYBACK_DIAGNOSTICS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function parsePlaybackDiagnostics(raw: string | null): PlaybackDiagnosticEvent[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PlaybackDiagnosticEvent => {
      if (!item || typeof item !== 'object') return false;
      const event = item as Partial<PlaybackDiagnosticEvent>;
      return typeof event.at === 'string'
        && typeof event.event === 'string'
        && typeof event.visibilityState === 'string'
        && (event.trackId === null || typeof event.trackId === 'string')
        && typeof event.reactPlaying === 'boolean'
        && (event.detail === null || typeof event.detail === 'string')
        && (event.audio === null || typeof event.audio === 'object');
    }).slice(-PLAYBACK_DIAGNOSTICS_LIMIT);
  } catch {
    return [];
  }
}

export function recordPlaybackDiagnostic(
  input: DiagnosticInput,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage
) {
  if (!playbackDiagnosticsEnabled(storage)) return false;

  try {
    const current = parsePlaybackDiagnostics(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY));
    current.push({
      ...input,
      at: input.at ?? new Date().toISOString()
    });
    storage.setItem(
      PLAYBACK_DIAGNOSTICS_LOG_KEY,
      JSON.stringify(current.slice(-PLAYBACK_DIAGNOSTICS_LIMIT))
    );
    return true;
  } catch {
    return false;
  }
}

export function readPlaybackDiagnostics(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    return parsePlaybackDiagnostics(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY));
  } catch {
    return [];
  }
}

export function clearPlaybackDiagnostics(storage: Pick<Storage, 'removeItem'> = window.localStorage) {
  try {
    storage.removeItem(PLAYBACK_DIAGNOSTICS_LOG_KEY);
  } catch {
    // Diagnóstico local é best-effort.
  }
}
