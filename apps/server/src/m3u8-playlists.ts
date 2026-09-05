import { createHash } from 'node:crypto';
import path from 'node:path';

export const M3U8_MAX_BYTES = 256 * 1024;
export const M3U8_MAX_LINES = 10_000;
export const M3U8_MAX_ENTRIES = 5_000;
export const M3U8_MAX_LINE_CHARS = 4_096;

export type M3u8LibraryTrack = {
  id: string;
  filePath: string;
};

export type M3u8LibrarySnapshot = {
  root: string;
  allTracks: readonly M3u8LibraryTrack[];
  getTrack(trackId: string): M3u8LibraryTrack | undefined;
};

export type M3u8PreviewEntry =
  | {
      line: number;
      status: 'resolved';
      relativePath: string;
      trackId: string;
    }
  | {
      line: number;
      status: 'not-found';
      relativePath: string;
    }
  | {
      line: number;
      status: 'invalid';
      value: string;
      reason: 'line-too-long' | 'absolute-path' | 'external-uri' | 'path-traversal' | 'invalid-path';
    }
  | {
      line: number;
      status: 'ambiguous';
      relativePath: string;
    };

export type M3u8Preview = {
  previewHash: string;
  entries: M3u8PreviewEntry[];
  summary: {
    total: number;
    resolved: number;
    notFound: number;
    invalid: number;
    ambiguous: number;
  };
};

export class M3u8InputError extends Error {
  constructor(
    public readonly code: 'invalid-content' | 'file-too-large' | 'too-many-lines' | 'too-many-entries',
    message: string,
    public readonly statusCode: 400 | 413
  ) {
    super(message);
    this.name = 'M3u8InputError';
  }
}

export function previewM3u8(content: unknown, library: M3u8LibrarySnapshot): M3u8Preview {
  if (typeof content !== 'string') {
    throw new M3u8InputError('invalid-content', 'Conteúdo M3U8 inválido.', 400);
  }
  if (Buffer.byteLength(content, 'utf8') > M3U8_MAX_BYTES) {
    throw new M3u8InputError('file-too-large', 'Playlist M3U8 excede 256 KiB.', 413);
  }

  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  if (lines.length > M3U8_MAX_LINES) {
    throw new M3u8InputError('too-many-lines', 'Playlist M3U8 excede 10.000 linhas.', 413);
  }

  const libraryIndex = buildLibraryPathIndex(library);
  const entries: M3u8PreviewEntry[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (entries.length >= M3U8_MAX_ENTRIES) {
      throw new M3u8InputError('too-many-entries', 'Playlist M3U8 excede 5.000 entradas.', 413);
    }

    const line = index + 1;
    if (trimmed.length > M3U8_MAX_LINE_CHARS) {
      entries.push({
        line,
        status: 'invalid',
        value: trimmed.slice(0, 256),
        reason: 'line-too-long'
      });
      continue;
    }

    const parsed = parsePortableRelativePath(trimmed);
    if (!parsed.ok) {
      entries.push({
        line,
        status: 'invalid',
        value: trimmed,
        reason: parsed.reason
      });
      continue;
    }

    const matches = libraryIndex.get(parsed.relativePath) ?? [];
    if (matches.length === 0) {
      entries.push({ line, status: 'not-found', relativePath: parsed.relativePath });
    } else if (matches.length > 1) {
      entries.push({ line, status: 'ambiguous', relativePath: parsed.relativePath });
    } else {
      entries.push({
        line,
        status: 'resolved',
        relativePath: parsed.relativePath,
        trackId: matches[0]!
      });
    }
  }

  return {
    previewHash: hashM3u8Content(content),
    entries,
    summary: {
      total: entries.length,
      resolved: entries.filter(entry => entry.status === 'resolved').length,
      notFound: entries.filter(entry => entry.status === 'not-found').length,
      invalid: entries.filter(entry => entry.status === 'invalid').length,
      ambiguous: entries.filter(entry => entry.status === 'ambiguous').length
    }
  };
}

export function hashM3u8Content(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function trackIdsFromPreview(preview: M3u8Preview) {
  return preview.entries.flatMap(entry => entry.status === 'resolved' ? [entry.trackId] : []);
}

export function exportM3u8(trackIds: readonly string[], library: M3u8LibrarySnapshot) {
  const byId = new Map(
    library.allTracks
      .filter(track => Boolean(library.getTrack(track.id)))
      .map(track => [track.id, track])
  );
  const lines = ['#EXTM3U'];
  const omittedTrackIds: string[] = [];

  for (const trackId of trackIds) {
    const track = byId.get(trackId);
    if (!track) {
      omittedTrackIds.push(trackId);
      continue;
    }
    const relativePath = toLibraryRelativePath(library.root, track.filePath);
    if (!relativePath) {
      omittedTrackIds.push(trackId);
      continue;
    }
    lines.push(relativePath);
  }

  return {
    content: `${lines.join('\n')}\n`,
    omittedTrackIds
  };
}

function buildLibraryPathIndex(library: M3u8LibrarySnapshot) {
  const index = new Map<string, string[]>();
  if (!library.root) return index;

  for (const track of library.allTracks) {
    if (!library.getTrack(track.id)) continue;
    const relativePath = toLibraryRelativePath(library.root, track.filePath);
    if (!relativePath) continue;
    const ids = index.get(relativePath) ?? [];
    ids.push(track.id);
    index.set(relativePath, ids);
  }
  return index;
}

function toLibraryRelativePath(root: string, filePath: string) {
  if (!root) return null;
  const relative = path.relative(root, filePath);
  if (!relative || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  if (segments.some(segment => segment === '..')) return null;

  const portable = segments.join('/');
  const parsed = parsePortableRelativePath(portable);
  if (!parsed.ok || parsed.relativePath !== portable) return null;
  return portable;
}

function parsePortableRelativePath(value: string):
  | { ok: true; relativePath: string }
  | { ok: false; reason: 'absolute-path' | 'external-uri' | 'path-traversal' | 'invalid-path' } {
  if (
    value.includes('\0')
    || value.includes('\r')
    || value.includes('\n')
    || value.startsWith('#')
    || value !== value.trim()
  ) {
    return { ok: false, reason: 'invalid-path' };
  }

  const normalizedSeparators = value.replace(/\\/g, '/');
  if (
    normalizedSeparators.startsWith('/')
    || /^[A-Za-z]:\//.test(normalizedSeparators)
    || path.win32.isAbsolute(value)
  ) {
    return { ok: false, reason: 'absolute-path' };
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalizedSeparators)) {
    return { ok: false, reason: 'external-uri' };
  }

  const segments = normalizedSeparators.split('/');
  if (segments.some(segment => segment === '..')) {
    return { ok: false, reason: 'path-traversal' };
  }

  const canonical = segments.filter(segment => segment && segment !== '.').join('/');
  if (!canonical || canonical.length > M3U8_MAX_LINE_CHARS) {
    return { ok: false, reason: 'invalid-path' };
  }
  return { ok: true, relativePath: canonical };
}
