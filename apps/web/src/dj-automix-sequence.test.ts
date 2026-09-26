import { describe, expect, it } from 'vitest';
import {
  canPrepareDjAutomixNext,
  nextDjAutomixIndex,
  shouldRecoverDjAutomixAfterEnded,
  shuffleDjTrackList
} from './dj-automix-sequence';

describe('DJ AutoMix sequence', () => {
  it('segue a ordem atual e reinicia no começo para manter AutoMix contínuo', () => {
    expect(nextDjAutomixIndex(3, -1)).toBe(0);
    expect(nextDjAutomixIndex(3, 0)).toBe(1);
    expect(nextDjAutomixIndex(3, 1)).toBe(2);
    expect(nextDjAutomixIndex(3, 2)).toBe(0);
  });

  it('repete a única faixa quando a origem possui apenas uma música', () => {
    expect(nextDjAutomixIndex(1, 0)).toBe(0);
  });

  it('embaralha somente os itens recebidos sem mutar a origem', () => {
    const source = ['a', 'b', 'c', 'd'];
    const values = [0, 0.9, 0.2];
    let index = 0;
    const shuffled = shuffleDjTrackList(source, () => values[index++] ?? 0.5);

    expect(source).toEqual(['a', 'b', 'c', 'd']);
    expect(shuffled).toHaveLength(source.length);
    expect(new Set(shuffled)).toEqual(new Set(source));
    expect(shuffled).not.toEqual(source);
  });

  it('não cria próxima faixa para origem vazia', () => {
    expect(nextDjAutomixIndex(0, -1)).toBeNull();
  });

  it('recupera AutoMix quando o deck termina sem handoff', () => {
    expect(shouldRecoverDjAutomixAfterEnded({
      automixActive: true,
      transitionActive: false,
      hasTrack: true,
      playing: false,
      currentTimeSeconds: 179.95,
      durationSeconds: 180
    })).toBe(true);
  });

  it('não dispara recovery durante reprodução ou transição normal', () => {
    const base = {
      automixActive: true,
      transitionActive: false,
      hasTrack: true,
      playing: false,
      currentTimeSeconds: 179.95,
      durationSeconds: 180
    };
    expect(shouldRecoverDjAutomixAfterEnded({ ...base, playing: true })).toBe(false);
    expect(shouldRecoverDjAutomixAfterEnded({ ...base, transitionActive: true })).toBe(false);
    expect(shouldRecoverDjAutomixAfterEnded({ ...base, currentTimeSeconds: 120 })).toBe(false);
  });
});


describe('DJ AutoMix handoff guard', () => {
  const valid = {
    automixActive: true,
    transitionActive: false,
    activeDeckMatches: true,
    queueIndexMatches: true,
    activeTrackMatches: true,
    activeDeckPlaying: true
  };

  it('só permite preload depois que o deck novo foi adotado e continua tocando', () => {
    expect(canPrepareDjAutomixNext(valid)).toBe(true);
  });

  it.each([
    ['AutoMix desligado', { automixActive: false }],
    ['transição ainda ativa', { transitionActive: true }],
    ['deck ativo mudou', { activeDeckMatches: false }],
    ['índice mudou', { queueIndexMatches: false }],
    ['track ativa mudou', { activeTrackMatches: false }],
    ['deck ativo parou', { activeDeckPlaying: false }]
  ])('bloqueia preload quando %s', (_label, override) => {
    expect(canPrepareDjAutomixNext({ ...valid, ...override })).toBe(false);
  });
});
