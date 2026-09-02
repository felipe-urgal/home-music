import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { fetchOfflineTrackResponse } from './offline-background-fetch';
import {
  addIndividualOfflineReference,
  collectionReferencedTrackIds,
  createOfflineReferenceManifest,
  findOfflineCollectionReference,
  isOfflineTrackReferenced,
  offlineCollectionKey,
  offlineCollectionMatches,
  offlineReferencesKey,
  parseOfflineReferenceManifest,
  removeIndividualOfflineReference,
  removeOfflineCollectionReference,
  type OfflineCollectionInput,
  type OfflineCollectionKind,
  type OfflineCollectionReference,
  type OfflineReferenceManifest,
  unreferencedOfflineTrackIds,
  upsertOfflineCollectionReference
} from './offline-collection-references';
import { offlineDownloadScheduler } from './offline-download-scheduler';
import { OFFLINE_USER_CHANGED_EVENT, OFFLINE_USER_ID_KEY, readOfflineUserId } from './offline-user';

export const OFFLINE_AUDIO_CACHE_PREFIX = 'home-music-offline-audio-v2-';
export const OFFLINE_MANIFEST_PREFIX = 'home-music:offline-tracks:v2:';
const LEGACY_OFFLINE_AUDIO_CACHE_NAME = 'home-music-offline-audio-v1';
const LEGACY_OFFLINE_MANIFEST_KEY = 'home-music:offline-tracks:v1';
const CAPABILITY_REQUEST = 'HOME_MUSIC_GET_CAPABILITIES';
const CAPABILITY_RESPONSE = 'HOME_MUSIC_CAPABILITIES';

export type OfflineDownloadRecord = {
  track: Track;
  size: number;
  mimeType: string;
  downloadedAt: string;
};

export type OfflineCollectionDownloadInput = Omit<OfflineCollectionInput, 'trackIds'> & {
  tracks: Track[];
};

export type OfflineCollectionStatus = 'not-downloaded' | 'downloading' | 'available' | 'partial' | 'error' | 'paused';

export type OfflineCollectionSummary = {
  key: string;
  reference: OfflineCollectionReference;
  totalCount: number;
  downloadedCount: number;
  downloadingCount: number;
  status: OfflineCollectionStatus;
  error: string | null;
};

export type OfflineCollectionTargetState = {
  key: string;
  reference: OfflineCollectionReference | null;
  totalCount: number;
  downloadedCount: number;
  downloadingCount: number;
  status: OfflineCollectionStatus;
  error: string | null;
  outdated: boolean;
};

type ManifestState = {
  userId: string | null;
  records: OfflineDownloadRecord[];
};

type ReferenceState = {
  userId: string | null;
  manifest: OfflineReferenceManifest;
};

type PendingState = {
  userId: string | null;
  trackIds: Set<string>;
};

type WorkerState = {
  userId: string | null;
  checked: boolean;
  supported: boolean;
};

type CollectionRuntimeState = {
  userId: string | null;
  syncingKeys: Set<string>;
  pausedKeys: Set<string>;
  errors: Map<string, string>;
};

type CollectionControl = {
  paused: boolean;
  cancelled: boolean;
};

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<Track>;
  return (
    typeof track.id === 'string' &&
    typeof track.title === 'string' &&
    typeof track.artist === 'string' &&
    typeof track.album === 'string' &&
    typeof track.albumArtist === 'string' &&
    typeof track.folder === 'string' &&
    typeof track.folderPath === 'string' &&
    (track.duration === null || (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration >= 0)) &&
    typeof track.format === 'string' &&
    typeof track.hasCover === 'boolean'
  );
}

function isRecord(value: unknown): value is OfflineDownloadRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OfflineDownloadRecord>;
  return (
    isTrack(record.track) &&
    typeof record.size === 'number' &&
    Number.isFinite(record.size) &&
    record.size >= 0 &&
    typeof record.mimeType === 'string' &&
    typeof record.downloadedAt === 'string'
  );
}

