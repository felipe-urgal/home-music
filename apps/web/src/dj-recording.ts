export const DJ_RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4'
] as const;

type MediaRecorderSupport = {
  isTypeSupported?: (mimeType: string) => boolean;
};

export function selectDjRecordingMimeType(MediaRecorderConstructor: MediaRecorderSupport | undefined) {
  if (!MediaRecorderConstructor) return null;
  const supports = MediaRecorderConstructor.isTypeSupported;
  if (typeof supports !== 'function') return '';
  for (const mimeType of DJ_RECORDING_MIME_CANDIDATES) {
    if (supports.call(MediaRecorderConstructor, mimeType)) return mimeType;
  }
  return null;
}

export function djRecordingExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  return 'webm';
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function djRecordingFilename(date: Date, mimeType: string) {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
  return `home-music-dj-${stamp}.${djRecordingExtension(mimeType)}`;
}

export function downloadDjRecording(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
