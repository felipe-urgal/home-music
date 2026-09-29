import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { LibraryService } from './library-service.js';
import { registerSystemRoutes } from './system-routes.js';

function libraryStub() {
  return {
    ready: true,
    enabledTrackCount: 2,
    status: () => ({
      scannedAt: '2026-09-27T12:00:00.000Z',
      scanning: false,
      revision: 7,
      autoRescan: {
        enabled: false,
        intervalSeconds: null
      }
    })
  } as unknown as LibraryService;
}

test('kill switch rítmico permanece observável sem afetar readiness', async () => {
  const app = Fastify();
  registerSystemRoutes(app, {
    isProduction: false,
    musicDirConfigured: true,
    authConfigured: true,
    transcodeCacheMegabytes: 512,
    library: libraryStub(),
    getFfmpegStatus: () => ({
      available: true,
      version: 'ffmpeg e2e',
      issue: null,
      customCommand: false
    }),
    getSchemaVersion: () => 17,
    getTranscodingRuntime: () => ({ active: 0, pending: 0 }),
    rhythmAnalysisConfigured: false,
    getRhythmAnalysisRuntime: () => null,
    isWebReady: () => true
  });

  try {
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { ready: true });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    const body = health.json();

    assert.equal(body.ready, true);
    assert.equal(body.ffmpeg.available, true);
    assert.equal(body.transcoding.available, true);
    assert.deepEqual(body.rhythmAnalysis, {
      configured: false,
      enabled: false,
      analyzerVersion: 3,
      pending: 0,
      active: 0,
      completed: 0,
      detected: 0,
      unavailable: 0,
      decodeUnavailable: 0,
      failed: 0,
      timeouts: 0,
      lowConfidence: 0,
      averageDurationMs: null,
      lastDurationMs: null
    });
  } finally {
    await app.close();
  }
});

test('health expõe runtime agregado da análise sem paths ou dados de faixa', async () => {
  const app = Fastify();
  registerSystemRoutes(app, {
    isProduction: true,
    musicDirConfigured: true,
    authConfigured: true,
    transcodeCacheMegabytes: 512,
    library: libraryStub(),
    getFfmpegStatus: () => ({
      available: true,
      version: 'ffmpeg e2e',
      issue: null,
      customCommand: false
    }),
    getSchemaVersion: () => 17,
    getTranscodingRuntime: () => ({ active: 1, pending: 2 }),
    rhythmAnalysisConfigured: true,
    getRhythmAnalysisRuntime: () => ({
      pending: 5,
      active: 1,
      completed: 40,
      detected: 31,
      unavailable: 9,
      decodeUnavailable: 2,
      failed: 3,
      timeouts: 1,
      lowConfidence: 4,
      averageDurationMs: 82.5,
      lastDurationMs: 90,
      analyzerVersion: 3,
      waveformCompleted: 30,
      waveformAvailable: 28,
      waveformUnavailable: 2,
      waveformDecodeUnavailable: 1,
      waveformFailed: 0,
      waveformTimeouts: 0,
      waveformAnalyzerVersion: 1,
      keyCompleted: 0,
      keyAvailable: 0,
      keyUnavailable: 0,
      keyDecodeUnavailable: 0,
      keyFailed: 0,
      keyTimeouts: 0,
      keyAnalyzerVersion: 1
    }),
    isWebReady: () => true
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.deepEqual(body.rhythmAnalysis, {
      configured: true,
      enabled: true,
      analyzerVersion: 3,
      pending: 5,
      active: 1,
      completed: 40,
      detected: 31,
      unavailable: 9,
      decodeUnavailable: 2,
      failed: 3,
      timeouts: 1,
      lowConfidence: 4,
      averageDurationMs: 82.5,
      lastDurationMs: 90
    });

    const serialized = JSON.stringify(body.rhythmAnalysis);
    assert.equal(serialized.includes('/music/'), false);
    assert.equal(serialized.includes('trackId'), false);
    assert.equal(serialized.includes('title'), false);
  } finally {
    await app.close();
  }
});
