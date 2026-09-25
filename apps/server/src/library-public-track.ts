import type { IndexedTrack } from './library.js';

export type PublicIndexedTrack = Omit<IndexedTrack, 'filePath' | 'mimeType' | 'fileSize' | 'mtimeMs' | 'rhythmAnalysisCurrent'>;

export function toPublicTrack(track: IndexedTrack): PublicIndexedTrack {
  const {
    filePath: _filePath,
    mimeType: _mimeType,
    fileSize: _fileSize,
    mtimeMs: _mtimeMs,
    rhythmAnalysisCurrent: _rhythmAnalysisCurrent,
    ...safe
  } = track;
  return safe;
}
