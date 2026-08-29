import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import {
  ExternalProviderError,
  ExternalProviderImportManager,
  type ExternalProvider,
  type ExternalProviderErrorCode
} from './external-provider.js';

const diagnostics: Array<[ExternalProviderErrorCode, string]> = [
  ['provider_network_failed', 'O provider externo não conseguiu acessar a origem pela rede segura.'],
  ['provider_auth_required', 'A origem exige autenticação e não pode ser importada sem credenciais.'],
  ['provider_runtime_missing', 'O yt-dlp não encontrou o runtime JavaScript necessário para esta origem.'],
  ['provider_incompatible', 'A versão instalada do yt-dlp não é compatível com o provider.']
];

async function waitFailed(queue: ImportJobQueue, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = queue.get(id);
    if (job?.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Job ${id} não falhou.`);
}

for (const [code, expected] of diagnostics) {
  test(`manager publica diagnóstico canônico ${code} sem vazar mensagem interna`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-provider-diagnostic-'));
    const musicDir = path.join(root, 'music');
    await mkdir(musicDir);
    const queue = new ImportJobQueue();
    const staging = new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir });
    const scratch = new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir });
    const provider: ExternalProvider = {
      id: 'diagnostic',
      label: 'Diagnostic Provider',
      capabilities: { audio: true, metadata: false, thumbnail: false, playlists: false },
      validate: () => undefined,
      prepare: async () => {
        throw new ExternalProviderError(code, 'segredo-interno https://signed.example/?token=123', 502);
      }
    };
    const manager = new ExternalProviderImportManager({ queue, staging, scratch, providers: [provider] });

    try {
      const { job } = await manager.start('diagnostic', { url: 'https://example.com/item' });
      const failed = await waitFailed(queue, job.id);
      assert.equal(failed.error, expected);
      assert.equal(failed.error?.includes('segredo-interno'), false);
      assert.equal(failed.error?.includes('token=123'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
