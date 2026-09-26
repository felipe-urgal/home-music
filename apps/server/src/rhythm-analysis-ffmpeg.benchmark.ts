import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MIN_RHYTHM_CONFIDENCE } from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import {
  analyzeTrackRhythm, RHYTHM_ANALYZER_VERSION, RHYTHM_ANALYSIS_SECONDS
} from './rhythm-analysis.js';
import { openRegularFileInside } from './security.js';
import { runFfmpegTranscode, TRANSCODE_PROFILES } from './transcoding.js';

const exec = promisify(execFile);
const round = (value: number) => Number(value.toFixed(3));
type Interval = { start: number; end: number };
type Fixture = { name: string; seconds: number; bpm: number | null; track: IndexedTrack };

export function benchmarkRounds(raw: string | undefined) {
  const value = raw === undefined ? 3 : Number(raw);
  assert.ok(Number.isInteger(value) && value >= 1 && value <= 10,
    'HOME_MUSIC_BENCHMARK_RHYTHM_ROUNDS deve ser inteiro entre 1 e 10.');
  return value;
}

export function summarizeDurations(values: number[]) {
  assert.ok(values.length && values.every(value => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    minMs: round(sorted[0]),
    medianMs: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    maxMs: round(sorted[sorted.length - 1])
  };
}

export function overlapMs(a: Interval, b: Interval) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

async function measure<T>(work: () => Promise<T>) {
  const start = performance.now();
  const cpuBefore = process.cpuUsage();
  const rssBefore = process.memoryUsage().rss;
  let sampledPeakRss = rssBefore;
  const sample = () => { sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss); };
  const sampler = setInterval(sample, 10);
  try {
    const result = await work();
    sample();
    const end = performance.now();
    const cpu = process.cpuUsage(cpuBefore);
    return {
      interval: { start, end },
      wallMs: round(end - start),
      nodeCpuMs: round((cpu.user + cpu.system) / 1_000),
      nodeRssBeforeMb: round(rssBefore / 1024 ** 2),
      nodeSampledPeakRssMb: round(sampledPeakRss / 1024 ** 2),
      result
    };
  } finally {
    clearInterval(sampler);
  }
}

