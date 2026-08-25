import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'home-music-e2e-'));
const libraryDir = path.join(tempDir, 'library');
const databasePath = path.join(tempDir, 'home-music.db');
const fixturePath = path.join(libraryDir, 'E2E Track.wav');

function wavFixture(durationSeconds = 10) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 1_200);
    buffer.writeInt16LE(sample, 44 + index * bytesPerSample);
  }

  return buffer;
}

await mkdir(libraryDir, { recursive: true });
await writeFile(fixturePath, wavFixture());

const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    MUSIC_DIR: libraryDir,
    HOME_MUSIC_DATABASE_PATH: databasePath,
    HOME_MUSIC_USER: 'playwright',
    HOME_MUSIC_PASSWORD: 'playwright-password-2026',
    HOME_MUSIC_COOKIE_SECURE: 'false',
    HOME_MUSIC_TRUST_TAILSCALE_PROXY: 'false',
    HOME_MUSIC_RESCAN_INTERVAL_SECONDS: '0',
    HOME_MUSIC_TRANSCODE_CACHE_MB: '64',
    PORT: '8791',
    PRODUCTION_HOST: '127.0.0.1'
  },
  stdio: 'inherit'
});

let stopping = false;

async function cleanup() {
  await rm(tempDir, { recursive: true, force: true });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

server.on('error', async error => {
  console.error('Falha ao iniciar o servidor E2E.', error);
  await cleanup();
  process.exit(1);
});

server.on('exit', async (code, signal) => {
  await cleanup();
  if (!stopping && signal) {
    console.error(`Servidor E2E encerrado por ${signal}.`);
  }
  process.exit(code ?? (stopping ? 0 : 1));
});
