import { describe, expect, it } from 'vitest';
import {
  backgroundFetchFailureMessage,
  backgroundFetchRegistrationId,
  supportsBackgroundFetchCapability
} from './offline-background-fetch';

describe('offline background fetch', () => {
  it('escopa a registration por usuário e faixa', () => {
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).toBe('home-music-offline-v1:user-a:track-1');
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).not.toBe(backgroundFetchRegistrationId('user-b', 'track-1'));
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).not.toBe(backgroundFetchRegistrationId('user-a', 'track-2'));
  });

  it('só habilita background fetch com capability v4 completa', () => {
    expect(supportsBackgroundFetchCapability({
      type: 'HOME_MUSIC_CAPABILITIES',
      version: 4,
      offlineAudio: true,
      backgroundFetch: true
    })).toBe(true);

    expect(supportsBackgroundFetchCapability({
      type: 'HOME_MUSIC_CAPABILITIES',
      version: 3,
      offlineAudio: true,
      backgroundFetch: true
    })).toBe(false);

    expect(supportsBackgroundFetchCapability({
      type: 'HOME_MUSIC_CAPABILITIES',
      version: 4,
      offlineAudio: true,
      backgroundFetch: false
    })).toBe(false);

    expect(supportsBackgroundFetchCapability(null)).toBe(false);
  });

  it('traduz falha de quota sem anunciar sucesso', () => {
    expect(backgroundFetchFailureMessage('quota-exceeded')).toContain('armazenamento');
    expect(backgroundFetchFailureMessage('aborted')).toContain('cancelado');
    expect(backgroundFetchFailureMessage('fetch-error')).toContain('conexão');
  });
});
