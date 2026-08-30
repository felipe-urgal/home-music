import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  beginLibraryIntegrityCheck,
  clearLibraryIntegrityFileFailures,
  finishLibraryIntegrityCheck,
  getLibraryIntegrityStatus,
  hasLibraryIntegrityFileFailure,
  probeMediaFile,
  recordLibraryIntegrityIssue,
  resetLibraryIntegrityStatusForTests,
  resolveFfprobeCommand
} from './library-integrity.js';

test('resolveFfprobeCommand usa padrão e deriva executável irmão com segurança', () => {
  assert.equal(resolveFfprobeCommand(undefined), 'ffprobe');
  assert.equal(resolveFfprobeCommand('ffmpeg'), 'ffprobe');
  assert.equal(
    resolveFfprobeCommand('/opt/home-music/bin/ffmpeg'),
    path.join('/opt/home-music/bin', 'ffprobe')
  );
  assert.equal(resolveFfprobeCommand('/opt/home-music/bin/wrapper'), null);
});

test('probeMediaFile distingue sucesso, indisponibilidade e falha de mídia', async () => {
  const ok = await probeMediaFile('/music/ok.mp3', undefined, async (_command, args) => {
    assert.equal(args.at(-1), '/music/ok.mp3');
    return { stdout: '123', stderr: '' };
  });
  assert.deepEqual(ok, { status: 'ok', message: null });

  const unavailable = await probeMediaFile('/music/a.mp3', undefined, async () => {
    const error = new Error('missing') as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
  });
  assert.equal(unavailable.status, 'unavailable');

  const failed = await probeMediaFile('/music/b.mp3', undefined, async () => {
    const error = new Error('invalid') as Error & { stderr?: string };
    error.stderr = 'Invalid data found when processing input';
    throw error;
  });
  assert.equal(failed.status, 'failed');
  assert.match(failed.message || '', /Invalid data/);
});

test('snapshot classifica, deduplica e mantém caminhos relativos', () => {
  resetLibraryIntegrityStatusForTests();
  beginLibraryIntegrityCheck('/music');
  recordLibraryIntegrityIssue({
    kind: 'missing-file',
    filePath: '/music/Rock/Faixa.mp3',
    trackId: 'track-1',
    message: 'Arquivo ausente.'
  });
  recordLibraryIntegrityIssue({
    kind: 'missing-file',
    filePath: '/music/Rock/Faixa.mp3',
    trackId: 'track-1',
    message: 'Arquivo ausente.'
  });
  recordLibraryIntegrityIssue({
    kind: 'unindexed-file',
    filePath: '/music/Nova.mp3',
    trackId: 'track-2',
    message: 'Fora do índice.'
  });
  const status = finishLibraryIntegrityCheck('2026-08-30T11:30:00.000Z');

  assert.equal(status.checkedAt, '2026-08-30T11:30:00.000Z');
  assert.deepEqual(status.counts, {
    total: 2,
    scannerFailures: 0,
    mediaProbeFailures: 0,
    missingFiles: 1,
    unindexedFiles: 1
  });
  assert.deepEqual(status.issues.map(issue => issue.relativePath), ['Nova.mp3', 'Rock/Faixa.mp3']);
});

test('falha persistente é reaproveitada apenas na mesma raiz e pode ser reavaliada', () => {
  resetLibraryIntegrityStatusForTests();
  beginLibraryIntegrityCheck('/music');
  recordLibraryIntegrityIssue({
    kind: 'scanner-failed',
    filePath: '/music/Quebrada.mp3',
    trackId: 'track-1',
    message: 'Falha do scanner.'
  });
  finishLibraryIntegrityCheck('2026-08-30T11:30:00.000Z');

  beginLibraryIntegrityCheck('/music');
  assert.equal(hasLibraryIntegrityFileFailure('/music/Quebrada.mp3'), true);
  clearLibraryIntegrityFileFailures('/music/Quebrada.mp3');
  assert.equal(hasLibraryIntegrityFileFailure('/music/Quebrada.mp3'), false);
  finishLibraryIntegrityCheck('2026-08-30T11:31:00.000Z');
  assert.equal(getLibraryIntegrityStatus().counts.total, 0);

  beginLibraryIntegrityCheck('/outra');
  assert.equal(hasLibraryIntegrityFileFailure('/outra/Quebrada.mp3'), false);
  finishLibraryIntegrityCheck('2026-08-30T11:32:00.000Z');
});
