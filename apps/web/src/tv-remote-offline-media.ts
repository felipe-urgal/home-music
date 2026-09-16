import { offlineAudioCacheName } from './offline-downloads';
import { readOfflineUserId } from './offline-user';
import { TV_REMOTE_MEDIA_MAX_BYTES } from './tv-remote-media';

export type TvRemoteOfflineMedia = {
  trackId: string;
  blob: Blob;
  mimeType: string;
  size: number;
};

function cachedStreamUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

export async function readTvRemoteOfflineMedia(trackId: string): Promise<TvRemoteOfflineMedia> {
  if (!trackId.trim()) throw new Error('Música offline inválida.');
  const userId = readOfflineUserId();
  if (!userId) throw new Error('Nenhum usuário offline está associado a este dispositivo.');
  if (typeof caches === 'undefined') throw new Error('O armazenamento offline não está disponível neste navegador.');

  const cache = await caches.open(offlineAudioCacheName(userId));
  const response = await cache.match(cachedStreamUrl(trackId));
  if (!response || !response.ok || response.status !== 200) {
    throw new Error('A música baixada não está mais disponível neste dispositivo.');
  }

  const blob = await response.blob();
  const mimeType = (response.headers.get('Content-Type') || blob.type).split(';')[0]?.trim() ?? '';
  if (!mimeType.startsWith('audio/')) throw new Error('O download salvo não contém um formato de áudio válido.');
  if (blob.size <= 0) throw new Error('O download salvo está vazio.');
  if (blob.size > TV_REMOTE_MEDIA_MAX_BYTES) throw new Error('A música excede o limite de transmissão para a TV.');

  return { trackId, blob, mimeType, size: blob.size };
}
