#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:8787/ready';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

export function positiveInteger(value, fallback) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return fallback;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function readinessUrl(value) {
  let parsed;

  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error('URL de readiness inválida.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL de readiness deve usar http: ou https:.');
  }

  return parsed;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatReadinessSuccess({ attempts, elapsedMs }) {
  return `Readiness de produção confirmado em ${attempts} tentativa(s) após ${elapsedMs} ms.`;
}

export function readinessErrorDiagnostic(error) {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'timeout da requisição de readiness';
  }

  const cause = error && typeof error === 'object' ? error.cause : null;
  const code = cause && typeof cause === 'object' && typeof cause.code === 'string'
    ? cause.code
    : null;

  return code ? `falha de conexão (${code})` : 'falha ao consultar readiness';
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

  const targetUrl = readinessUrl(url);
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let lastIssue = 'readiness ainda não consultado';

  while (true) {
    attempts += 1;
    const remainingMs = Math.max(1, deadline - now());
    const currentRequestTimeoutMs = Math.min(requestTimeoutMs, remainingMs);

    try {
      const response = await fetchImpl(targetUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
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
      lastIssue = readinessErrorDiagnostic(error);
    }

    onAttempt({ attempts, lastIssue });

    const afterAttempt = now();
    if (afterAttempt >= deadline) break;
    await sleepImpl(Math.min(intervalMs, Math.max(1, deadline - afterAttempt)));
    if (now() >= deadline) break;
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