async function createFixtures(root: string, command: string): Promise<Fixture[]> {
  const specs = [
    { name: 'pulse.wav', seconds: RHYTHM_ANALYSIS_SECONDS, bpm: 120 },
    { name: 'pulse.flac', seconds: RHYTHM_ANALYSIS_SECONDS, bpm: 120 },
    { name: 'silence.flac', seconds: RHYTHM_ANALYSIS_SECONDS, bpm: null },
    { name: 'short.wav', seconds: 2, bpm: null }
  ];
  const fixtures: Fixture[] = [];
  for (const spec of specs) {
    const filePath = path.join(root, spec.name);
    const source = spec.name.startsWith('silence')
      ? 'anullsrc=r=44100:cl=stereo'
      : 'aevalsrc=if(lt(mod(t\\,0.5)\\,0.03)\\,0.8*sin(2*PI*800*t)*exp(-mod(t\\,0.5)/0.006)\\,0):s=44100';
    await exec(command, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', source,
      '-t', String(spec.seconds), '-ac', '2', '-threads', '1', filePath],
    { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
    const info = await stat(filePath);
    fixtures.push({ ...spec, track: {
      id: spec.name, title: spec.name, artist: 'Benchmark', album: 'Benchmark',
      albumArtist: 'Benchmark', folder: '', folderPath: '', duration: spec.seconds,
      format: path.extname(spec.name).slice(1).toUpperCase(), hasCover: false,
      replayGainTrackDb: null, replayGainAlbumDb: null, filePath,
      mimeType: spec.name.endsWith('.wav') ? 'audio/wav' : 'audio/flac',
      fileSize: info.size, mtimeMs: info.mtimeMs
    } });
  }
  return fixtures;
}

async function main() {
  assert.equal(process.platform, 'linux', 'O transcoder de produção requer Linux (/proc/self/fd).');
  const rounds = benchmarkRounds(process.env.HOME_MUSIC_BENCHMARK_RHYTHM_ROUNDS);
  const command = process.env.HOME_MUSIC_BENCHMARK_RHYTHM_FFMPEG ?? 'ffmpeg';
  const version = await exec(command, ['-version'],
    { timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-benchmark-'));
  try {
    const fixtures = await createFixtures(root, command);
    const analyze = async (inputs = fixtures) => {
      const results = [];
      // Uma análise por vez, como no scheduler de produção.
      for (const fixture of inputs) {
        const started = performance.now();
        const rhythm = await analyzeTrackRhythm(root, fixture.track, command);
        if (fixture.bpm === null) assert.equal(rhythm, null, fixture.name);
        else {
          assert.ok(rhythm, `${fixture.name}: ritmo não detectado`);
          assert.ok(Math.abs(rhythm.bpm - fixture.bpm) <= 1, `${fixture.name}: BPM incorreto`);
          assert.ok(rhythm.confidence >= MIN_RHYTHM_CONFIDENCE, `${fixture.name}: confiança baixa`);
        }
        results.push({ fixture: fixture.name, wallMs: round(performance.now() - started), rhythm });
      }
      return results;
    };
    const transcode = async (inputs = fixtures) => {
      const results = [];
      for (const fixture of inputs) {
        const started = performance.now();
        const outputPath = path.join(root, `${fixture.name}.m4a`);
        const source = await openRegularFileInside(root, fixture.track.filePath);
        try {
          await runFfmpegTranscode({ command,
            input: source.handle.createReadStream({ autoClose: false }), outputPath,
            bitrate: TRANSCODE_PROFILES.balanced.bitrate,
            normalizationGainDb: null, timeoutMs: 30_000 });
          const output = await stat(outputPath);
          assert.ok(output.size > 0, `${fixture.name}: saída vazia`);
          results.push({ fixture: fixture.name, wallMs: round(performance.now() - started), bytes: output.size });
        } finally {
          await source.handle.close();
          await rm(outputPath, { force: true });
        }
      }
      return results;
    };

    // Aquecimento fora das amostras; não mede cache frio de disco nem startup do servidor.
    await analyze(fixtures.slice(0, 1));
    await transcode(fixtures.slice(0, 1));
    const samples = [];
    for (let index = 0; index < rounds; index += 1) {
      const baseline = async () => ({
        analysis: await measure(() => analyze()),
        transcode: await measure(() => transcode())
      });
      const concurrent = () => measure(async () => {
        // Espera as duas promises, inclusive em falha. O decoder de produção pode
        // rejeitar após SIGTERM sem aguardar close do subprocesso em timeout.
        const results = await Promise.allSettled([
          measure(() => analyze()), measure(() => transcode())
        ]);
        const analysis = results[0];
        const transcoding = results[1];
        if (analysis.status === 'rejected') throw analysis.reason;
        if (transcoding.status === 'rejected') throw transcoding.reason;
        const overlap = overlapMs(analysis.value.interval, transcoding.value.interval);
        assert.ok(overlap > 0, 'Os workloads não se sobrepuseram.');
        // CPU/RSS de cada chamada seriam do mesmo Node e contariam trabalho duplicado.
        return {
          analysisWallMs: analysis.value.wallMs, transcodeWallMs: transcoding.value.wallMs,
          workloadOverlapMs: round(overlap),
          analysis: analysis.value.result, transcode: transcoding.value.result
        };
      });
      const order = index % 2 === 0 ? 'baseline-first' : 'concurrent-first';
      if (order === 'baseline-first') {
        const isolated = await baseline();
        samples.push({ order, isolated, concurrent: await concurrent() });
      } else {
        const combined = await concurrent();
        samples.push({ order, isolated: await baseline(), concurrent: combined });
      }
    }
    const isolatedTranscode = summarizeDurations(samples.map(s => s.isolated.transcode.wallMs));
    const concurrentTranscode = summarizeDurations(samples.map(s => s.concurrent.result.transcodeWallMs));
    console.log(JSON.stringify({
      benchmark: 'rhythm-analysis-ffmpeg',
      environment: { node: process.version, platform: process.platform, arch: process.arch,
        cpu: os.cpus()[0]?.model, availableParallelism: os.availableParallelism(),
        ffmpeg: version.stdout.split('\n')[0], analyzerVersion: RHYTHM_ANALYZER_VERSION },
      rounds,
      fixtures: fixtures.map(f => ({ name: f.name, seconds: f.seconds, bytes: f.track.fileSize })),
      summary: {
        isolatedAnalysis: summarizeDurations(samples.map(s => s.isolated.analysis.wallMs)),
        concurrentAnalysis: summarizeDurations(samples.map(s => s.concurrent.result.analysisWallMs)),
        isolatedTranscode, concurrentTranscode,
        transcodeMedianRatio: round(concurrentTranscode.medianMs / isolatedTranscode.medianMs)
      },
      samples,
      notes: [
        'Áudio sintético; FFmpeg, análise e transcoding reais, sem biblioteca/SQLite/cache HTTP.',
        'Tempos incluem IO e validação; sobreposição é dos workloads, não uma medição de paralelismo de CPU.',
        'CPU e RSS são somente do Node; excluem subprocessos FFmpeg. RSS amostrado a cada 10 ms.',
        'Sem limite universal de slowdown: compare no mesmo hardware e investigue as amostras.',
        'Não valida qualidade perceptual, PWA/mobile, startup/scan completo nem biblioteca representativa.'
      ]
    }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
