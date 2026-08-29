import assert from 'node:assert/strict';
import { chmod, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseMediaProbeJson, runFfprobe } from './import-media-validation.js';

test('runFfprobe usa somente opções suportadas pelo ffprobe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-ffprobe-cli-'));
  const command = path.join(root, 'fake-ffprobe');
  const payloadPath = path.join(root, 'payload.bin');
  const fakeJson = JSON.stringify({
    format: { format_name: 'matroska,webm', duration: '1.008', bit_rate: '106896' },
    streams: [{
      index: 0,
      codec_name: 'opus',
      codec_type: 'audio',
      sample_rate: '48000',
      channels: 2,
      duration: '1.008',
      bit_rate: '96000'
    }]
  });
  const script = `#!${process.execPath}\n`
    + `if (process.argv.includes('-nostdin')) { console.error('unsupported -nostdin'); process.exit(9); }\n`
    + `if (!process.argv.includes('-protocol_whitelist') || !process.argv.includes('/proc/self/fd/3')) process.exit(10);\n`
    + `process.stdout.write(${JSON.stringify(fakeJson)});\n`;

  await writeFile(command, script);
  await chmod(command, 0o755);
  await writeFile(payloadPath, Buffer.from('fake-media'));
  const handle = await open(payloadPath, 'r');

  try {
    const raw = await runFfprobe(command, { path: payloadPath, size: 10, fd: handle.fd }, 2_000);
    const parsed = parseMediaProbeJson(raw);
    assert.deepEqual(parsed.formatNames, ['matroska', 'webm']);
    assert.equal(parsed.selectedAudioStream.codec, 'opus');
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
});
