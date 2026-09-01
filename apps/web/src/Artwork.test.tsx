import { renderToStaticMarkup } from 'react-dom/server';
import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import { Artwork, ArtworkFallback } from './components/Artwork';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Electric Touch',
    artist: 'Taylor Swift',
    album: 'Electric Touch',
    albumArtist: 'Taylor Swift',
    folder: 'Taylor Swift',
    folderPath: 'Taylor Swift',
    duration: 240,
    format: 'mp3',
    hasCover: false,
    ...overrides
  };
}

describe('Artwork', () => {
  it('renderiza fallback central, decorativo e identificável quando não há capa', () => {
    const html = renderToStaticMarkup(<ArtworkFallback track={track()} />);

    expect(html).toContain('data-artwork-state="fallback"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('artwork--fallback');
    expect(html).toContain('artwork-fallback__label">ET</span>');
    expect(html).toContain('artwork-fallback__disc');
  });

  it('usa o mesmo fallback pelo componente principal quando hasCover é false', () => {
    const html = renderToStaticMarkup(<Artwork track={track()} />);

    expect(html).toContain('data-artwork-state="fallback"');
    expect(html).not.toContain('<img');
  });

  it('preserva a URL da capa efetiva e coverVersion quando existe capa', () => {
    const html = renderToStaticMarkup(
      <Artwork track={track({ hasCover: true, coverVersion: 'override-v2' })} />
    );

    expect(html).toContain('data-artwork-state="cover"');
    expect(html).toContain('src="/api/tracks/track-1/cover?v=override-v2"');
    expect(html).toContain('loading="lazy"');
  });

  it('mantém a variante grande no fallback do player e previews amplos', () => {
    const html = renderToStaticMarkup(<ArtworkFallback track={track()} large />);

    expect(html).toContain('artwork--large');
    expect(html).toContain('data-artwork-state="fallback"');
  });
});