export function parseOfflineManifest(raw: string | null): OfflineDownloadRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((item): item is OfflineDownloadRecord => {
      if (!isRecord(item) || seen.has(item.track.id)) return false;
      seen.add(item.track.id);
      return true;
    });
  } catch {
    return [];
  }
}

export function offlineManifestKey(userId: string) {
  return `${OFFLINE_MANIFEST_PREFIX}${encodeURIComponent(userId)}`;
}

export function offlineAudioCacheName(userId: string) {
  return `${OFFLINE_AUDIO_CACHE_PREFIX}${encodeURIComponent(userId)}`;
}

export function offlineAudioUrl(trackId: string) {
  return `/offline-audio/${encodeURIComponent(trackId)}`;
}

function streamUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

function downloadJobKey(userId: string, trackId: string) {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(trackId)}`;
}

function collectionRunKey(userId: string, collectionKey: string) {
  return `${encodeURIComponent(userId)}:${collectionKey}`;
}

function pendingTrackIdsForUser(jobIds: Set<string>, userId: string | null) {
  const trackIds = new Set<string>();
  if (!userId) return trackIds;
  const prefix = `${encodeURIComponent(userId)}:`;
  for (const jobId of jobIds) {
    if (!jobId.startsWith(prefix)) continue;
    try {
      trackIds.add(decodeURIComponent(jobId.slice(prefix.length)));
    } catch {
      // Chave inválida não pertence ao escopo atual.
    }
  }
  return trackIds;
}

export function formatOfflineBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function browserHasOfflinePrimitives() {
  return typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator;
}

async function activeWorkerSupportsOfflineAudio(userId: string | null) {
  if (!browserHasOfflinePrimitives()) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller || typeof MessageChannel === 'undefined') return false;

  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      const data = event.data as { type?: unknown; offlineAudio?: unknown; version?: unknown } | null;
      resolve(Boolean(data?.type === CAPABILITY_RESPONSE && data.offlineAudio === true && Number(data.version) >= 3));
    };
    try {
      controller.postMessage({ type: CAPABILITY_REQUEST, userId }, [channel.port2]);
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
}

function readManifest(userId: string | null) {
  if (!userId) return [];
  try {
    return parseOfflineManifest(window.localStorage.getItem(offlineManifestKey(userId)));
  } catch {
    return [];
  }
}

function writeManifest(userId: string, records: OfflineDownloadRecord[]) {
  window.localStorage.setItem(offlineManifestKey(userId), JSON.stringify(records));
}

function readReferences(userId: string | null) {
  if (!userId) return createOfflineReferenceManifest();
  const existingTrackIds = readManifest(userId).map(record => record.track.id);
  try {
    return parseOfflineReferenceManifest(window.localStorage.getItem(offlineReferencesKey(userId)))
      ?? createOfflineReferenceManifest(existingTrackIds);
  } catch {
    return createOfflineReferenceManifest(existingTrackIds);
  }
}

function writeReferences(userId: string, manifest: OfflineReferenceManifest) {
  window.localStorage.setItem(offlineReferencesKey(userId), JSON.stringify(manifest));
}

async function ensureStorageHeadroom(bytes: number) {
  if (!bytes || !navigator.storage?.estimate) return;
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota || estimate.usage == null) return;
    const available = Math.max(0, estimate.quota - estimate.usage);
    if (bytes > available * 0.9) {
      throw new Error('Espaço insuficiente no dispositivo para concluir este download.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Espaço insuficiente')) throw error;
  }
}

function downloadError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('O armazenamento do navegador está cheio. Remova algum download offline e tente novamente.');
  }
  if (error instanceof Error) return error;
  return new Error('Não foi possível salvar esta música para uso offline.');
}

function collectionStatus(
  reference: OfflineCollectionReference,
  downloadedIds: ReadonlySet<string>,
  downloadingIds: ReadonlySet<string>,
  runtime: CollectionRuntimeState
): OfflineCollectionSummary {
  const key = offlineCollectionKey(reference.kind, reference.sourceId);
  const downloadedCount = reference.trackIds.reduce((count, trackId) => count + (downloadedIds.has(trackId) ? 1 : 0), 0);
  const downloadingCount = reference.trackIds.reduce((count, trackId) => count + (downloadingIds.has(trackId) ? 1 : 0), 0);
  const error = runtime.errors.get(key) ?? null;
  const paused = runtime.pausedKeys.has(key);
  const syncing = runtime.syncingKeys.has(key);

  let status: OfflineCollectionStatus = 'not-downloaded';
  if (error && downloadingCount === 0) status = 'error';
  else if (paused) status = 'paused';
  else if (syncing || downloadingCount > 0) status = 'downloading';
  else if (reference.trackIds.length > 0 && downloadedCount === reference.trackIds.length) status = 'available';
  else if (downloadedCount > 0) status = 'partial';

  return {
    key,
    reference,
    totalCount: reference.trackIds.length,
    downloadedCount,
    downloadingCount,
    status,
    error
  };
}

export function useOfflineDownloads() {
  const [userId, setUserId] = useState<string | null>(() => readOfflineUserId());
  const activeUserIdRef = useRef(userId);
  activeUserIdRef.current = userId;

  const [manifestState, setManifestState] = useState<ManifestState>(() => ({
    userId,
    records: readManifest(userId)
  }));
  const [referenceState, setReferenceState] = useState<ReferenceState>(() => ({
    userId,
    manifest: readReferences(userId)
  }));
  const [loading, setLoading] = useState(true);
  const [workerState, setWorkerState] = useState<WorkerState>(() => ({
    userId: null,
    checked: false,
    supported: false
  }));
  const [pendingState, setPendingState] = useState<PendingState>(() => ({
    userId,
    trackIds: pendingTrackIdsForUser(offlineDownloadScheduler.pendingIds, userId)
  }));
  const [collectionRuntime, setCollectionRuntime] = useState<CollectionRuntimeState>(() => ({
    userId,
    syncingKeys: new Set(),
    pausedKeys: new Set(),
    errors: new Map()
  }));
  const collectionControlsRef = useRef(new Map<string, CollectionControl>());
  const collectionPromisesRef = useRef(new Map<string, Promise<void>>());

  const scopeReady = manifestState.userId === userId;
  const referencesReady = referenceState.userId === userId;
  const workerScopeReady = workerState.userId === userId && workerState.checked;
  const workerSupported = workerScopeReady && workerState.supported;
  const records = scopeReady ? manifestState.records : [];
  const referenceManifest = referencesReady ? referenceState.manifest : createOfflineReferenceManifest();
  const downloadingIds = pendingState.userId === userId ? pendingState.trackIds : new Set<string>();
  const runtime = collectionRuntime.userId === userId
    ? collectionRuntime
    : { userId, syncingKeys: new Set<string>(), pausedKeys: new Set<string>(), errors: new Map<string, string>() };

  const replaceRecords = useCallback((ownerUserId: string, next: OfflineDownloadRecord[]) => {
    writeManifest(ownerUserId, next);
    if (activeUserIdRef.current === ownerUserId) {
      setManifestState({ userId: ownerUserId, records: next });
    }
  }, []);

  const replaceReferences = useCallback((ownerUserId: string, next: OfflineReferenceManifest) => {
    writeReferences(ownerUserId, next);
    if (activeUserIdRef.current === ownerUserId) {
      setReferenceState({ userId: ownerUserId, manifest: next });
    }
  }, []);

  const updateCollectionRuntime = useCallback((ownerUserId: string, update: (state: CollectionRuntimeState) => CollectionRuntimeState) => {
    if (activeUserIdRef.current !== ownerUserId) return;
    setCollectionRuntime(current => update(current.userId === ownerUserId
      ? current
      : { userId: ownerUserId, syncingKeys: new Set(), pausedKeys: new Set(), errors: new Map() }
    ));
  }, []);

  useEffect(() => {
    const syncUserId = () => setUserId(readOfflineUserId());
    const onStorage = (event: StorageEvent) => {
      if (event.key === OFFLINE_USER_ID_KEY || event.key === null) syncUserId();
    };

    window.addEventListener(OFFLINE_USER_CHANGED_EVENT, syncUserId);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(OFFLINE_USER_CHANGED_EVENT, syncUserId);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    setManifestState({ userId, records: readManifest(userId) });
    const references = readReferences(userId);
    if (userId) {
      try { writeReferences(userId, references); } catch { /* mutações futuras falharão de forma segura */ }
    }
    setReferenceState({ userId, manifest: references });
    setCollectionRuntime({ userId, syncingKeys: new Set(), pausedKeys: new Set(), errors: new Map() });
  }, [userId]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_OFFLINE_MANIFEST_KEY);
    } catch {
      // Manifesto legado sem ownership é descartado em modo best-effort.
    }
    if (browserHasOfflinePrimitives()) {
      void caches.delete(LEGACY_OFFLINE_AUDIO_CACHE_NAME).catch(() => undefined);
    }
  }, []);

  useEffect(() => offlineDownloadScheduler.subscribe(jobIds => {
    setPendingState({ userId, trackIds: pendingTrackIdsForUser(jobIds, userId) });
  }), [userId]);

  useEffect(() => {
    if (!browserHasOfflinePrimitives()) {
      setWorkerState({ userId, checked: true, supported: false });
      return;
    }

    let disposed = false;
    const probe = async () => {
      const value = await activeWorkerSupportsOfflineAudio(userId);
      if (disposed) return;
      setWorkerState({ userId, checked: true, supported: value });
    };

    const onControllerChange = () => { void probe(); };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void probe();
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [userId]);

  useEffect(() => {
    let disposed = false;
    if (!workerScopeReady) {
      setLoading(Boolean(userId));
      return;
    }

    if (!workerSupported || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const scopedRecords = readManifest(userId);
        const cache = await caches.open(offlineAudioCacheName(userId));
        const available: OfflineDownloadRecord[] = [];
        const expectedUrls = new Set(scopedRecords.map(record => new URL(streamUrl(record.track.id), window.location.origin).href));

        for (const record of scopedRecords) {
          const cached = await cache.match(streamUrl(record.track.id));
          if (cached) available.push(record);
        }

        const keys = await cache.keys();
        await Promise.all(keys
          .filter(request => !expectedUrls.has(request.url))
          .map(request => cache.delete(request))
        );

        if (available.length !== scopedRecords.length) {
          replaceRecords(userId, available);
        } else if (!disposed && activeUserIdRef.current === userId) {
          setManifestState({ userId, records: scopedRecords });
        }
      } catch {
        // Reconciliação é best-effort. Se o armazenamento local estiver indisponível,
        // mantemos o manifesto em memória e tentamos novamente numa próxima inicialização.
      } finally {
        if (!disposed && activeUserIdRef.current === userId) setLoading(false);
      }
    })();

    return () => { disposed = true; };
  }, [replaceRecords, userId, workerScopeReady, workerSupported]);

  const downloadedIds = useMemo(() => new Set(records.map(record => record.track.id)), [records]);
  const individualDownloadedIds = useMemo(() => new Set(referenceManifest.individualTrackIds), [referenceManifest]);
  const collectionDownloadedIds = useMemo(() => collectionReferencedTrackIds(referenceManifest), [referenceManifest]);
  const tracks = useMemo(() => records.map(record => record.track), [records]);
  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.size, 0), [records]);
  const supported = Boolean(userId) && scopeReady && referencesReady && workerSupported && !loading;

  const removePhysicalDownload = useCallback(async (ownerUserId: string, trackId: string) => {
    const current = readManifest(ownerUserId);
    if (!current.some(record => record.track.id === trackId)) return;
    const next = current.filter(record => record.track.id !== trackId);

    try {
      replaceRecords(ownerUserId, next);
    } catch {
      // Sem persistir o manifesto físico não apagamos os bytes, evitando
      // anunciar uma faixa que já não existe no cache.
      return;
    }

    try {
      const cache = await caches.open(offlineAudioCacheName(ownerUserId));
      await cache.delete(streamUrl(trackId));
    } catch {
      // Blob órfão é removido pela reconciliação na próxima inicialização.
    }
  }, [replaceRecords]);

  const ensurePhysicalDownload = useCallback(async (track: Track, ownerUserId: string) => {
    if (readManifest(ownerUserId).some(record => record.track.id === track.id)) return;
    if (!isOfflineTrackReferenced(readReferences(ownerUserId), track.id)) return;

    await offlineDownloadScheduler.enqueue(downloadJobKey(ownerUserId, track.id), async () => {
      if (readManifest(ownerUserId).some(record => record.track.id === track.id)) return;
      if (!isOfflineTrackReferenced(readReferences(ownerUserId), track.id)) return;
      const url = streamUrl(track.id);

      try {
        const { response, storedByServiceWorker } = await fetchOfflineTrackResponse(track.id, ownerUserId, url);
        if (!response.ok) throw new Error(`Não foi possível baixar a música (HTTP ${response.status}).`);
        if (response.status !== 200) throw new Error('O servidor não retornou o arquivo completo para download offline.');

        const sizeHeader = Number(response.headers.get('content-length') || 0);
        const size = Number.isFinite(sizeHeader) && sizeHeader > 0 ? sizeHeader : 0;
        const mimeType = response.headers.get('content-type') || 'application/octet-stream';
        if (!storedByServiceWorker) await ensureStorageHeadroom(size);

        const cache = await caches.open(offlineAudioCacheName(ownerUserId));
        if (!storedByServiceWorker) await cache.put(url, response);

        // A referência pode ter sido removida enquanto o fetch estava em voo.
        // Nesse caso não publicamos o artefato físico e limpamos o blob.
        if (!isOfflineTrackReferenced(readReferences(ownerUserId), track.id)) {
          try { await cache.delete(url); } catch { /* reconciliação futura limpa o órfão */ }
          return;
        }

        const record: OfflineDownloadRecord = {
          track,
          size,
          mimeType,
          downloadedAt: new Date().toISOString()
        };

        try {
          const current = readManifest(ownerUserId);
          replaceRecords(ownerUserId, [record, ...current.filter(item => item.track.id !== track.id)]);
        } catch (error) {
          try { await cache.delete(url); } catch { /* órfão será reconciliado depois */ }
          throw error;
        }

        try { await navigator.storage?.persist?.(); } catch { /* persistência é best-effort */ }
      } catch (error) {
        throw downloadError(error);
      }
    });
  }, [replaceRecords]);

  const download = useCallback(async (track: Track) => {
    const ownerUserId = userId;
    if (!ownerUserId) throw new Error('Faça login novamente antes de salvar músicas offline.');
    if (!workerSupported || loading) throw new Error('Feche e abra novamente o Home Music para ativar o suporte a downloads offline.');

    const references = addIndividualOfflineReference(readReferences(ownerUserId), track.id);
    replaceReferences(ownerUserId, references);
    await ensurePhysicalDownload(track, ownerUserId);
  }, [ensurePhysicalDownload, loading, replaceReferences, userId, workerSupported]);

  const remove = useCallback(async (trackId: string) => {
    const ownerUserId = userId;
    if (!ownerUserId || !browserHasOfflinePrimitives()) return;
    const current = readReferences(ownerUserId);
    const hadIndividualReference = current.individualTrackIds.includes(trackId);
    const next = removeIndividualOfflineReference(current, trackId);

    if (hadIndividualReference) {
      replaceReferences(ownerUserId, next);
      if (isOfflineTrackReferenced(next, trackId)) return;
      await removePhysicalDownload(ownerUserId, trackId);
      return;
    }

    if (isOfflineTrackReferenced(current, trackId)) {
      throw new Error('Esta música está disponível por uma coleção offline. Remova ou atualize a coleção para liberar o arquivo.');
    }

    // Estado órfão de versões/interrupções anteriores: é seguro limpar porque
    // nenhuma referência lógica ainda depende do arquivo.
    await removePhysicalDownload(ownerUserId, trackId);
  }, [removePhysicalDownload, replaceReferences, userId]);

  const setCollectionRuntimeError = useCallback((ownerUserId: string, key: string, message: string | null) => {
    updateCollectionRuntime(ownerUserId, current => {
      const errors = new Map(current.errors);
      if (message) errors.set(key, message);
      else errors.delete(key);
      return { ...current, errors };
    });
  }, [updateCollectionRuntime]);

  const syncCollection = useCallback((input: OfflineCollectionDownloadInput) => {
    const ownerUserId = userId;
    if (!ownerUserId) return Promise.reject(new Error('Faça login novamente antes de salvar coleções offline.'));
    if (!workerSupported || loading) return Promise.reject(new Error('Feche e abra novamente o Home Music para ativar o suporte a downloads offline.'));
    if (input.tracks.length === 0) return Promise.reject(new Error('Esta coleção não possui músicas para salvar offline.'));

    const key = offlineCollectionKey(input.kind, input.sourceId);
    const runKey = collectionRunKey(ownerUserId, key);
    const existing = collectionPromisesRef.current.get(runKey);
    if (existing) return existing;

    const operation = (async () => {
      const previous = findOfflineCollectionReference(readReferences(ownerUserId), input.kind, input.sourceId);
      const trackIds = input.tracks.map(track => track.id);
      const nextReferences = upsertOfflineCollectionReference(readReferences(ownerUserId), {
        kind: input.kind,
        sourceId: input.sourceId,
        name: input.name,
        trackIds
      });

      // A referência desejada é persistida antes de baixar bytes. Assim uma
      // falha de rede/quota resulta em estado parcial recuperável, não órfão.
      replaceReferences(ownerUserId, nextReferences);
      const control: CollectionControl = { paused: false, cancelled: false };
      collectionControlsRef.current.set(runKey, control);
      setCollectionRuntimeError(ownerUserId, key, null);
      updateCollectionRuntime(ownerUserId, current => {
        const syncingKeys = new Set(current.syncingKeys);
        const pausedKeys = new Set(current.pausedKeys);
        syncingKeys.add(key);
        pausedKeys.delete(key);
        return { ...current, syncingKeys, pausedKeys };
      });

      try {
        // Em uma atualização explícita, referências antigas deixam de valer
        // imediatamente. Só apagamos bytes que não sejam compartilhados.
        if (previous) {
          const staleTrackIds = previous.trackIds.filter(trackId => !trackIds.includes(trackId));
          for (const trackId of unreferencedOfflineTrackIds(nextReferences, staleTrackIds)) {
            await removePhysicalDownload(ownerUserId, trackId);
          }
        }

        const failures: unknown[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < input.tracks.length) {
            if (control.cancelled || control.paused) return;
            const track = input.tracks[cursor++];
            if (!track) return;
            try {
              await ensurePhysicalDownload(track, ownerUserId);
            } catch (error) {
              failures.push(error);
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(3, input.tracks.length) }, () => worker()));

        if (failures.length > 0 && !control.cancelled && !control.paused) {
          const message = `${failures.length} de ${input.tracks.length} músicas não puderam ser salvas. Tente atualizar a coleção novamente.`;
          setCollectionRuntimeError(ownerUserId, key, message);
          throw new Error(message);
        }
      } finally {
        updateCollectionRuntime(ownerUserId, current => {
          const syncingKeys = new Set(current.syncingKeys);
          syncingKeys.delete(key);
          return { ...current, syncingKeys };
        });
        if (collectionControlsRef.current.get(runKey) === control) {
          collectionControlsRef.current.delete(runKey);
        }
      }
    })();

    collectionPromisesRef.current.set(runKey, operation);
    void operation.then(
      () => {
        if (collectionPromisesRef.current.get(runKey) === operation) collectionPromisesRef.current.delete(runKey);
      },
      () => {
        if (collectionPromisesRef.current.get(runKey) === operation) collectionPromisesRef.current.delete(runKey);
      }
    );
    return operation;
  }, [ensurePhysicalDownload, loading, removePhysicalDownload, replaceReferences, setCollectionRuntimeError, updateCollectionRuntime, userId, workerSupported]);

  const pauseCollection = useCallback((kind: OfflineCollectionKind, sourceId: string) => {
    const ownerUserId = userId;
    if (!ownerUserId) return;
    const key = offlineCollectionKey(kind, sourceId);
    const control = collectionControlsRef.current.get(collectionRunKey(ownerUserId, key));
    if (control) control.paused = true;
    updateCollectionRuntime(ownerUserId, current => {
      const pausedKeys = new Set(current.pausedKeys);
      const syncingKeys = new Set(current.syncingKeys);
      pausedKeys.add(key);
      syncingKeys.delete(key);
      return { ...current, pausedKeys, syncingKeys };
    });
  }, [updateCollectionRuntime, userId]);

  const removeCollection = useCallback(async (kind: OfflineCollectionKind, sourceId: string) => {
    const ownerUserId = userId;
    if (!ownerUserId || !browserHasOfflinePrimitives()) return;
    const key = offlineCollectionKey(kind, sourceId);
    const runKey = collectionRunKey(ownerUserId, key);
    const control = collectionControlsRef.current.get(runKey);
    if (control) control.cancelled = true;

    const current = readReferences(ownerUserId);
    const reference = findOfflineCollectionReference(current, kind, sourceId);
    if (!reference) return;
    const next = removeOfflineCollectionReference(current, kind, sourceId);
    replaceReferences(ownerUserId, next);

    updateCollectionRuntime(ownerUserId, state => {
      const syncingKeys = new Set(state.syncingKeys);
      const pausedKeys = new Set(state.pausedKeys);
      const errors = new Map(state.errors);
      syncingKeys.delete(key);
      pausedKeys.delete(key);
      errors.delete(key);
      return { ...state, syncingKeys, pausedKeys, errors };
    });

    for (const trackId of unreferencedOfflineTrackIds(next, reference.trackIds)) {
      await removePhysicalDownload(ownerUserId, trackId);
    }
  }, [removePhysicalDownload, replaceReferences, updateCollectionRuntime, userId]);

  const collections = useMemo<OfflineCollectionSummary[]>(() => (
    referenceManifest.collections.map(reference => collectionStatus(reference, downloadedIds, downloadingIds, runtime))
  ), [downloadedIds, downloadingIds, referenceManifest, runtime]);

  const getCollectionState = useCallback((input: OfflineCollectionInput): OfflineCollectionTargetState => {
    const key = offlineCollectionKey(input.kind, input.sourceId);
    const reference = findOfflineCollectionReference(referenceManifest, input.kind, input.sourceId);
    if (!reference) {
      return {
        key,
        reference: null,
        totalCount: input.trackIds.length,
        downloadedCount: 0,
        downloadingCount: 0,
        status: 'not-downloaded',
        error: null,
        outdated: false
      };
    }
    const summary = collectionStatus(reference, downloadedIds, downloadingIds, runtime);
    return {
      ...summary,
      outdated: !offlineCollectionMatches(reference, input)
    };
  }, [downloadedIds, downloadingIds, referenceManifest, runtime]);

  return {
    records,
    tracks,
    downloadedIds,
    individualDownloadedIds,
    collectionDownloadedIds,
    downloadingIds,
    collections,
    totalBytes,
    loading,
    supported,
    download,
    remove,
    syncCollection,
    pauseCollection,
    removeCollection,
    getCollectionState
  };
}

export type OfflineDownloads = ReturnType<typeof useOfflineDownloads>;
