import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('tv experience controls', () => {
  it('usa a capa atual como play/pause e a área A seguir como avanço manual', () => {
    const component = source('components/TvExperience.tsx');
    const app = source('AuthenticatedApp.tsx');

    expect(component).toContain('className="tv-now-playing__art"');
    expect(component).toContain('data-tv-primary');
    expect(component).toContain('onClick={onTogglePlay}');
    expect(component).toContain('aria-pressed={playing}');
    expect(component).toContain('className="tv-now-playing__next"');
    expect(component).toContain('onClick={onNext}');
    expect(app).toMatch(
      /nextTrackDecision\(player\.queue,\s*player\.currentIndex,\s*player\.repeatMode,\s*false\)/
    );
  });

  it('não mantém os controles visuais separados nem o fundo preto sólido', () => {
    const component = source('components/TvExperience.tsx');
    const styles = source('tv-now-playing.css');
    const photoStyles = source('tv-photo-background.css');

    expect(component).toContain("import turntablePhoto from '../assets/tv-turntable.webp'");
    expect(component).toContain('className="tv-now-playing__photo"');
    expect(photoStyles).toContain('.tv-now-playing__photo[data-loaded="true"]');
    expect(component).not.toContain('SkipBack');
    expect(component).not.toContain('SkipForward');
    expect(component).not.toContain('tv-now-playing__controls');
    expect(component).not.toContain('fill="#05090d"');
    expect(styles).not.toContain('background: #05090d;');
  });
});
