import { describe, expect, it } from 'vitest';
import {
  createEmptyDjControllerSnapshot,
  DJ_CONTROLLER_MVP_CAPABILITIES,
  isDjControllerCommand
} from './dj-controller-contract';

describe('DJ controller contract', () => {
  it('mantém decks A/B independentes e um snapshot serializável', () => {
    const snapshot = createEmptyDjControllerSnapshot();

    expect(snapshot.decks.a).not.toBe(snapshot.decks.b);
    expect(snapshot.primaryPlaybackDeck).toBeNull();
    expect(snapshot.mixer.crossfader).toBe(0);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('expõe explicitamente as capabilities do MVP', () => {
    expect(DJ_CONTROLLER_MVP_CAPABILITIES).toEqual({
      loadTrack: true,
      transport: true,
      cue: true,
      seek: true,
      nudge: true,
      tempo: true,
      beatSync: true,
      channelVolume: true,
      crossfader: true,
      libraryBrowser: true
    });
  });

  it('aceita comandos neutros de deck, mixer e browser', () => {
    expect(isDjControllerCommand({ type: 'deck.load', deck: 'a', trackId: 'track-1' })).toBe(true);
    expect(isDjControllerCommand({ type: 'deck.play', deck: 'b' })).toBe(true);
    expect(isDjControllerCommand({ type: 'deck.seek', deck: 'a', seconds: 42 })).toBe(true);
    expect(isDjControllerCommand({ type: 'deck.nudge', deck: 'b', delta: -0.01 })).toBe(true);
    expect(isDjControllerCommand({
      type: 'deck.sync',
      deck: 'b',
      masterDeck: 'a'
    })).toBe(true);
    expect(isDjControllerCommand({
      type: 'mixer.set-channel-volume',
      deck: 'a',
      value: 0.5
    })).toBe(true);
    expect(isDjControllerCommand({ type: 'mixer.set-crossfader', value: -0.75 })).toBe(true);
    expect(isDjControllerCommand({ type: 'browser.move', delta: 1 })).toBe(true);
    expect(isDjControllerCommand({ type: 'browser.select' })).toBe(true);
    expect(isDjControllerCommand({ type: 'browser.load', deck: 'b' })).toBe(true);
  });

  it('rejeita comandos inválidos antes que cheguem à engine de playback', () => {
    expect(isDjControllerCommand(null)).toBe(false);
    expect(isDjControllerCommand({ type: 'deck.play', deck: 'left' })).toBe(false);
    expect(isDjControllerCommand({ type: 'deck.load', deck: 'a', trackId: '   ' })).toBe(false);
    expect(isDjControllerCommand({ type: 'deck.seek', deck: 'a', seconds: -1 })).toBe(false);
    expect(isDjControllerCommand({ type: 'deck.nudge', deck: 'a', delta: 0 })).toBe(false);
    expect(isDjControllerCommand({
      type: 'deck.sync',
      deck: 'a',
      masterDeck: 'a'
    })).toBe(false);
    expect(isDjControllerCommand({
      type: 'mixer.set-channel-volume',
      deck: 'a',
      value: 1.1
    })).toBe(false);
    expect(isDjControllerCommand({ type: 'mixer.set-crossfader', value: 2 })).toBe(false);
    expect(isDjControllerCommand({ type: 'browser.move', delta: 0 })).toBe(false);
    expect(isDjControllerCommand({ type: 'midi.message', bytes: [144, 1, 127] })).toBe(false);
  });

  it('não compartilha referências mutáveis entre snapshots ou decks', () => {
    const first = createEmptyDjControllerSnapshot();
    const second = createEmptyDjControllerSnapshot();

    first.decks.a.sync.active = true;
    first.capabilities.cue = false;

    expect(first.decks.b.sync.active).toBe(false);
    expect(second.decks.a.sync.active).toBe(false);
    expect(second.capabilities.cue).toBe(true);
  });
});
