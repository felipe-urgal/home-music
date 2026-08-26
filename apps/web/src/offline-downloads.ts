import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { offlineDownloadScheduler } from './offline-download-scheduler';

export const OFFLINE_AUDIO_CACHE_NAME = 'home-music-offline-audio-v1';
const OFFLINE_MANIFEST_KEY = 'home-music:offline-tracks:v1';
const CAPABILITY_REQUEST = 'HOME_MUSIC_GET_CAPABILITIES';
const CAPABILITY_RESPONSE = 'HOME_MUSIC_CAPABILITIES';

export type OfflineDownloadRecord = {
  track: Track;
  size: number;
  mimeType: string;
  downloadedAt: string;
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

export function offlineAudioUrl(trackId: string) {
  return `/offline-audio/${encodeURIComponent(trackId)}`;
}

function streamUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
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

async function activeWorkerSupportsOfflineAudio() {
  if (!browserHasOfflinePrimitives()) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller || typeof MessageChannel === 'undefined') return false;

  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      const data = event.data as { type?: unknown; offlineAudio?: unknown; version?: unknown } | null;
      resolve(Boolean(data?.type === CAPABILITY_RESPONSE && data.offlineAudio === true && Number(data.version) >= 2));
    };
    try {
      controller.postMessage({ type: CAPABILITY_REQUEST }, [channel.port2]);
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
}

function readManifest() {
  try {
    return parseOfflineManifest(window.localStorage.getItem(OFFLINE_MANIFEST_KEY));
  } catch {
    return [];
  }
}

function writeManifest(records: OfflineDownloadRecord[]) {
  window.localStorage.setItem(OFFLINE_MANIFEST_KEY, JSON.stringify(records));
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

export function useOfflineDownloads() {
  const [records, setRecords] = useState<OfflineDownloadRecord[]>(() => readManifest());
  const recordsRef = useRef(records);
  const [loading, setLoading] = useState(true);
  const [capabilityChecked, setCapabilityChecked] = useState(false);
  const [workerSupported, setWorkerSupported] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(() => offlineDownloadScheduler.pendingIds);

  const commitRecords = useCallback((next: OfflineDownloadRecord[]) => {
    writeManifest(next);
    recordsRef.current = next;
    setRecords(next);
  }, []);

  useEffect(() => offlineDownloadScheduler.subscribe(setDownloadingIds), []);

  useEffect(() => {
    if (!browserHasOfflinePrimitives()) {
      setCapabilityChecked(true);
      setWorkerSupported(false);
      return;
    }

    let disposed = false;
    const probe = async () => {
      const value = await activeWorkerSupportsOfflineAudio();
      if (disposed) return;
      setWorkerSupported(value);
      setCapabilityChecked(true);
    };

    const onControllerChange = () => { void probe(); };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void probe();
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!capabilityChecked) return;

    if (!workerSupported) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const cache = await caches.open(OFFLINE_AUDIO_CACHE_NAME);
        const available: OfflineDownloadRecord[] = [];
        const expectedUrls = new Set(recordsRef.current.map(record => new URL(streamUrl(record.track.id), window.location.origin).href));

        for (const record of recordsRef.current) {
          const cached = await cache.match(streamUrl(record.track.id));
          if (cached) available.push(record);
        }

        const keys = await cache.keys();
        await Promise.all(keys
          .filter(request => !expectedUrls.has(request.url))
          .map(request => cache.delete(request))
        );

        if (!disposed && available.length !== recordsRef.current.length) commitRecords(available);
      } catch {
        // Reconciliação é best-effort. Se o armazenamento local estiver indisponível,
        // mantemos o manifesto em memória e tentamos novamente numa próxima inicialização.
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    return () => { disposed = true; };
  }, [capabilityChecked, commitRecords, workerSupported]);

  const downloadedIds = useMemo(() => new Set(records.map(record => record.track.id)), [records]);
  const tracks = useMemo(() => records.map(record => record.track), [records]);
  const totalBytes = useMemo(() => records.reduce((sum, record) => sum + record.size, 0), [records]);
  const supported = workerSupported && !loading;

  const download = useCallback(async (track: Track) => {
    if (!workerSupported || loading) throw new Error('Feche e abra novamente o Home Music para ativar o suporte a downloads offline.');
    if (recordsRef.current.some(record => record.track.id === track.id)) return;

    await offlineDownloadScheduler.enqueue(track.id, async () => {
      if (recordsRef.current.some(record => record.track.id === track.id)) return;
      const url = streamUrl(track.id);

      try {
        const response = await apiFetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Não foi possível baixar a música (HTTP ${response.status}).`);
        if (response.status !== 200) throw new Error('O servidor não retornou o arquivo completo para download offline.');

        const sizeHeader = Number(response.headers.get('content-length') || 0);
        const size = Number.isFinite(sizeHeader) && sizeHeader > 0 ? sizeHeader : 0;
        const mimeType = response.headers.get('content-type') || 'application/octet-stream';
        await ensureStorageHeadroom(size);

        const cache = await caches.open(OFFLINE_AUDIO_CACHE_NAME);
        await cache.put(url, response);

        const record: OfflineDownloadRecord = {
          track,
          size,
          mimeType,
          downloadedAt: new Date().toISOString()
        };

        try {
          commitRecords([record, ...recordsRef.current.filter(item => item.track.id !== track.id)]);
        } catch (error) {
          try { await cache.delete(url); } catch { /* órfão será reconciliado depois */ }
          throw error;
        }

        try { await navigator.storage?.persist?.(); } catch { /* persistência é best-effort */ }
      } catch (error) {
        throw downloadError(error);
      }
    });
  }, [commitRecords, loading, workerSupported]);

  const remove = useCallback(async (trackId: string) => {
    if (!browserHasOfflinePrimitives()) return;
    const next = recordsRef.current.filter(record => record.track.id !== trackId);

    try {
      commitRecords(next);
    } catch {
      // Se o manifesto não puder ser persistido, não removemos o áudio para
      // evitar um estado em que a UI ainda anuncia um download que já sumiu.
      return;
    }

    try {
      const cache = await caches.open(OFFLINE_AUDIO_CACHE_NAME);
      await cache.delete(streamUrl(trackId));
    } catch {
      // O registro já foi removido do manifesto. Qualquer blob órfão será
      // eliminado pela reconciliação na próxima inicialização.
    }
  }, [commitRecords]);

  return {
    records,
    tracks,
    downloadedIds,
    downloadingIds,
    totalBytes,
    loading,
    supported,
    download,
    remove
  };
}

export type OfflineDownloads = ReturnType<typeof useOfflineDownloads>;
