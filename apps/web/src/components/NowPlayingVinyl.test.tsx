import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Track } from '@home-music/shared';
import { NowPlayingVinyl } from './NowPlayingVinyl';

const track: Track = {
  id: 'track-1',
  title: 'Faixa',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista',
  folder: 'Álbum',
  folderPath: 'Artista/Álbum',
  duration: 180,
  format: 'flac',
  hasCover: false
};

describe('NowPlayingVinyl', () => {
  it('deriva o estado visual somente de playing e mantém a arte decorativa fora da árvore acessível', () => {
    const paused = renderToStaticMarkup(<NowPlayingVinyl track={track} playing={false} />);
    const playing = renderToStaticMarkup(<NowPlayingVinyl track={track} playing />);

    expect(paused).toContain('class="now-playing-vinyl"');
    expect(paused).toContain('data-playing="false"');
    expect(paused).toContain('aria-hidden="true"');
    expect(paused).not.toContain('is-playing');
    expect(playing).toContain('now-playing-vinyl is-playing');
    expect(playing).toContain('data-playing="true"');
  });
});
