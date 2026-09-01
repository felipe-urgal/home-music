import { describe, expect, it } from 'vitest';
import {
  addIndividualOfflineReference,
  collectionReferencedTrackIds,
  createOfflineReferenceManifest,
  findOfflineCollectionReference,
  isOfflineTrackReferenced,
  offlineCollectionMatches,
  offlineReferencesKey,
  parseOfflineReferenceManifest,
  removeIndividualOfflineReference,
  removeOfflineCollectionReference,
  unreferencedOfflineTrackIds,
  upsertOfflineCollectionReference
} from './offline-collection-references';

describe('offline collection references', () => {
  it('migra downloads físicos existentes como referências individuais conservadoras', () => {
    const manifest = createOfflineReferenceManifest(['track-a', 'track-b', 'track-a']);
    expect(manifest.individualTrackIds).toEqual(['track-a', 'track-b']);
    expect(manifest.collections).toEqual([]);
  });

  it('isola o manifesto de referências por usuário', () => {
    expect(offlineReferencesKey('user-a')).not.toBe(offlineReferencesKey('user-b'));
    expect(offlineReferencesKey('user a')).toContain('user%20a');
  });

  it('mantém uma faixa referenciada enquanto outra coleção ou download individual depender dela', () => {
    let manifest = createOfflineReferenceManifest(['shared']);
    manifest = upsertOfflineCollectionReference(manifest, {
      kind: 'playlist',
      sourceId: 'playlist-a',
      name: 'Playlist A',
      trackIds: ['shared', 'playlist-only']
    }, '2026-09-01T12:00:00.000Z');
    manifest = upsertOfflineCollectionReference(manifest, {
      kind: 'folder',
      sourceId: 'folder-a',
      name: 'Pasta A',
      trackIds: ['shared', 'folder-only']
    }, '2026-09-01T12:01:00.000Z');

    const withoutPlaylist = removeOfflineCollectionReference(manifest, 'playlist', 'playlist-a');
    expect(unreferencedOfflineTrackIds(withoutPlaylist, ['shared', 'playlist-only'])).toEqual(['playlist-only']);
    expect(isOfflineTrackReferenced(withoutPlaylist, 'shared')).toBe(true);

    const withoutIndividual = removeIndividualOfflineReference(withoutPlaylist, 'shared');
    expect(isOfflineTrackReferenced(withoutIndividual, 'shared')).toBe(true);

    const withoutFolder = removeOfflineCollectionReference(withoutIndividual, 'folder', 'folder-a');
    expect(unreferencedOfflineTrackIds(withoutFolder, ['shared', 'folder-only'])).toEqual(['shared', 'folder-only']);
  });

  it('deduplica ids dentro e entre referências sem duplicar o artefato lógico', () => {
    let manifest = createOfflineReferenceManifest();
    manifest = upsertOfflineCollectionReference(manifest, {
      kind: 'playlist',
      sourceId: 'playlist-a',
      name: 'Playlist A',
      trackIds: ['one', 'one', 'two']
    });
    manifest = upsertOfflineCollectionReference(manifest, {
      kind: 'folder',
      sourceId: 'folder-a',
      name: 'Pasta A',
      trackIds: ['two', 'three']
    });

    expect([...collectionReferencedTrackIds(manifest)].sort()).toEqual(['one', 'three', 'two']);
    expect(findOfflineCollectionReference(manifest, 'playlist', 'playlist-a')?.trackIds).toEqual(['one', 'two']);
  });

  it('permite promover uma faixa de coleção para intenção individual sem duplicar referência', () => {
    let manifest = createOfflineReferenceManifest();
    manifest = upsertOfflineCollectionReference(manifest, {
      kind: 'folder',
      sourceId: 'folder-a',
      name: 'Pasta A',
      trackIds: ['track-a']
    });
    manifest = addIndividualOfflineReference(manifest, 'track-a');
    manifest = addIndividualOfflineReference(manifest, 'track-a');

    expect(manifest.individualTrackIds).toEqual(['track-a']);
    expect(isOfflineTrackReferenced(manifest, 'track-a')).toBe(true);
  });

  it('detecta snapshot desatualizado por nome, ordem ou conteúdo', () => {
    const manifest = upsertOfflineCollectionReference(createOfflineReferenceManifest(), {
      kind: 'playlist',
      sourceId: 'playlist-a',
      name: 'Playlist A',
      trackIds: ['one', 'two']
    }, '2026-09-01T12:00:00.000Z');
    const reference = manifest.collections[0]!;

    expect(offlineCollectionMatches(reference, { name: 'Playlist A', trackIds: ['one', 'two'] })).toBe(true);
    expect(offlineCollectionMatches(reference, { name: 'Playlist A', trackIds: ['two', 'one'] })).toBe(false);
    expect(offlineCollectionMatches(reference, { name: 'Renomeada', trackIds: ['one', 'two'] })).toBe(false);
  });

  it('descarta manifesto corrompido e sanitiza coleções inválidas', () => {
    expect(parseOfflineReferenceManifest('{')).toBeNull();
    expect(parseOfflineReferenceManifest(JSON.stringify({ version: 99, individualTrackIds: [], collections: [] }))).toBeNull();

    const parsed = parseOfflineReferenceManifest(JSON.stringify({
      version: 1,
      individualTrackIds: ['one', 'one', '', 4],
      collections: [
        { kind: 'playlist', sourceId: 'p1', name: 'P1', trackIds: ['one', 'two', 'two'], updatedAt: 'now' },
        { kind: 'invalid', sourceId: 'x', name: 'X', trackIds: [], updatedAt: 'now' }
      ]
    }));

    expect(parsed?.individualTrackIds).toEqual(['one']);
    expect(parsed?.collections).toHaveLength(1);
    expect(parsed?.collections[0]?.trackIds).toEqual(['one', 'two']);
  });
});
