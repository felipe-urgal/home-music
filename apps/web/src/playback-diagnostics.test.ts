import { describe, expect, it } from 'vitest';
import {
  PLAYBACK_DIAGNOSTICS_ENABLED_KEY,
  PLAYBACK_DIAGNOSTICS_LIMIT,
  PLAYBACK_DIAGNOSTICS_LOG_KEY,
  clearPlaybackDiagnostics,
  parsePlaybackDiagnostics,
  recordPlaybackDiagnostic
} from './playback-diagnostics';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

function input(index: number) {
  return {
    at: `2026-09-06T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
    event: `event-${index}`,
    visibilityState: 'hidden',
    trackId: `track-${index}`,
    playingIntent: true,
    audio: {
      paused: false,
      ended: false,
      readyState: 4,
      networkState: 1,
      currentTime: index,
      duration: 180,
      errorCode: null
    },
    detail: null
  };
}

describe('playback diagnostics', () => {
  it('não persiste nada enquanto o modo explícito não estiver habilitado', () => {
    const storage = memoryStorage();

    expect(recordPlaybackDiagnostic(input(1), storage)).toBe(false);
    expect(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY)).toBeNull();
  });

  it('mantém ring buffer estritamente limitado', () => {
    const storage = memoryStorage({ [PLAYBACK_DIAGNOSTICS_ENABLED_KEY]: '1' });

    for (let index = 0; index < PLAYBACK_DIAGNOSTICS_LIMIT + 20; index += 1) {
      expect(recordPlaybackDiagnostic(input(index), storage)).toBe(true);
    }

    const events = parsePlaybackDiagnostics(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY));
    expect(events).toHaveLength(PLAYBACK_DIAGNOSTICS_LIMIT);
    expect(events[0]?.event).toBe('event-20');
    expect(events.at(-1)?.event).toBe(`event-${PLAYBACK_DIAGNOSTICS_LIMIT + 19}`);
  });

  it('descarta storage inválido e pode ser limpo localmente', () => {
    const storage = memoryStorage({
      [PLAYBACK_DIAGNOSTICS_ENABLED_KEY]: '1',
      [PLAYBACK_DIAGNOSTICS_LOG_KEY]: '{inválido'
    });

    expect(parsePlaybackDiagnostics(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY))).toEqual([]);
    expect(recordPlaybackDiagnostic(input(1), storage)).toBe(true);
    expect(parsePlaybackDiagnostics(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY))).toHaveLength(1);

    clearPlaybackDiagnostics(storage);
    expect(storage.getItem(PLAYBACK_DIAGNOSTICS_LOG_KEY)).toBeNull();
  });

  it('estrutura de evento não possui URL, metadata textual, cookie ou path físico', () => {
    const event = input(1);
    expect(Object.keys(event).sort()).toEqual([
      'at',
      'audio',
      'detail',
      'event',
      'playingIntent',
      'trackId',
      'visibilityState'
    ]);
    expect(JSON.stringify(event)).not.toMatch(/url|cookie|artist|album|title|path/i);
  });
});
