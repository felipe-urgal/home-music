import type { AdminTrackCoverResponse } from '@home-music/shared';

export const MAX_ADMIN_COVER_BYTES = 8 * 1024 * 1024;
export const ADMIN_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function validateAdminCoverFile(file: Pick<File, 'size' | 'type'>) {
  if (!(ADMIN_COVER_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Use uma imagem JPEG, PNG ou WebP.');
  }
  if (file.size <= 0) throw new Error('O arquivo de capa está vazio.');
  if (file.size > MAX_ADMIN_COVER_BYTES) throw new Error('A capa deve ter no máximo 8 MiB.');
}

export function adminCoverUrl(trackId: string, cover: AdminTrackCoverResponse) {
  if (!cover.effectiveHasCover) return null;
  const version = cover.override?.version;
  return `/api/tracks/${encodeURIComponent(trackId)}/cover${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}
