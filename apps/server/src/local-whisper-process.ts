import { spawn } from 'node:child_process';

const DEFAULT_TERMINATION_GRACE_MS = 1_500;

export class LocalWhisperProcessError extends Error {
  constructor(
    public readonly code: 'aborted' | 'timeout' | 'output-limit' | 'spawn-failed' | 'failed',
    message: string
  ) {
    super(message);
    this.name = 'LocalWhisperProcessError';
  }
}

export type BoundedProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type BoundedProcessOptions = {
  command: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  cwd?: string;
};

function terminateProcessTree(pid: number | undefined, force = false) {
  if (!pid) return;
  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM';
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    // O processo pode ter encerrado entre a checagem e o sinal.
  }
}

export function runBoundedProcess(options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  if (!options.command.trim()) throw new TypeError('Comando local inválido.');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 6 * 60 * 60_000) {
    throw new RangeError('Timeout do processo local inválido.');
  }
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1_024 || options.maxOutputBytes > 16 * 1024 * 1024) {
    throw new RangeError('Limite de saída do processo local inválido.');
  }
  if (options.signal?.aborted) {
    return Promise.reject(new LocalWhisperProcessError('aborted', 'Processo local cancelado.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error, terminate = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminate) {
        terminateProcessTree(child.pid);
        const forceTimer = setTimeout(() => terminateProcessTree(child.pid, true), DEFAULT_TERMINATION_GRACE_MS);
        forceTimer.unref?.();
      }
      reject(error);
    };
    const append = (kind: 'stdout' | 'stderr', chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        fail(new LocalWhisperProcessError('output-limit', 'Processo local excedeu o limite de saída.'), true);
        return;
      }
      if (kind === 'stdout') stdout += buffer.toString('utf8');
      else stderr += buffer.toString('utf8');
    };
    const onAbort = () => fail(new LocalWhisperProcessError('aborted', 'Processo local cancelado.'), true);
    const timeout = setTimeout(() => {
      fail(new LocalWhisperProcessError('timeout', 'Processo local excedeu o tempo limite.'), true);
    }, options.timeoutMs);
    timeout.unref?.();

    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', chunk => append('stdout', chunk));
    child.stderr?.on('data', chunk => append('stderr', chunk));
    child.once('error', error => {
      fail(new LocalWhisperProcessError('spawn-failed', `Não foi possível iniciar o processo local: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== 0) {
        reject(new LocalWhisperProcessError(
          'failed',
          `Processo local terminou com falha (${code ?? signal ?? 'desconhecida'}).`
        ));
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
