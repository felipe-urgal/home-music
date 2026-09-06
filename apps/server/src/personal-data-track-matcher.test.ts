import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '@home-music/shared';
import type { PortableTrackReferenceV1 } from '@home-music/shared/personal-data';
import { PersonalDataTrackMatcher } from './personal-data-track-matcher.js';

function reference(
  relativePath: string,
  overrides: Partial<PortableTrackReferenceV1['hints']> = {}
): PortableTrackReferenceV1 {
  return {
    relativePath,
    hints: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Álbum',
      durationSeconds: 180,
      ...overrides
    }
  };
}

function track(id: string): Track {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Coleção',
    folderPath: 'Coleção',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

function createMatcher(
  references: Array<[string, PortableTrackReferenceV1]>,
  activeTrackIds = references.map(([trackId]) => trackId)
) {
  const requestedTrackIds: string[][] = [];
  const referenceMap = new Map(references);
  const matcher = new PersonalDataTrackMatcher(
    {
      portableTrackReferences(trackIds: readonly string[]) {
        requestedTrackIds.push([...trackIds]);
        return referenceMap;
      }
    },
    {
      listPublicTracks() {
        return activeTrackIds.map(track);
      }
    }
  );
  return { matcher, requestedTrackIds };
}

test('matching encontra faixa por relativePath quando os hints continuam compatíveis', () => {
  const imported = reference('Artista/Álbum/faixa.mp3');
  const { matcher } = createMatcher([['track-a', imported]]);

  assert.deepEqual(matcher.match(imported), {
    status: 'found',
    trackId: 'track-a',
    strategy: 'relative-path',
    reason: 'relative-path',
    candidateTrackIds: []
  });
});

test('matching nunca escolhe silenciosamente entre relativePaths duplicados', () => {
  const imported = reference('Artista/Álbum/faixa.mp3');
  const { matcher } = createMatcher([
    ['track-a', imported],
    ['track-b', reference('Artista/Álbum/faixa.mp3')]
  ]);

  assert.deepEqual(matcher.match(imported), {
    status: 'ambiguous',
    trackId: null,
    strategy: 'relative-path',
    reason: 'relative-path-ambiguous',
    candidateTrackIds: ['track-a', 'track-b']
  });
});

test('matching não confia cegamente em relativePath reutilizado por outro conteúdo', () => {
  const imported = reference('Artista/Álbum/faixa.mp3');
  const current = reference('Artista/Álbum/faixa.mp3', { title: 'Outra faixa' });
  const { matcher } = createMatcher([['track-a', current]]);

  assert.deepEqual(matcher.match(imported), {
    status: 'missing',
    trackId: null,
    strategy: 'relative-path',
    reason: 'relative-path-conflict',
    candidateTrackIds: ['track-a']
  });
});

test('matching reconcilia mudança de pasta somente com filename, metadata e duração fortes', () => {
  const imported = reference('Antiga/Álbum/faixa.mp3', { durationSeconds: 180.2 });
  const moved = reference('Nova/Álbum/faixa.mp3', { durationSeconds: 180.8 });
  const { matcher } = createMatcher([['track-a', moved]]);

  assert.deepEqual(matcher.match(imported), {
    status: 'found',
    trackId: 'track-a',
    strategy: 'hints',
    reason: 'hints',
    candidateTrackIds: []
  });
});

test('matching rejeita fallback quando duração passa da tolerância de um segundo', () => {
  const imported = reference('Antiga/Álbum/faixa.mp3', { durationSeconds: 180 });
  const differentDuration = reference('Nova/Álbum/faixa.mp3', { durationSeconds: 181.01 });
  const { matcher } = createMatcher([['track-a', differentDuration]]);

  assert.deepEqual(matcher.match(imported), {
    status: 'missing',
    trackId: null,
    strategy: null,
    reason: 'no-candidate',
    candidateTrackIds: []
  });
});

test('matching nunca escolhe silenciosamente entre múltiplos candidatos por hints', () => {
  const imported = reference('Origem/faixa.mp3');
  const { matcher } = createMatcher([
    ['track-a', reference('Destino A/faixa.mp3')],
    ['track-b', reference('Destino B/faixa.mp3')]
  ]);

  assert.deepEqual(matcher.match(imported), {
    status: 'ambiguous',
    trackId: null,
    strategy: 'hints',
    reason: 'hints-ambiguous',
    candidateTrackIds: ['track-a', 'track-b']
  });
});

test('matching prefere ausência a heurística fraca ou filename divergente', () => {
  const missingDuration = reference('Origem/faixa.mp3', { durationSeconds: null });
  const { matcher: weakMatcher } = createMatcher([
    ['track-a', reference('Destino/faixa.mp3')]
  ]);
  assert.equal(weakMatcher.match(missingDuration).reason, 'insufficient-hints');

  const { matcher: renamedMatcher } = createMatcher([
    ['track-a', reference('Destino/outro-nome.mp3')]
  ]);
  assert.deepEqual(renamedMatcher.match(reference('Origem/faixa.mp3')), {
    status: 'missing',
    trackId: null,
    strategy: null,
    reason: 'no-candidate',
    candidateTrackIds: []
  });
});

test('matching classifica referência inválida pela mesma validação do parser', () => {
  const { matcher } = createMatcher([]);
  assert.deepEqual(matcher.match(reference('../fora.mp3')), {
    status: 'invalid',
    trackId: null,
    strategy: null,
    reason: 'invalid-reference',
    candidateTrackIds: []
  });
});

test('matching consulta somente faixas ativas projetadas pela LibraryService', () => {
  const hidden = reference('Coleção/oculta.mp3');
  const { matcher, requestedTrackIds } = createMatcher(
    [
      ['track-active', reference('Coleção/ativa.mp3')],
      ['track-hidden', hidden]
    ],
    ['track-active']
  );

  assert.equal(matcher.match(hidden).status, 'missing');
  assert.deepEqual(requestedTrackIds, [['track-active']]);
});
