import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  createMusicBrainzAlbumArtworkAnalyzer,
  normalizeMusicBrainzReleaseSearch
} from './musicbrainz-artwork-analyzer.js';

function track(id: string, title: string): Track {
  return {
    id,
    title,
    artist: 'Legião Urbana',
    album: 'As Quatro Estações',
    albumArtist: 'Legião Urbana',
    folder: 'Legião Urbana',
    folderPath: 'Legião Urbana',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

function providers() {
  return {
    async query(query: any) {
      const raw = await query.execute({
        signal: new AbortController().signal,
        userAgent: 'HomeMusic/Test'
      });
      return { value: query.normalize(raw), cache: 'miss' };
    }
  } as unknown as LibraryAssistantProviderGateway;
}

test('normaliza release search do MusicBrainz e aceita cache já normalizado', () => {
  const payload = {
    releases: [{
      id: 'release-1',
      title: 'As Quatro Estações',
      'release-group': { id: 'group-1' },
      'artist-credit': [{ name: 'Legião Urbana' }]
    }]
  };
  const normalized = normalizeMusicBrainzReleaseSearch(payload);
  assert.deepEqual(normalized, [{
    id: 'release-1',
    title: 'As Quatro Estações',
    releaseGroupId: 'group-1',
    albumArtist: 'Legião Urbana'
  }]);
  assert.deepEqual(normalizeMusicBrainzReleaseSearch(normalized), normalized);
});

test('resolve capa uma vez por álbum e sugere para todas as faixas do grupo', async () => {
  const requests: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    requests.push(url.toString());

    if (url.hostname === 'musicbrainz.org' && url.pathname === '/ws/2/release') {
      assert.match(url.searchParams.get('query') ?? '', /As Quatro Estações/);
      return new Response(JSON.stringify({
        releases: [{
          id: 'release-1',
          title: 'As Quatro Estações',
          'release-group': { id: 'group-1' },
          'artist-credit': [{ name: 'Legião Urbana' }]
        }]
      }), { status: 200 });
    }
    if (url.hostname === 'coverartarchive.org' && url.pathname === '/release-group/group-1') {
      return new Response(JSON.stringify({
        images: [{
          id: 'image-1',
          front: true,
          image: 'https://archive.org/download/cover/image.jpg',
          thumbnails: { '500': 'https://archive.org/download/cover/image-500.jpg' }
        }]
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const analyzer = createMusicBrainzAlbumArtworkAnalyzer({ fetchImpl });
  const drafts = await analyzer.analyze({
    runId: 'run-1',
    tracks: [track('one', 'Pais e Filhos'), track('two', 'Meninos e Meninas')],
    providers: providers()
  });

  assert.equal(drafts.length, 2);
  assert.ok(drafts.every(item => item.capability === 'artwork'));
  assert.ok(drafts.every(item => item.confidence === 'high'));
  assert.ok(drafts.every(item => item.reasonCodes.includes('album-context')));
  assert.deepEqual(
    drafts.map(item => item.target.capability === 'artwork' ? item.target.trackId : null).sort(),
    ['one', 'two']
  );
  assert.equal(
    requests.filter(value => value.includes('/ws/2/release?')).length,
    1
  );
  assert.equal(
    requests.filter(value => value.includes('/release-group/group-1')).length,
    1
  );
});

test('aceita uma capa coerente mesmo quando existem múltiplas edições do álbum', async () => {
  const requests: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.hostname === 'musicbrainz.org') {
      return new Response(JSON.stringify({
        releases: [
          {
            id: 'release-1',
            title: 'As Quatro Estações',
            'release-group': { id: 'group-1' },
            'artist-credit': [{ name: 'Legião Urbana' }]
          },
          {
            id: 'release-2',
            title: 'As Quatro Estações',
            'release-group': { id: 'group-2' },
            'artist-credit': [{ name: 'Legião Urbana' }]
          }
        ]
      }), { status: 200 });
    }
    if (url.pathname === '/release-group/group-1') {
      return new Response(JSON.stringify({
        images: [{
          id: 'image-1',
          front: true,
          image: 'https://archive.org/download/cover/image.jpg',
          thumbnails: {}
        }]
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const analyzer = createMusicBrainzAlbumArtworkAnalyzer({ fetchImpl });
  const drafts = await analyzer.analyze({
    runId: 'run-multiple-editions',
    tracks: [track('one', 'Pais e Filhos')],
    providers: providers()
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].capability, 'artwork');
  assert.ok(requests.includes('/release-group/group-1'));
  assert.ok(!requests.includes('/release/release-1'));
});

test('tenta outra edição coerente quando a primeira não tem artwork', async () => {
  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'musicbrainz.org') {
      return new Response(JSON.stringify({
        releases: [
          {
            id: 'release-1',
            title: 'As Quatro Estações',
            'release-group': { id: 'group-1' },
            'artist-credit': [{ name: 'Legião Urbana' }]
          },
          {
            id: 'release-2',
            title: 'As Quatro Estações',
            'release-group': { id: 'group-2' },
            'artist-credit': [{ name: 'Legião Urbana' }]
          }
        ]
      }), { status: 200 });
    }
    if (url.pathname === '/release-group/group-1' || url.pathname === '/release/release-1') {
      return new Response(JSON.stringify({ images: [] }), { status: 404 });
    }
    if (url.pathname === '/release-group/group-2') {
      return new Response(JSON.stringify({
        images: [{
          id: 'image-2',
          front: true,
          image: 'https://archive.org/download/cover/image-2.jpg',
          thumbnails: {}
        }]
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const analyzer = createMusicBrainzAlbumArtworkAnalyzer({ fetchImpl });
  const drafts = await analyzer.analyze({
    runId: 'run-second-edition',
    tracks: [track('one', 'Pais e Filhos')],
    providers: providers()
  });

  assert.equal(drafts.length, 1);
  assert.equal(
    drafts[0].target.capability === 'artwork' ? drafts[0].target.musicBrainzReleaseId : null,
    'release-2'
  );
});

test('normaliza espaços em torno de & no crédito do álbum antes da busca', async () => {
  const source: Track = {
    ...track('tedio', 'Tédio'),
    artist: 'Biquini Cavadão',
    album: 'O melhor de 2',
    albumArtist: 'Biquini Cavadão&Capital Inicial'
  };

  const fetchImpl = async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === 'musicbrainz.org') {
      assert.equal(
        url.searchParams.get('query'),
        'release:"O melhor de 2" AND artist:"Biquini Cavadão & Capital Inicial"'
      );
      return new Response(JSON.stringify({
        releases: [{
          id: 'release-biquini',
          title: 'O melhor de 2',
          'release-group': { id: 'group-biquini' },
          'artist-credit': [
            { name: 'Biquini Cavadão', joinphrase: ' & ' },
            { name: 'Capital Inicial' }
          ]
        }]
      }), { status: 200 });
    }
    if (url.pathname === '/release-group/group-biquini') {
      return new Response(JSON.stringify({
        images: [{
          id: 'image-biquini',
          front: true,
          image: 'https://archive.org/download/cover/biquini.jpg',
          thumbnails: {}
        }]
      }), { status: 200 });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const analyzer = createMusicBrainzAlbumArtworkAnalyzer({ fetchImpl });
  const drafts = await analyzer.analyze({
    runId: 'run-artist-spacing',
    tracks: [source],
    providers: providers()
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].capability, 'artwork');
  const artistEvidence = drafts[0].evidence.find(
    item => item.type === 'text-match' && item.field === 'albumArtist'
  );
  assert.notEqual(
    artistEvidence?.type === 'text-match' ? artistEvidence.match : 'different',
    'different'
  );
});
