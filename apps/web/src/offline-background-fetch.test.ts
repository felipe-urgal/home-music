import { describe, expect, it } from 'vitest';
import {
  backgroundFetchFailureMessage,
  backgroundFetchRegistrationId
} from './offline-background-fetch';

describe('offline background fetch', () => {
  it('escopa a registration por usuário e faixa', () => {
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).toBe('home-music-offline-v1:user-a:track-1');
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).not.toBe(backgroundFetchRegistrationId('user-b', 'track-1'));
    expect(backgroundFetchRegistrationId('user-a', 'track-1')).not.toBe(backgroundFetchRegistrationId('user-a', 'track-2'));
  });

  it('traduz falha de quota sem anunciar sucesso', () => {
    expect(backgroundFetchFailureMessage('quota-exceeded')).toContain('armazenamento');
    expect(backgroundFetchFailureMessage('aborted')).toContain('cancelado');
    expect(backgroundFetchFailureMessage('fetch-error')).toContain('conexão');
  });
});
