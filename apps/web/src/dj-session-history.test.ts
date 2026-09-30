import { describe, expect, it } from 'vitest';
import {
  buildDjSessionSetlist,
  createDjSessionHistoryState,
  djSessionSetlistEntries,
  finalizeDjSession,
  observeDjSession,
  parseDjSessionHistory
} from './dj-session-history';

const track = (id: string, title = id) => ({
  id,
  title,
  artist: 'Artista'
});

describe('DJ session history', () => {
  it('registra ordem realmente audível alternando decks', () => {
    let state = createDjSessionHistoryState();

    state = observeDjSession(state, [
      { deck: 'a', track: track('a1'), playing: true, outputGain: 1 },
      { deck: 'b', track: track('b1'), playing: false, outputGain: 0 }
    ], 1_000);

    state = observeDjSession(state, [
      { deck: 'a', track: track('a1'), playing: true, outputGain: 0 },
      { deck: 'b', track: track('b1'), playing: true, outputGain: 1 }
    ], 6_000);

    expect(djSessionSetlistEntries(state).map(entry => entry.trackId)).toEqual(['a1', 'b1']);
    expect(djSessionSetlistEntries(state)[0]?.playedSeconds).toBe(5);
  });

  it('ignora play curto que nunca ficou audível no master', () => {
    let state = createDjSessionHistoryState();
    state = observeDjSession(state, [
      { deck: 'a', track: track('cue'), playing: true, outputGain: 0 }
    ], 1_000);
    state = observeDjSession(state, [
      { deck: 'a', track: track('cue'), playing: false, outputGain: 0 }
    ], 1_400);

    expect(djSessionSetlistEntries(state)).toHaveLength(0);
  });

  it('trata a mesma faixa carregada novamente como nova ocorrência', () => {
    let state = createDjSessionHistoryState();
    state = observeDjSession(state, [
      { deck: 'a', track: track('same'), playing: true, outputGain: 1 }
    ], 1_000);
    state = observeDjSession(state, [
      { deck: 'a', track: track('other'), playing: true, outputGain: 1 }
    ], 4_000);
    state = observeDjSession(state, [
      { deck: 'a', track: track('same'), playing: true, outputGain: 1 }
    ], 7_000);

    expect(djSessionSetlistEntries(state).map(entry => entry.trackId)).toEqual([
      'same',
      'other',
      'same'
    ]);
  });

  it('usa o mesmo fluxo de observação independentemente de Manual ou AutoMix', () => {
    let manual = createDjSessionHistoryState();
    let automix = createDjSessionHistoryState();
    const observations = [
      { deck: 'b' as const, track: track('mix'), playing: true, outputGain: 0.7 }
    ];

    manual = observeDjSession(manual, observations, 10_000);
    automix = observeDjSession(automix, observations, 10_000);

    expect(automix).toEqual(manual);
  });

  it('finaliza duração ao sair e preserva estado serializado para reentrada', () => {
    let state = createDjSessionHistoryState();
    state = observeDjSession(state, [
      { deck: 'a', track: track('persistida'), playing: true, outputGain: 1 }
    ], 1_000);
    state = finalizeDjSession(state, 11_000);

    const restored = parseDjSessionHistory(JSON.stringify(state));
    expect(restored.entries[0]?.endedAt).toBe(11_000);
    expect(restored.entries[0]?.playedSeconds).toBe(10);
    expect(buildDjSessionSetlist(restored)).toContain('persistida');
  });

  it('cai para sessão vazia quando storage está inválido', () => {
    expect(parseDjSessionHistory('{invalid')).toEqual(createDjSessionHistoryState());
  });
});
