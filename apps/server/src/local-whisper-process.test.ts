import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LocalWhisperProcessError, runBoundedProcess } from './local-whisper-process.js';

describe('runBoundedProcess', () => {
  it('captures bounded stdout without invoking a shell', async () => {
    const result = await runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok")'],
      timeoutMs: 2_000,
      maxOutputBytes: 1_024
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ok');
  });

  it('terminates a process that exceeds the output limit', async () => {
    await assert.rejects(
      runBoundedProcess({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(2048))'],
        timeoutMs: 2_000,
        maxOutputBytes: 1_024
      }),
      (error: unknown) => error instanceof LocalWhisperProcessError && error.code === 'output-limit'
    );
  });

  it('terminates a process after timeout', async () => {
    await assert.rejects(
      runBoundedProcess({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 10_000)'],
        timeoutMs: 120,
        maxOutputBytes: 1_024
      }),
      (error: unknown) => error instanceof LocalWhisperProcessError && error.code === 'timeout'
    );
  });

  it('propagates AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const running = runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(
      running,
      (error: unknown) => error instanceof LocalWhisperProcessError && error.code === 'aborted'
    );
  });
});
