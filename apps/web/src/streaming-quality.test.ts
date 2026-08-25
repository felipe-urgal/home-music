import { describe, expect, it } from 'vitest';
import {
  detectNetwork,
  directAudioUrl,
  NETWORK_PREFERENCE_STORAGE_KEY,
  onlineAudioUrl,
  parseNetworkPreference,
  parseStreamingMode,
  parseStreamingSelection,
  readNetworkPreference,
  readStreamingMode,
  readStreamingSelection,
  resolveNetworkStreamingMode,
  shouldFallbackToOriginal,
  shouldRetryWithCompatibilityTranscode,
  STREAMING_MODE_STORAGE_KEY,
  STREAMING_SELECTION_STORAGE_KEY,
  transcodedAudioUrl,
  writeNetworkPreference,
  writeStreamingMode,
  writeStreamingSelection
} from './streaming-quality';

describe('streaming quality', () => {
  it('mantém modos válidos e usa auto como fallback', () => {
    expect(parseStreamingMode('auto')).toBe('auto');
    expect(parseStreamingMode('original')).toBe('original');
    expect(parseStreamingMode('economy')).toBe('economy');
    expect(parseStreamingMode('network')).toBe('auto');
    expect(parseStreamingMode(null)).toBe('auto');

    expect(parseStreamingSelection('network')).toBe('network');
    expect(parseStreamingSelection('economy')).toBe('economy');
    expect(parseStreamingSelection('qualquer')).toBe('auto');
  });

  it('detecta apenas sinais confiáveis de rede', () => {
    expect(detectNetwork({ type: 'wifi' })).toBe('wifi');
    expect(detectNetwork({ type: 'ethernet' })).toBe('wifi');
    expect(detectNetwork({ type: 'cellular' })).toBe('mobile');
    expect(detectNetwork({ saveData: true })).toBe('mobile');
    expect(detectNetwork({ effectiveType: '3g' })).toBe('mobile');
    expect(detectNetwork({ effectiveType: '4g' })).toBe('unknown');
    expect(detectNetwork(undefined)).toBe('unknown');
  });

  it('resolve perfil por conexão sem adivinhar rede desconhecida', () => {
    expect(resolveNetworkStreamingMode('wifi', 'unknown')).toBe('auto');
    expect(resolveNetworkStreamingMode('mobile', 'unknown')).toBe('economy');
    expect(resolveNetworkStreamingMode('auto', 'wifi')).toBe('auto');
    expect(resolveNetworkStreamingMode('auto', 'mobile')).toBe('economy');
    expect(resolveNetworkStreamingMode('auto', 'unknown')).toBe('auto');
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

  it('persiste qualidade, seleção e preferência de rede tolerando storage indisponível', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };

    expect(readStreamingMode(storage)).toBe('auto');
    expect(readStreamingSelection(storage)).toBe('auto');
    expect(readNetworkPreference(storage)).toBe('auto');

    writeStreamingMode(storage, 'economy');
    writeStreamingSelection(storage, 'network');
    writeNetworkPreference(storage, 'mobile');

    expect(values.get(STREAMING_MODE_STORAGE_KEY)).toBe('economy');
    expect(values.get(STREAMING_SELECTION_STORAGE_KEY)).toBe('network');
    expect(values.get(NETWORK_PREFERENCE_STORAGE_KEY)).toBe('mobile');
    expect(readStreamingMode(storage)).toBe('economy');
    expect(readStreamingSelection(storage)).toBe('network');
    expect(readNetworkPreference(storage)).toBe('mobile');
    expect(parseNetworkPreference('wifi')).toBe('wifi');
    expect(parseNetworkPreference('qualquer')).toBe('auto');

    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    expect(readStreamingMode(broken)).toBe('auto');
    expect(readStreamingSelection(broken)).toBe('auto');
    expect(readNetworkPreference(broken)).toBe('auto');
    expect(() => writeStreamingMode(broken, 'original')).not.toThrow();
    expect(() => writeStreamingSelection(broken, 'network')).not.toThrow();
    expect(() => writeNetworkPreference(broken, 'wifi')).not.toThrow();
  });
});
