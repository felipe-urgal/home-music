import { describe, expect, it } from 'vitest';
import {
  directAudioUrl,
  onlineAudioUrl,
  parseStreamingMode,
  readStreamingMode,
  shouldFallbackToOriginal,
  shouldRetryWithCompatibilityTranscode,
  STREAMING_MODE_STORAGE_KEY,
  transcodedAudioUrl,
  writeStreamingMode
} from './streaming-quality';

describe('streaming quality', () => {
  it('mantém modos válidos e usa auto como fallback', () => {
    expect(parseStreamingMode('auto')).toBe('auto');
    expect(parseStreamingMode('original')).toBe('original');
    expect(parseStreamingMode('economy')).toBe('economy');
    expect(parseStreamingMode('qualquer')).toBe('auto');
    expect(parseStreamingMode(null)).toBe('auto');
  });

  it('mantém streaming direto como padrão e transcoding explícito', () => {
    expect(directAudioUrl('abc 123')).toBe('/api/tracks/abc%20123/stream');
    expect(transcodedAudioUrl('abc', 'economy')).toBe('/api/tracks/abc/transcode?quality=economy');
    expect(onlineAudioUrl('abc', 'auto')).toBe('/api/tracks/abc/stream');
    expect(onlineAudioUrl('abc', 'original')).toBe('/api/tracks/abc/stream');
    expect(onlineAudioUrl('abc', 'economy')).toBe('/api/tracks/abc/transcode?quality=economy');
    expect(onlineAudioUrl('abc', 'auto', true)).toBe('/api/tracks/abc/transcode?quality=balanced');
  });

  it('só usa fallback adaptativo em erro de decode/formato', () => {
    expect(shouldRetryWithCompatibilityTranscode('auto', 3)).toBe(true);
    expect(shouldRetryWithCompatibilityTranscode('auto', 4)).toBe(true);
    expect(shouldRetryWithCompatibilityTranscode('auto', 2)).toBe(false);
    expect(shouldRetryWithCompatibilityTranscode('original', 4)).toBe(false);
    expect(shouldFallbackToOriginal('economy', 4)).toBe(true);
    expect(shouldFallbackToOriginal('economy', 2)).toBe(false);
  });

  it('tolera storage indisponível', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };

    expect(readStreamingMode(storage)).toBe('auto');
    writeStreamingMode(storage, 'economy');
    expect(values.get(STREAMING_MODE_STORAGE_KEY)).toBe('economy');
    expect(readStreamingMode(storage)).toBe('economy');

    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    expect(readStreamingMode(broken)).toBe('auto');
    expect(() => writeStreamingMode(broken, 'original')).not.toThrow();
  });
});
