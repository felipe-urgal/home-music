import { describe, expect, it } from 'vitest';
import { isTvRemotePlaybackFresh } from './tv-remote-presence';

describe('isTvRemotePlaybackFresh', () => {
  it('aceita snapshots recentes enquanto o transporte está aberto', () => {
    expect(isTvRemotePlaybackFresh('open', 10_000, 25_000)).toBe(true);
  });

  it('considera a TV desconectada após dois heartbeats perdidos', () => {
    expect(isTvRemotePlaybackFresh('open', 10_000, 40_001)).toBe(false);
  });

  it('não confunde conexão ao servidor com presença da TV', () => {
    expect(isTvRemotePlaybackFresh('open', null, 10_000)).toBe(false);
    expect(isTvRemotePlaybackFresh('error', 9_000, 10_000)).toBe(false);
  });
});
