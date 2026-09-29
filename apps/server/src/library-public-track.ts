import type { IndexedTrack } from './library.js';

export type PublicIndexedTrack = Omit<IndexedTrack, 'filePath' | 'mimeType' | 'fileSize' | 'mtimeMs' | 'rhythmAnalysisCurrent' | 'waveformAnalysisCurrent' | 'keyAnalysisCurrent'>;

export function toPublicTrack(track: IndexedTrack): PublicIndexedTrack {
  const {
    filePath: _filePath,
    mimeType: _mimeType,
    fileSize: _fileSize,
    mtimeMs: _mtimeMs,
    rhythmAnalysisCurrent: _rhythmAnalysisCurrent,
    waveformAnalysisCurrent: _waveformAnalysisCurrent,
    keyAnalysisCurrent: _keyAnalysisCurrent,
    ...safe
  } = track;
  return safe;
}
