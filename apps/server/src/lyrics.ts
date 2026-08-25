import path from 'node:path';
import type { LyricsResponse } from '@home-music/shared';
import { openRegularFileInside } from './security.js';

const MAX_LYRICS_BYTES = 512 * 1024;
const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;
const METADATA_PATTERN = /^\[(ar|al|ti|au|by|offset|re|ve):.*\]$/i;

export function parseLyrics(content: string, source: LyricsResponse['source']): LyricsResponse {
  const rawLines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const offsetMatch = rawLines.map(line => line.trim()).find(line => /^\[offset:[+-]?\d+\]$/i.test(line));
  const offsetSeconds = offsetMatch ? Number(offsetMatch.slice(8, -1)) / 1000 : 0;
  const lines: LyricsLine[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || METADATA_PATTERN.test(line.trim())) continue;

    const timestamps = [...line.matchAll(TIMESTAMP_PATTERN)];
    const text = line.replace(TIMESTAMP_PATTERN, '').trim();

    if (timestamps.length) {
      for (const match of timestamps) {
        lines.push({
          time: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + offsetSeconds),
          text
        });
      }
    } else {
      lines.push({ time: null, text: line.trim() });
    }
  }

  lines.sort((left, right) => (left.time ?? Number.POSITIVE_INFINITY) - (right.time ?? Number.POSITIVE_INFINITY));

  return {
    source,
    synchronized: lines.some(line => line.time != null),
    lines
  };
}

export async function readTrackLyrics(libraryRoot: string, audioPath: string): Promise<LyricsResponse | null> {
  const extension = path.extname(audioPath);
  const stem = audioPath.slice(0, -extension.length);
  const candidates: Array<{ path: string; source: LyricsResponse['source'] }> = [
    { path: `${stem}.lrc`, source: 'lrc' },
    { path: `${audioPath}.lrc`, source: 'lrc' },
    { path: `${stem}.txt`, source: 'txt' }
  ];

  for (const candidate of candidates) {
    let opened;
    try {
      opened = await openRegularFileInside(libraryRoot, candidate.path);
    } catch {
      continue;
    }

    try {
      if (opened.stat.size > MAX_LYRICS_BYTES) continue;
      const content = await opened.handle.readFile({ encoding: 'utf8' });
      const lyrics = parseLyrics(content, candidate.source);
      if (lyrics.lines.length) return lyrics;
    } finally {
      await opened.handle.close();
    }
  }

  return null;
}
