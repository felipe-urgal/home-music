import { describe, expect, it, vi } from 'vitest';
import {
  clearDeckAudio,
  loadDeckAudio,
  pauseDeckAudio,
  playDeckAudio,
  readDeckAudioSnapshot,
  seekDeckAudio,
  setDeckPlaybackRate,
  setDeckVolume
} from './dual-deck-audio';

function fakeAudio() {
  const attributes = new Map<string, string>();
  const audio = {
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 180,
    playbackRate: 1,
    preservesPitch: false,
    volume: 1,
    src: '',
    error: null as MediaError | null,
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    play: vi.fn(async function (this: { paused: boolean }) {
      this.paused = false;
    }),
    load: vi.fn(),
    removeAttribute: vi.fn((name: string) => {
      attributes.delete(name);
      if (name === 'src') audio.src = '';
    }),
    getAttribute: vi.fn((name: string) => {
      if (name === 'src') return attributes.get(name) ?? (audio.src || null);
      return attributes.get(name) ?? null;
    })
  };
  Object.defineProperty(audio, 'src', {
    get: () => attributes.get('src') ?? '',
    set: (value: string) => { attributes.set('src', value); },
    configurable: true
  });
  return audio as unknown as HTMLAudioElement;
}

describe('dual deck audio primitives', () => {
  it('carrega um deck sem alterar outro elemento', () => {
    const a = fakeAudio();
    const b = fakeAudio();

    loadDeckAudio(a, '/track-a.mp3', { volume: 0.7 });

    expect(a.getAttribute('src')).toBe('/track-a.mp3');
    expect(a.volume).toBe(0.7);
    expect(a.playbackRate).toBe(1);
    expect(a.preservesPitch).toBe(true);
    expect(b.getAttribute('src')).toBeNull();
    expect(b.volume).toBe(1);
  });

  it('mantém play/pause independentes por elemento', async () => {
    const a = fakeAudio();
    const b = fakeAudio();

    expect(await playDeckAudio(a)).toBe(true);
    expect(a.paused).toBe(false);
    expect(b.paused).toBe(true);

    pauseDeckAudio(a);
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
  });

  it('mantém seek, rate e volume independentes por elemento', () => {
    const a = fakeAudio();
    const b = fakeAudio();

    seekDeckAudio(a, 42);
    setDeckPlaybackRate(a, 1.03);
    setDeckVolume(a, 0.25);

    seekDeckAudio(b, 90);
    setDeckPlaybackRate(b, 0.97);
    setDeckVolume(b, 0.8);

    expect(a.currentTime).toBe(42);
    expect(a.playbackRate).toBe(1.03);
    expect(a.volume).toBe(0.25);
    expect(b.currentTime).toBe(90);
    expect(b.playbackRate).toBe(0.97);
    expect(b.volume).toBe(0.8);
  });

  it('faz clamp de seek e volume sem contaminar playbackRate', () => {
    const audio = fakeAudio();

    expect(seekDeckAudio(audio, -5)).toBe(0);
    expect(seekDeckAudio(audio, 999)).toBe(180);
    expect(setDeckVolume(audio, -1)).toBe(0);
    expect(setDeckVolume(audio, 4)).toBe(1);
    expect(setDeckPlaybackRate(audio, 0)).toBe(1);
  });

  it('limpa somente o deck solicitado', () => {
    const a = fakeAudio();
    const b = fakeAudio();
    loadDeckAudio(a, '/track-a.mp3');
    loadDeckAudio(b, '/track-b.mp3');

    clearDeckAudio(a);

    expect(a.getAttribute('src')).toBeNull();
    expect(a.volume).toBe(0);
    expect(a.playbackRate).toBe(1);
    expect(b.getAttribute('src')).toBe('/track-b.mp3');
  });

  it('mantém erro isolado no snapshot do deck afetado', () => {
    const a = fakeAudio();
    const b = fakeAudio();
    Object.defineProperty(a, 'error', {
      value: { code: 3 },
      configurable: true
    });

    expect(readDeckAudioSnapshot('a', 'track-a', a).errorCode).toBe(3);
    expect(readDeckAudioSnapshot('b', 'track-b', b).errorCode).toBeNull();
  });

  it('gera snapshot isolado e serializável', async () => {
    const audio = fakeAudio();
    loadDeckAudio(audio, '/track-a.mp3', { volume: 0.4 });
    await audio.play();
    seekDeckAudio(audio, 12);
    setDeckPlaybackRate(audio, 1.02);

    const snapshot = readDeckAudioSnapshot('a', 'track-a', audio);

    expect(snapshot).toEqual({
      deck: 'a',
      trackId: 'track-a',
      source: '/track-a.mp3',
      playing: true,
      currentTimeSeconds: 12,
      durationSeconds: 180,
      playbackRate: 1.02,
      volume: 0.4,
      errorCode: null
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
