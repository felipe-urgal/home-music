import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  backgroundFetchFailureMessage,
  backgroundFetchRegistrationId,
  isAndroidBackgroundFetchRuntime,
  supportsBackgroundFetchCapability
} from './offline-background-fetch';

const serviceWorkerSource = () => readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

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

  it('limita o caminho experimental ao runtime Android', () => {
    expect(isAndroidBackgroundFetchRuntime('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36')).toBe(true);
    expect(isAndroidBackgroundFetchRuntime('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/140 Safari/537.36')).toBe(false);
    expect(isAndroidBackgroundFetchRuntime('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36')).toBe(false);
    expect(isAndroidBackgroundFetchRuntime('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile Safari/604.1')).toBe(false);
  });

  it('mantém a gravação do worker vinculada a um client ativo da conta', () => {
    const sw = serviceWorkerSource();
    expect(sw).toContain('async function hasActiveOfflineUserClient(userId)');
    expect(sw).toContain('if (!await hasActiveOfflineUserClient(scope.userId)) return;');
    expect(sw).toContain("self.addEventListener('backgroundfetchsuccess'");
    expect(sw).toContain('version: 4');
  });

  it('traduz falha de quota sem anunciar sucesso', () => {
    expect(backgroundFetchFailureMessage('quota-exceeded')).toContain('armazenamento');
    expect(backgroundFetchFailureMessage('aborted')).toContain('cancelado');
    expect(backgroundFetchFailureMessage('fetch-error')).toContain('conexão');
  });
});
