export const OFFLINE_REFERENCES_PREFIX = 'home-music:offline-references:v1:';
export const OFFLINE_REFERENCE_MANIFEST_VERSION = 1 as const;

export type OfflineCollectionKind = 'playlist' | 'folder';

export type OfflineCollectionReference = {
  kind: OfflineCollectionKind;
  sourceId: string;
  name: string;
  trackIds: string[];
  updatedAt: string;
};

export type OfflineReferenceManifest = {
  version: typeof OFFLINE_REFERENCE_MANIFEST_VERSION;
  individualTrackIds: string[];
  collections: OfflineCollectionReference[];
};

export type OfflineCollectionInput = {
  kind: OfflineCollectionKind;
  sourceId: string;
  name: string;
  trackIds: string[];
};

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isCollectionKind(value: unknown): value is OfflineCollectionKind {
  return value === 'playlist' || value === 'folder';
}

function parseCollection(value: unknown): OfflineCollectionReference | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<OfflineCollectionReference>;
  if (
    !isCollectionKind(candidate.kind)
    || typeof candidate.sourceId !== 'string'
    || !candidate.sourceId.trim()
    || typeof candidate.name !== 'string'
    || !Array.isArray(candidate.trackIds)
    || typeof candidate.updatedAt !== 'string'
  ) return null;

  return {
    kind: candidate.kind,
    sourceId: candidate.sourceId.trim(),
    name: candidate.name.trim() || candidate.sourceId.trim(),
    trackIds: uniqueStrings(candidate.trackIds),
    updatedAt: candidate.updatedAt
  };
}

export function offlineReferencesKey(userId: string) {
  return `${OFFLINE_REFERENCES_PREFIX}${encodeURIComponent(userId)}`;
}

export function offlineCollectionKey(kind: OfflineCollectionKind, sourceId: string) {
  return `${kind}:${sourceId}`;
}

export function parseOfflineReferenceManifest(raw: string | null): OfflineReferenceManifest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OfflineReferenceManifest> | null;
    if (
      !value
      || typeof value !== 'object'
      || value.version !== OFFLINE_REFERENCE_MANIFEST_VERSION
      || !Array.isArray(value.individualTrackIds)
      || !Array.isArray(value.collections)
    ) return null;

    const collections: OfflineCollectionReference[] = [];
    const seen = new Set<string>();
    for (const item of value.collections) {
      const parsed = parseCollection(item);
      if (!parsed) continue;
      const key = offlineCollectionKey(parsed.kind, parsed.sourceId);
      if (seen.has(key)) continue;
      seen.add(key);
      collections.push(parsed);
    }

    return {
      version: OFFLINE_REFERENCE_MANIFEST_VERSION,
      individualTrackIds: uniqueStrings(value.individualTrackIds),
      collections
    };
  } catch {
    return null;
  }
}

export function createOfflineReferenceManifest(existingDownloadedTrackIds: Iterable<string> = []): OfflineReferenceManifest {
  return {
    version: OFFLINE_REFERENCE_MANIFEST_VERSION,
    // Migração conservadora: qualquer download existente antes da camada de
    // referências é tratado como intenção individual para nunca ser apagado
    // por uma remoção de coleção posterior.
    individualTrackIds: uniqueStrings([...existingDownloadedTrackIds]),
    collections: []
  };
}

export function addIndividualOfflineReference(manifest: OfflineReferenceManifest, trackId: string): OfflineReferenceManifest {
  return {
    ...manifest,
    individualTrackIds: uniqueStrings([trackId, ...manifest.individualTrackIds])
  };
}

export function removeIndividualOfflineReference(manifest: OfflineReferenceManifest, trackId: string): OfflineReferenceManifest {
  return {
    ...manifest,
    individualTrackIds: manifest.individualTrackIds.filter(id => id !== trackId)
  };
}

export function upsertOfflineCollectionReference(
  manifest: OfflineReferenceManifest,
  input: OfflineCollectionInput,
  updatedAt = new Date().toISOString()
): OfflineReferenceManifest {
  const sourceId = input.sourceId.trim();
  const key = offlineCollectionKey(input.kind, sourceId);
  const collection: OfflineCollectionReference = {
    kind: input.kind,
    sourceId,
    name: input.name.trim() || sourceId,
    trackIds: uniqueStrings(input.trackIds),
    updatedAt
  };

  return {
    ...manifest,
    collections: [
      collection,
      ...manifest.collections.filter(item => offlineCollectionKey(item.kind, item.sourceId) !== key)
    ]
  };
}

export function removeOfflineCollectionReference(
  manifest: OfflineReferenceManifest,
  kind: OfflineCollectionKind,
  sourceId: string
): OfflineReferenceManifest {
  const key = offlineCollectionKey(kind, sourceId);
  return {
    ...manifest,
    collections: manifest.collections.filter(item => offlineCollectionKey(item.kind, item.sourceId) !== key)
  };
}

export function findOfflineCollectionReference(
  manifest: OfflineReferenceManifest,
  kind: OfflineCollectionKind,
  sourceId: string
) {
  const key = offlineCollectionKey(kind, sourceId);
  return manifest.collections.find(item => offlineCollectionKey(item.kind, item.sourceId) === key) ?? null;
}

export function referencedOfflineTrackIds(manifest: OfflineReferenceManifest) {
  const ids = new Set(manifest.individualTrackIds);
  for (const collection of manifest.collections) {
    for (const trackId of collection.trackIds) ids.add(trackId);
  }
  return ids;
}

export function collectionReferencedTrackIds(manifest: OfflineReferenceManifest) {
  const ids = new Set<string>();
  for (const collection of manifest.collections) {
    for (const trackId of collection.trackIds) ids.add(trackId);
  }
  return ids;
}

export function isOfflineTrackReferenced(manifest: OfflineReferenceManifest, trackId: string) {
  if (manifest.individualTrackIds.includes(trackId)) return true;
  return manifest.collections.some(collection => collection.trackIds.includes(trackId));
}

export function unreferencedOfflineTrackIds(manifest: OfflineReferenceManifest, candidates: Iterable<string>) {
  const referenced = referencedOfflineTrackIds(manifest);
  return uniqueStrings([...candidates]).filter(trackId => !referenced.has(trackId));
}

export function offlineCollectionMatches(
  reference: OfflineCollectionReference,
  input: Pick<OfflineCollectionInput, 'name' | 'trackIds'>
) {
  if (reference.name !== input.name.trim()) return false;
  const trackIds = uniqueStrings(input.trackIds);
  return trackIds.length === reference.trackIds.length
    && trackIds.every((trackId, index) => reference.trackIds[index] === trackId);
}
