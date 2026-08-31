#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:8787/ready';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatReadinessSuccess({ attempts, elapsedMs }) {
  return `Readiness de produção confirmado em ${attempts} tentativa(s) após ${elapsedMs} ms.`;
}

export async function verifyProductionReadiness({
  url = DEFAULT_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleepImpl = sleep,
  onAttempt = () => {}
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch não está disponível neste runtime Node.js.');
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastIssue = 'readiness ainda não consultado';

  while (true) {
    attempts += 1;
    const remainingMs = Math.max(1, deadline - now());
    const currentRequestTimeoutMs = Math.min(requestTimeoutMs, remainingMs);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(currentRequestTimeoutMs)
      });

      if (response.ok) {
        return {
          ok: true,
          attempts,
          elapsedMs: Math.max(0, now() - startedAt),
          lastIssue: null
        };
      }

      lastIssue = `HTTP ${response.status}`;
    } catch (error) {
      lastIssue = error instanceof Error ? error.message : String(error);
    }

    onAttempt({ attempts, lastIssue });

    const afterAttempt = now();
    if (afterAttempt >= deadline) break;
    await sleepImpl(Math.min(intervalMs, Math.max(1, deadline - afterAttempt)));
  }

  return {
    ok: false,
    attempts,
    elapsedMs: Math.max(0, now() - startedAt),
    lastIssue
  };
}

async function main() {
  const url = process.env.HOME_MUSIC_PRODUCTION_READY_URL?.trim() || DEFAULT_URL;
  const timeoutMs = positiveInteger(process.env.HOME_MUSIC_VERIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const intervalMs = positiveInteger(process.env.HOME_MUSIC_VERIFY_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const requestTimeoutMs = positiveInteger(
    process.env.HOME_MUSIC_VERIFY_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS
  );

  const result = await verifyProductionReadiness({
    url,
    timeoutMs,
    intervalMs,
    requestTimeoutMs,
    onAttempt: ({ attempts, lastIssue }) => {
      console.log(`Readiness ainda indisponível (tentativa ${attempts}): ${lastIssue}`);
    }
  });

  if (!result.ok) {
    console.error(
      `Readiness de produção não ficou disponível em até ${timeoutMs} ms após ${result.attempts} tentativa(s). Último diagnóstico: ${result.lastIssue}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(formatReadinessSuccess(result));
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  await main();
}
