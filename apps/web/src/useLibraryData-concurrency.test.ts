import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('useLibraryData request ordering', () => {
  it('protege snapshots e playlists contra respostas concorrentes obsoletas', () => {
    const source = readFileSync(new URL('./useLibraryData.ts', import.meta.url), 'utf8');
    expect(source).toContain('generation !== libraryRequestGeneration.current');
    expect(source).toContain('incomingRevision < appliedLibraryRevision.current');
    expect(source).toContain('generation === playlistRequestGeneration.current');
  });
});
