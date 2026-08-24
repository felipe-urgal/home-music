import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import type { Track } from '@home-music/shared';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'
]);

export type IndexedTrack = Track & {
  filePath: string;
  mimeType: string;
  cover?: {
    data: Uint8Array;
    format: string;
  };
};

const mimeByExtension: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
};

function trackId(filePath: string) {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function pickCover(metadata: IAudioMetadata) {
  const picture = metadata.common.picture?.[0];
  if (!picture) return undefined;

  return {
    data: picture.data,
    format: picture.format
  };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }

    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function scanLibrary(musicDir: string): Promise<IndexedTrack[]> {
  const files = await walk(musicDir);
  const tracks: IndexedTrack[] = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    let metadata: IAudioMetadata | null = null;

    try {
      metadata = await parseFile(filePath, { duration: true });
    } catch {
      // Arquivos reproduzíveis continuam aparecendo mesmo sem metadados válidos.
    }

    const fallbackTitle = path.basename(filePath, ext);

    tracks.push({
      id: trackId(filePath),
      title: metadata?.common.title?.trim() || fallbackTitle,
      artist: metadata?.common.artist?.trim() || 'Artista desconhecido',
      album: metadata?.common.album?.trim() || 'Álbum desconhecido',
      duration: metadata?.format.duration ?? null,
      format: ext.replace('.', '').toUpperCase(),
      hasCover: Boolean(metadata?.common.picture?.length),
      filePath,
      mimeType: mimeByExtension[ext] || 'application/octet-stream',
      cover: metadata ? pickCover(metadata) : undefined
    });
  }

  return tracks.sort((a, b) =>
    a.artist.localeCompare(b.artist, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR')
  );
}
