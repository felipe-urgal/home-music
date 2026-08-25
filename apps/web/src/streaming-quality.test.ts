import { describe, expect, it } from 'vitest';
import {
  detectNetwork,
  directAudioUrl,
  effectiveNormalizationMode,
  NETWORK_PREFERENCE_STORAGE_KEY,
  NORMALIZATION_MODE_STORAGE_KEY,
  onlineAudioUrl,
  parseNetworkPreference,
  parseNormalizationMode,
  parseStreamingMode,
  parseStreamingSelection,
  readNetworkPreference,
  readNormalizationMode,
  readStreamingMode,
  readStreamingSelection,
  resolveNetworkStreamingMode,
  resolveReplayGain,
  shouldFallbackToOriginal,
  shouldRetryWithCompatibilityTranscode,
  STREAMING_MODE_STORAGE_KEY,
  STREAMING_SELECTION_STORAGE_KEY,
  transcodedAudioUrl,
  writeNetworkPreference,
  writeNormalizationMode,
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
    expect(onlineAudioUrl('abc', 'auto', false, 'track')).toBe('/api/tracks/abc/transcode?quality=high&normalization=track');
    expect(onlineAudioUrl('abc', 'economy', false, 'album')).toBe('/api/tracks/abc/transcode?quality=economy&normalization=album');
  });


  it('resolve ReplayGain com fallback de álbum e desativa quando não há tag', () => {
    const track = {
      id: 'a', title: 'A', artist: 'B', album: 'C', albumArtist: 'B',
      folder: 'F', folderPath: '', duration: 10, format: 'MP3', hasCover: false,
      replayGainTrackDb: -7.2, replayGainAlbumDb: -5.8
    };

    expect(resolveReplayGain(track, 'track')).toBe(-7.2);
    expect(resolveReplayGain(track, 'album')).toBe(-5.8);
    expect(effectiveNormalizationMode(track, 'album')).toBe('album');
    expect(resolveReplayGain({ ...track, replayGainAlbumDb: null }, 'album')).toBe(-7.2);
    expect(effectiveNormalizationMode({ ...track, replayGainTrackDb: null, replayGainAlbumDb: null }, 'track')).toBe('off');
    expect(parseNormalizationMode('inválido')).toBe('off');
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
    expect(readNormalizationMode(storage)).toBe('off');

    writeStreamingMode(storage, 'economy');
    writeStreamingSelection(storage, 'network');
    writeNetworkPreference(storage, 'mobile');
    writeNormalizationMode(storage, 'album');

    expect(values.get(STREAMING_MODE_STORAGE_KEY)).toBe('economy');
    expect(values.get(STREAMING_SELECTION_STORAGE_KEY)).toBe('network');
    expect(values.get(NETWORK_PREFERENCE_STORAGE_KEY)).toBe('mobile');
    expect(values.get(NORMALIZATION_MODE_STORAGE_KEY)).toBe('album');
    expect(readStreamingMode(storage)).toBe('economy');
    expect(readStreamingSelection(storage)).toBe('network');
    expect(readNetworkPreference(storage)).toBe('mobile');
    expect(readNormalizationMode(storage)).toBe('album');
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
    expect(() => writeNormalizationMode(broken, 'track')).not.toThrow();
  });
});
