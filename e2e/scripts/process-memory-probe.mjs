import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputPath = process.env.HOME_MUSIC_E2E_MEMORY_FILE?.trim();
const MEBIBYTE = 1024 * 1024;

if (outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });

  let peakHeapUsed = 0;
  let peakRss = 0;

  const toMb = bytes => Number((bytes / MEBIBYTE).toFixed(2));

  const sample = () => {
    const usage = process.memoryUsage();
    peakHeapUsed = Math.max(peakHeapUsed, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);

    const snapshot = {
      pid: process.pid,
      sampledAt: new Date().toISOString(),
      heapUsedMb: toMb(usage.heapUsed),
      rssMb: toMb(usage.rss),
      peakHeapUsedMb: toMb(peakHeapUsed),
      peakRssMb: toMb(peakRss)
    };
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(snapshot), 'utf8');
    renameSync(temporaryPath, outputPath);
  };

  sample();
  const timer = setInterval(sample, 250);
  timer.unref();
  process.once('beforeExit', sample);
}
