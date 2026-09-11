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
});
