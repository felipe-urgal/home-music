import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('crossfade handoff', () => {
  it('adota o deck que já está tocando antes de avançar a faixa canônica', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');
    const adopt = crossfade.indexOf('player.adoptAudioSource(candidate.trackId, incomingAudio);');
    const advance = crossfade.indexOf('player.audioHandlers.onEnded();', adopt);

    expect(adopt).toBeGreaterThanOrEqual(0);
    expect(advance).toBeGreaterThan(adopt);
    expect(crossfade).not.toContain('shadowAudio');
  });

  it('pula src/load quando a nova faixa já foi adotada', () => {
    const player = source('useAudioPlayer.ts');
    const adoption = player.indexOf('const adoptedSource = adoptedAudioSourceRef.current;');
    const normalLoad = player.indexOf('audio.src = offlineMode', adoption);
    const adoptionReturn = player.indexOf('return;', adoption);

    expect(adoption).toBeGreaterThanOrEqual(0);
    expect(adoptionReturn).toBeGreaterThan(adoption);
    expect(normalLoad).toBeGreaterThan(adoptionReturn);
    expect(player).toContain('positionRef.current = audio.currentTime;');
    expect(player).toContain('setCurrentTime(audio.currentTime);');
  });

  it('não cancela o handoff quando pause antecede ended no fim natural', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');
    const pauseHandler = crossfade.slice(
      crossfade.indexOf('const handleDeckPause'),
      crossfade.indexOf('const togglePlay')
    );
    const completionGuard = pauseHandler.indexOf('isCrossfadeCompletionPause({');
    const canonicalPause = pauseHandler.indexOf('player.audioHandlers.onPause();');

    expect(completionGuard).toBeGreaterThanOrEqual(0);
    expect(canonicalPause).toBeGreaterThan(completionGuard);
  });

  it('mantém o envelope do fade preso à timeline de saída para suportar playbackRate no deck de entrada', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    expect(crossfade).toContain('candidate.durationSeconds - remainingSeconds');
    expect(crossfade).not.toContain('incomingAudio.currentTime / candidate.durationSeconds');
  });

  it('usa a rota offline no deck de entrada quando o player está em offlineMode', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    expect(crossfade).toContain("import { offlineAudioUrl } from './offline-downloads';");
    expect(crossfade).toContain('const offlineMode = Boolean(options.offlineMode);');
    expect(crossfade).toContain('const incomingTrackSource = useCallback');
    expect(crossfade).toContain('? offlineAudioUrl(track.id)');
  });

  it('aplica beatmatch somente com fase curta e restaura playbackRate após o handoff', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    expect(crossfade).toContain('resolveBeatmatchPlan({');
    expect(crossfade).toContain('canPhaseAlignBeatmatch(beatmatchPlan)');
    expect(crossfade).toContain('incomingAudio.readyState >= 1');
    expect(crossfade).toContain('incomingAudio.currentTime = nextTrack.rhythm.firstBeatSeconds');
    expect(crossfade).toContain('incomingAudio.playbackRate = beatmatchPlan.playbackRate');
    expect(crossfade).toContain('restorePlaybackRate(incomingAudio);');
    expect(crossfade).toContain('audio.playbackRate = 1;');
  });

  it('mantém Apple mobile WebKit fora do fluxo de dois decks', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');
    const platformGuard = crossfade.indexOf('if (isAppleMobileWebKit(navigator)) return;');
    const candidate = crossfade.indexOf('const candidate = resolveCrossfadeCandidate({', platformGuard);

    expect(platformGuard).toBeGreaterThanOrEqual(0);
    expect(candidate).toBeGreaterThan(platformGuard);
  });

  it('cancela timers, estado visual e playbackRate quando a transição é invalidada', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');
    const cancel = crossfade.slice(
      crossfade.indexOf('const cancelCrossfade = useCallback'),
      crossfade.indexOf('useLayoutEffect(() => {', crossfade.indexOf('const cancelCrossfade = useCallback'))
    );

    expect(cancel).toContain('attemptRef.current += 1;');
    expect(cancel).toContain('cancelAnimation();');
    expect(cancel).toContain('cancelQuantizedSchedule();');
    expect(cancel).toContain('cancelQuantizedWake();');
    expect(cancel).toContain('cancelPlaybackRateRestore();');
    expect(cancel).toContain('preparedIncomingTrackIdRef.current = null;');
    expect(cancel).toContain('originTrackIdRef.current = null;');
    expect(cancel).toContain('startingTrackIdRef.current = null;');
    expect(cancel).toContain('incomingTrackIdRef.current = null;');
    expect(cancel).toContain('clearCrossfadeVisualState();');
    expect(cancel).toContain('activeAudio.playbackRate = 1;');
    expect(cancel).toContain('clearAudio(inactiveAudio);');
  });

  it('faz pause, seek, next, previous e playTrack passarem pelo cancelamento manual', () => {
    const player = source('useAudioPlayer.ts');

    for (const [startMarker, endMarker] of [
      ['const pause = useCallback', 'const togglePlay = useCallback'],
      ['const next = useCallback', 'const previous = useCallback'],
      ['const previous = useCallback', 'const seek = useCallback'],
      ['const seek = useCallback', 'const setVolume = useCallback'],
      ['const playTrack = useCallback', 'const toggleShuffle = useCallback']
    ]) {
      const block = player.slice(player.indexOf(startMarker), player.indexOf(endMarker));
      expect(block).toContain('beforeManualChange();');
    }
  });

  it('cancela a transição antes de alterar controles que invalidam o plano rítmico', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    for (const [startMarker, endMarker] of [
      ['const togglePlay = useCallback', 'const setStreamingMode = useCallback'],
      ['const setStreamingMode = useCallback', 'const setNormalizationMode = useCallback'],
      ['const setNormalizationMode = useCallback', 'const toggleShuffle = useCallback'],
      ['const toggleShuffle = useCallback', 'const cycleRepeat = useCallback'],
      ['const cycleRepeat = useCallback', 'const reorderQueue = useCallback'],
      ['const reorderQueue = useCallback', 'return {']
    ]) {
      const block = crossfade.slice(crossfade.indexOf(startMarker), crossfade.indexOf(endMarker));
      expect(block).toContain('cancelCrossfade();');
    }
  });

  it('arma a fronteira rítmica por timeout e usa rAF somente perto do beat', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    expect(crossfade).toContain('quantizedWakeTimeoutRef');
    expect(crossfade).toContain('(timeUntilStart - QUANTIZED_CROSSFADE_ARM_SECONDS) * 1_000');
    expect(crossfade).toContain('quantizedWakeTimeoutRef.current = window.setTimeout');
    expect(crossfade).toContain('maybeStartCrossfade(latestAudio);');
    expect(crossfade).toContain('quantizedScheduleFrameRef.current = window.requestAnimationFrame(watchBeatBoundary);');
    expect(crossfade).toContain('if (!player.playing) return;');
    expect(crossfade).toContain('maybeStartCrossfade(activeAudio);');
  });

  it('invalida transição ao ir para background, trocar faixa ou pausar', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');

    expect(crossfade).toContain("if (document.visibilityState !== 'visible') cancelCrossfade();");
    expect(crossfade).toContain('if (originTrackId && originTrackId !== currentTrackId) cancelCrossfade();');
    expect(crossfade).toContain('!player.playing');
    expect(crossfade).toContain('quantizedScheduleFrameRef.current != null');
    expect(crossfade).toContain('cancelCrossfade();');
  });

  it('limpa frames, estado visual e os dois decks no unmount', () => {
    const crossfade = source('useCrossfadeAudioPlayer.ts');
    const cleanupStart = crossfade.indexOf('useEffect(() => () => {');
    const cleanupEnd = crossfade.indexOf('const setCrossfadeSeconds', cleanupStart);
    const cleanup = crossfade.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanup).toContain('attemptRef.current += 1;');
    expect(cleanup).toContain('cancelAnimation();');
    expect(cleanup).toContain('cancelQuantizedSchedule();');
    expect(cleanup).toContain('cancelPlaybackRateRestore();');
    expect(cleanup).toContain('clearCrossfadeVisualState();');
    expect(cleanup).toContain('clearAudio(deckARef.current);');
    expect(cleanup).toContain('clearAudio(deckBRef.current);');
  });

  it('monta os mesmos dois decks no OfflineApp sem criar outro player canônico', () => {
    const offlineApp = source('OfflineApp.tsx');

    expect(offlineApp).toContain('const player = useCrossfadeAudioPlayer(');
    expect(offlineApp).toContain('{ offlineMode: true }');
    expect(offlineApp).toContain('ref={player.deckARef}');
    expect(offlineApp).toContain('ref={player.deckBRef}');
    expect(offlineApp).not.toContain('const player = useAudioPlayer(');
  });
});
