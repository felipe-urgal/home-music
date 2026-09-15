import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('tv remote crossfade controls', () => {
  it('expõe os presets suportados e envia set-crossfade somente quando disponível', () => {
    const remote = source('components/TvRemoteControlScreen.tsx');
    const styles = source('tv-remote.css');

    expect(remote).toMatch(/crossfadeControlAvailable\s*&&/);
    expect(remote).toMatch(/tvCrossfadeOptions\(crossfadeSeconds\)\.map/);
    expect(remote).toMatch(/type:\s*['"]set-crossfade['"]/);
    expect(remote).toContain('disabled={crossfadeControlsDisabled}');
    expect(styles).toContain('.tv-remote-crossfade');
    expect(styles).toContain('.tv-remote-crossfade button.is-active');
  });
});
