import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'home-music-e2e-'));
const libraryDir = path.join(tempDir, 'library');
const databasePath = path.join(tempDir, 'home-music.db');
const fixturePath = path.join(libraryDir, 'E2E Track.wav');
const secondFixturePath = path.join(libraryDir, 'E2E Zeta.wav');
const thirdFixturePath = path.join(libraryDir, 'E2E Zulu.wav');
const lyricsFixturePath = path.join(libraryDir, 'E2E Track.lrc');
const rawLargeLibraryTrackCount = process.env.HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS?.trim() || '0';
const largeLibraryTrackCount = Number(rawLargeLibraryTrackCount);

if (!Number.isInteger(largeLibraryTrackCount) || largeLibraryTrackCount < 0 || largeLibraryTrackCount > 50_000) {
  throw new Error('HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS deve ser um inteiro entre 0 e 50000.');
}

function wavFixture(durationSeconds = 10, frequency = 440) {
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
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 1_200);
    buffer.writeInt16LE(sample, 44 + index * bytesPerSample);
  }

  return buffer;
}

function benchmarkTracks(trackCount) {
  const formats = ['MP3', 'AAC', 'FLAC', 'OPUS'];
  const mimeTypes = {
    MP3: 'audio/mpeg',
    AAC: 'audio/aac',
    FLAC: 'audio/flac',
    OPUS: 'audio/ogg'
  };
  const fixedMtimeMs = Date.parse('2026-01-01T00:00:00.000Z');

  return Array.from({ length: trackCount }, (_, index) => {
    const format = formats[index % formats.length];
    const sequence = String(index + 1).padStart(6, '0');
    const artistIndex = String(index % 200).padStart(3, '0');
    const albumIndex = String(index % 500).padStart(3, '0');
    const albumArtistIndex = String(index % 50).padStart(2, '0');
    const id = `benchmark-${sequence}`;

    return {
      id,
      title: `Faixa ${sequence}`,
      artist: `Artista ${artistIndex}`,
      album: `Álbum ${albumIndex}`,
      albumArtist: `Artista do álbum ${albumArtistIndex}`,
      folder: 'Sem pasta',
      folderPath: '',
      duration: 90 + (index % 420),
      format,
      hasCover: false,
      replayGainTrackDb: -6 + (index % 12) / 2,
      replayGainAlbumDb: -5 + (index % 10) / 2,
      filePath: path.join(libraryDir, '.benchmark', `${id}.${format.toLowerCase()}`),
      mimeType: mimeTypes[format],
      fileSize: 512_000 + (index % 2_048),
      mtimeMs: fixedMtimeMs
    };
  });
}

await mkdir(libraryDir, { recursive: true });
await Promise.all([
  writeFile(fixturePath, wavFixture(10, 440)),
  writeFile(secondFixturePath, wavFixture(10, 523)),
  writeFile(thirdFixturePath, wavFixture(10, 659)),
  writeFile(lyricsFixturePath, '[00:00.00]Linha E2E um\n[00:03.00]Linha E2E dois\n', 'utf8')
]);

// O build já existe quando o webServer do Playwright é iniciado. Criamos o schema
// temporário e uma playlist Rekordbox compartilhada sem depender de XML ou dados reais.
// No benchmark de biblioteca grande, o snapshot é semeado pela mesma API de persistência
// usada em produção. Isso mantém Fastify + SQLite + projeção pública reais sem pagar o
// custo e a variância de criar/parsear dezenas de milhares de arquivos de áudio.
const databaseModuleUrl = pathToFileURL(path.join(rootDir, 'apps/server/dist/database.js')).href;
const { HomeMusicDatabase } = await import(databaseModuleUrl);
const fixtureDatabase = new HomeMusicDatabase(databasePath);
try {
  if (largeLibraryTrackCount > 0) {
    fixtureDatabase.syncTracks(
      benchmarkTracks(largeLibraryTrackCount),
      libraryDir,
      '2026-01-01T00:00:00.000Z'
    );
  }

  fixtureDatabase.syncImportedPlaylists('rekordbox', [{
    sourceKey: 'e2e-rekordbox',
    name: 'E2E Rekordbox',
    trackIds: []
  }]);
} finally {
  fixtureDatabase.close();
}

// O E2E deve atravessar o mesmo preload usado por `npm start`/systemd para
// validar bootstrap e vínculo de identidade exatamente como em produção.
const serverArgs = ['--import', './apps/server/dist/bootstrap-preload.js'];
if (process.env.HOME_MUSIC_E2E_MEMORY_FILE?.trim()) {
  serverArgs.push('--import', './e2e/scripts/process-memory-probe.mjs');
}
serverArgs.push('apps/server/dist/index.js');

const server = spawn(
  process.execPath,
  serverArgs,
  {
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
  }
);

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
