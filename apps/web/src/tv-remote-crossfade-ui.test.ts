import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('tv remote crossfade controls', () => {
  it('expõe todos os valores inteiros de 0 a 30 e aguarda confirmação da TV', () => {
    const remote = source('components/TvRemoteControlScreen.tsx');
    const styles = source('tv-remote.css');
    const shared = source('../../../packages/shared/src/tv-remote.ts');

    expect(remote).toContain('TV_REMOTE_CROSSFADE_MAX_SECONDS');
    expect(remote).toMatch(/Array\.from\(\{\s*length:\s*TV_REMOTE_CROSSFADE_MAX_SECONDS\s*\+\s*1\s*\}/);
    expect(remote).toContain('useRemoteCrossfade');
    expect(remote).toContain('crossfade.pending !== null');
    expect(remote).toContain('Aguardando a TV');
    expect(remote).toContain('<select');
    expect(styles).toContain('.tv-remote-crossfade select');
    expect(shared).toContain('TV_REMOTE_CROSSFADE_MAX_SECONDS = 30');
    expect(shared).toContain('value.lastAppliedCrossfadeCommandId >= 0');
  });
});
