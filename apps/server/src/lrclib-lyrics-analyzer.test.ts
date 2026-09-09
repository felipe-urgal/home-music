import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Track } from '@home-music/shared';
import {
  createLrclibLyricsAnalyzer,
  normalizeLrclibRecord,
  normalizeLrclibSearch,
  resolveLrclibLyricsCandidate
} from './lrclib-lyrics-analyzer.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';

type CacheEntry = { payload: unknown; expiresAtMs: number; updatedAt: string };

function gateway() {
  const cache = new Map<string, CacheEntry>();
  const key = (value: { provider: string; providerVersion: string; cacheKeyHash: string }) => (
    `${value.provider}:${value.providerVersion}:${value.cacheKeyHash}`
  );
  return new LibraryAssistantProviderGateway({
    getProviderCache(value, nowMs) {
      const entry = cache.get(key(value));
      return entry && entry.expiresAtMs > nowMs ? entry : null;
    },
    putProviderCache(value, payload, expiresAtMs, updatedAt) {
      cache.set(key(value), { payload, expiresAtMs, updatedAt });
    },
    deleteProviderCache(value) {
      cache.delete(key(value));
    }
  }, { minIntervalMs: 0 });
}

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Faixa Sintética',
    artist: 'Artista de Teste',
    album: 'Álbum de Teste',
    albumArtist: 'Artista de Teste',
    folder: 'Album',
    folderPath: 'Album',
    duration: 180,
    format: '.flac',
    hasCover: false,
    ...overrides
  };
}

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('LRCLIB lyrics analyzer', () => {
  it('creates a high-confidence synchronized suggestion for strong identity', async () => {
    let requested = '';
    let userAgent = '';
    const analyzer = createLrclibLyricsAnalyzer({
      fetchImpl: async (input, init) => {
        requested = String(input);
        userAgent = new Headers(init?.headers).get('user-agent') ?? '';
        return jsonResponse([{
          id: 42,
          trackName: 'Faixa Sintética',
          artistName: 'Artista de Teste',
          albumName: 'Álbum de Teste',
          duration: 180.8,
          instrumental: false,
          plainLyrics: 'linha criada para teste',
          syncedLyrics: '[00:01.00]linha criada para teste'
        }]);
      },
      hasEffectiveLyrics: () => false
    });

    const drafts = await analyzer.analyze({ runId: 'run-1', tracks: [track()], providers: gateway() });
    assert.equal(drafts.length, 1);
    const suggestion = drafts[0]!;
    assert.equal(suggestion.capability, 'lyrics');
    assert.equal(suggestion.confidence, 'high');
    assert.equal(suggestion.provenance.source, 'lrclib');
    assert.deepEqual(suggestion.target, {
      capability: 'lyrics',
      trackId: 'track-1',
      candidateId: 'lrclib:42',
      synchronized: true,
      language: null,
      currentValue: '',
      preview: 'linha criada para teste'
    });
    assert.match(requested, /\/api\/search\?/);
    assert.match(requested, /track_name=Faixa%20Sint%C3%A9tica|track_name=Faixa\+Sint%C3%A9tica/);
    assert.match(requested, /artist_name=Artista%20de%20Teste|artist_name=Artista\+de\+Teste/);
    assert.match(userAgent, /^HomeMusic\/0\.1/);
  });

  it('keeps equivalent competing versions in review instead of choosing silently', async () => {
    const analyzer = createLrclibLyricsAnalyzer({
      fetchImpl: async () => jsonResponse([
        {
          id: 10,
          trackName: 'Faixa Sintética',
          artistName: 'Artista de Teste',
          albumName: 'Álbum de Teste',
          duration: 180.5,
          plainLyrics: 'versão um criada para teste'
        },
        {
          id: 11,
          trackName: 'Faixa Sintética',
          artistName: 'Artista de Teste',
          albumName: 'Álbum de Teste',
          duration: 181,
          plainLyrics: 'versão dois criada para teste'
        }
      ]),
      hasEffectiveLyrics: () => false
    });

    const drafts = await analyzer.analyze({ runId: 'run-2', tracks: [track()], providers: gateway() });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.confidence, 'medium');
    assert.ok(drafts[0]?.reasonCodes.includes('ambiguous-candidates'));
  });

  it('does not suggest lyrics when an effective local or managed source already exists', async () => {
    let requests = 0;
    const analyzer = createLrclibLyricsAnalyzer({
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse([]);
      },
      hasEffectiveLyrics: () => true
    });
    const drafts = await analyzer.analyze({ runId: 'run-3', tracks: [track()], providers: gateway() });
    assert.deepEqual(drafts, []);
    assert.equal(requests, 0);
  });

  it('resolves approved candidates by id and prefers valid synchronized lyrics', async () => {
    const provider = gateway();
    const resolved = await resolveLrclibLyricsCandidate(provider, 'lrclib:77', {
      fetchImpl: async input => {
        assert.match(String(input), /\/api\/get\/77$/);
        return jsonResponse({
          id: 77,
          instrumental: false,
          plainLyrics: 'linha plain de teste',
          syncedLyrics: '[offset:250]\n[00:01.00]linha sincronizada de teste'
        });
      }
    });
    assert.deepEqual(resolved, {
      candidateId: 'lrclib:77',
      synchronized: true,
      language: null,
      text: '[offset:250]\n[00:01.00]linha sincronizada de teste'
    });
  });

  it('treats missing provider records as a normal null result', async () => {
    const resolved = await resolveLrclibLyricsCandidate(gateway(), 'lrclib:88', {
      fetchImpl: async () => jsonResponse({ error: 'not found' }, 404)
    });
    assert.equal(resolved, null);
  });

  it('rejects malformed and oversized provider payloads without retaining commercial fixtures', () => {
    assert.throws(() => normalizeLrclibSearch({ recordings: [] }));
    assert.throws(() => normalizeLrclibRecord({
      id: 99,
      plainLyrics: 'x'.repeat(49 * 1024)
    }));
  });
});
