import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { resolveNextTrackPreload, warmTranscodedTrack } from './next-track-preload';

function track(id: string, replayGainTrackDb: number | null = null): Track {
  return {
    id,
    title: id,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: '',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb,
    replayGainAlbumDb: null
  };
}

describe('next track preload', () => {
  const queue = [track('a'), track('b', -6), track('c')];

  it('prepara antecipadamente a próxima faixa no modo Economia', () => {
    expect(resolveNextTrackPreload(queue, 0, 'off', 'economy', 'off')).toEqual({
      trackId: 'b',
      url: '/api/tracks/b/transcode?quality=economy'
    });
  });

  it('não baixa antecipadamente o streaming original', () => {
    expect(resolveNextTrackPreload(queue, 0, 'off', 'auto', 'off')).toBeNull();
    expect(resolveNextTrackPreload(queue, 0, 'off', 'original', 'off')).toBeNull();
  });

  it('aquece o transcode de normalização quando a próxima faixa tem ReplayGain', () => {
    expect(resolveNextTrackPreload(queue, 0, 'off', 'auto', 'track')).toEqual({
      trackId: 'b',
      url: '/api/tracks/b/transcode?quality=high&normalization=track'
    });
  });

  it('não cria transcode de normalização quando a próxima faixa não tem ReplayGain', () => {
    expect(resolveNextTrackPreload(queue, 1, 'off', 'auto', 'track')).toBeNull();
  });

  it('respeita repeat all e não antecipa faixa em repeat one', () => {
    expect(resolveNextTrackPreload(queue, 2, 'all', 'economy', 'off')).toEqual({
      trackId: 'a',
      url: '/api/tracks/a/transcode?quality=economy'
    });
    expect(resolveNextTrackPreload(queue, 0, 'one', 'economy', 'off')).toBeNull();
  });

  it('não prepara nada quando a fila termina sem repetição', () => {
    expect(resolveNextTrackPreload(queue, 2, 'off', 'economy', 'off')).toBeNull();
  });

  it('aquece o servidor com apenas um byte de resposta', async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;

    const warmed = await warmTranscodedTrack(async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(new Uint8Array([1]), { status: 206 });
    }, '/api/tracks/b/transcode?quality=economy');

    expect(warmed).toBe(true);
    expect(capturedInput).toBe('/api/tracks/b/transcode?quality=economy');
    expect(capturedInit?.cache).toBe('no-store');
    expect(new Headers(capturedInit?.headers).get('Range')).toBe('bytes=0-0');
  });

  it('trata falha de aquecimento como best-effort sem consumir corpo', async () => {
    let consumed = false;
    const response = new Response('indisponível', { status: 503 });
    const originalArrayBuffer = response.arrayBuffer.bind(response);
    response.arrayBuffer = async () => {
      consumed = true;
      return originalArrayBuffer();
    };

    expect(await warmTranscodedTrack(async () => response, '/api/tracks/b/transcode?quality=economy')).toBe(false);
    expect(consumed).toBe(false);
  });
});
