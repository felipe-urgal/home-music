import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import type { LyricsResponse, Track } from '@home-music/shared';
import { HeavyWorkQueue } from './heavy-work-queue.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LocalLyricsCandidateStore } from './local-lyrics-candidates.js';
import { LocalLyricsWhisperService } from './local-lyrics-whisper.js';
import { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';

const TRACK: Track = {
  id: 'track-1',
  title: 'Faixa Sintética',
  artist: 'Artista de Teste',
  album: 'Álbum de Teste',
  albumArtist: 'Artista de Teste',
  folder: 'Album',
  folderPath: 'Album',
  duration: 120,
  format: '.flac',
  hasCover: false
};

async function executable(filePath: string, body: string) {
  await writeFile(filePath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

async function fixture(lyrics: LyricsResponse | null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-local-lyrics-'));
  const musicRoot = path.join(root, 'music');
  const databasePath = path.join(root, 'library.db');
  const audioPath = path.join(musicRoot, 'track.flac');
  const modelPath = path.join(root, 'model.bin');
  const ffmpegPath = path.join(root, 'fake-ffmpeg');
  const whisperPath = path.join(root, 'fake-whisper');
  await import('node:fs/promises').then(fs => fs.mkdir(musicRoot, { recursive: true }));
  await writeFile(audioPath, 'fake-audio');
  await writeFile(modelPath, 'fake-model');
  await executable(ffmpegPath, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-version')) { console.log('ffmpeg fake 1.0'); process.exit(0); }
fs.writeFileSync(args[args.length - 1], 'fake-wav');
  `.trim());
  await executable(whisperPath, `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-h')) { console.log('whisper.cpp fake 1.0'); process.exit(0); }
const outputIndex = args.indexOf('-of');
const outputBase = args[outputIndex + 1];
fs.writeFileSync(outputBase + '.json', JSON.stringify({
  result: { language: 'pt' },
  transcription: [
    { timestamps: { from: '00:00:01.000', to: '00:00:03.000' }, text: 'primeira linha' },
    { timestamps: { from: '00:00:04.000', to: '00:00:06.000' }, text: 'segunda linha' }
  ]
}));
  `.trim());

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE tracks(id TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO tracks(id) VALUES (?);').run(TRACK.id);
  db.close();

  const assistantStore = new LibraryAssistantStore(databasePath);
  const candidates = new LocalLyricsCandidateStore(databasePath);
  const lyricsOverrides = new TrackLyricsOverrideStore(databasePath);
  const queue = new HeavyWorkQueue({
    name: 'local-lyrics-test',
    maxConcurrent: 1,
    maxPending: 2,
    maxPendingPerOwner: 2,
    retryAfterSeconds: 1
  });
  const service = new LocalLyricsWhisperService({
    assistantStore,
    candidates,
    lyricsOverrides,
    queue,
    whisperCommand: whisperPath,
    modelPath,
    ffmpegCommand: ffmpegPath,
    timeoutMs: 2_000,
    library: {
      listTracks: () => [TRACK],
      revision: () => 7,
      root: () => musicRoot,
      resolveTrackFile: trackId => trackId === TRACK.id ? audioPath : null,
      readEffectiveLyrics: async trackId => trackId === TRACK.id ? lyrics : null
    }
  });

  return {
    root,
    service,
    assistantStore,
    candidates,
    lyricsOverrides,
    async close() {
      await service.close();
      candidates.close();
      lyricsOverrides.close();
      assistantStore.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function waitForJob(service: LocalLyricsWhisperService, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = service.getJob(id);
    assert.ok(job);
    if (['review', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('job local não chegou a um estado terminal');
}

describe('LocalLyricsWhisperService', () => {
  it('creates a human-review transcription suggestion with fake local tools', async () => {
    const context = await fixture(null);
    try {
      const capability = await context.service.capability();
      assert.equal(capability.available, true);
      assert.match(capability.whisperVersion ?? '', /fake/);

      const eligible = await context.service.eligibleTracks();
      assert.deepEqual(eligible.tracks.map(track => [track.id, track.action]), [[TRACK.id, 'transcribe']]);

      const started = await context.service.startJob({ trackId: TRACK.id, mode: 'transcribe' }, 'admin-1');
      const job = await waitForJob(context.service, started.id);
      assert.equal(job.status, 'review');
      assert.equal(job.quality?.coverage, 1);
      assert.equal(job.previewLines[0]?.text, 'primeira linha');

      const run = context.assistantStore.listRuns(10)[0];
      assert.equal(run?.capability, 'lyrics');
      assert.equal(run?.status, 'completed');
      const suggestion = run ? context.assistantStore.listSuggestionRecords(run.id)[0]?.suggestion : null;
      assert.equal(suggestion?.provenance.source, 'local-transcription');
      assert.deepEqual(suggestion?.reasonCodes.slice(0, 2), ['local-transcription', 'local-review']);
      assert.equal(suggestion?.target.capability, 'lyrics');
      if (suggestion?.target.capability === 'lyrics') {
        assert.equal(suggestion.target.source, 'local-transcription');
        assert.equal(suggestion.target.synchronized, true);
        assert.match(suggestion.target.currentValue, /^effective:[a-f0-9]{64}$/);
      }
    } finally {
      await context.close();
    }
  });

  it('aligns reliable plain lyrics and keeps the original words in the review candidate', async () => {
    const plain: LyricsResponse = {
      source: 'txt',
      synchronized: false,
      lines: [
        { time: null, text: 'primeira linha' },
        { time: null, text: 'segunda linha' }
      ]
    };
    const context = await fixture(plain);
    try {
      const eligible = await context.service.eligibleTracks();
      assert.deepEqual(eligible.tracks.map(track => [track.id, track.action]), [[TRACK.id, 'align']]);

      const started = await context.service.startJob({ trackId: TRACK.id, mode: 'align', languageHint: 'pt' }, 'admin-1');
      const job = await waitForJob(context.service, started.id);
      assert.equal(job.status, 'review');
      assert.equal(job.quality?.alignedLines, 2);
      assert.equal(job.quality?.unalignedLines, 0);
      assert.deepEqual(job.previewLines.map(line => line.text), ['primeira linha', 'segunda linha']);

      const run = context.assistantStore.listRuns(10)[0];
      const suggestion = run ? context.assistantStore.listSuggestionRecords(run.id)[0]?.suggestion : null;
      assert.equal(suggestion?.provenance.source, 'local-alignment');
      assert.ok(suggestion?.reasonCodes.includes('local-alignment'));
      assert.ok(suggestion?.reasonCodes.includes('local-review'));
    } finally {
      await context.close();
    }
  });
});
