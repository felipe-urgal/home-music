import assert from 'node:assert/strict';
import { mkdtemp, mkdir, lstat, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ImportStagingManager } from './import-staging.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-staging-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir, { mode: 0o700 });
  return {
    root,
    musicDir,
    stagingRoot,
    manager: new ImportStagingManager({ musicDir, stagingRoot }),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

function permissions(mode: number) {
  return mode & 0o777;
}

test('recusa raiz de staging dentro de MUSIC_DIR antes de criar arquivos', async () => {
  const current = await fixture();
  try {
    const unsafeRoot = path.join(current.musicDir, 'unsafe-staging');
    const manager = new ImportStagingManager({ musicDir: current.musicDir, stagingRoot: unsafeRoot });
    await assert.rejects(() => manager.createJob('job-1'), /fora de MUSIC_DIR/);
    await assert.rejects(() => lstat(unsafeRoot), { code: 'ENOENT' });
  } finally {
    await current.cleanup();
  }
});

test('recusa staging que contém MUSIC_DIR ou cuja raiz é symlink', async () => {
  const current = await fixture();
  try {
    const parentManager = new ImportStagingManager({
      musicDir: current.musicDir,
      stagingRoot: current.root
    });
    await assert.rejects(() => parentManager.createJob('job-parent'), /não pode contê-lo/);

    const realStaging = path.join(current.root, 'real-staging');
    const stagingLink = path.join(current.root, 'staging-link');
    await mkdir(realStaging);
    await symlink(realStaging, stagingLink);
    const symlinkManager = new ImportStagingManager({
      musicDir: current.musicDir,
      stagingRoot: stagingLink
    });
    await assert.rejects(() => symlinkManager.createJob('job-link'), /sem symlink/);
  } finally {
    await current.cleanup();
  }
});

test('cria workspace aleatório restrito e grava payload com nome controlado pelo servidor', async () => {
  const current = await fixture();
  try {
    const job = await current.manager.createJob('../../nome-controlado-pelo-cliente');
    assert.match(path.basename(job.workspacePath), /^job-/);
    assert.equal(job.workspacePath.includes('nome-controlado-pelo-cliente'), false);
    assert.equal(permissions((await stat(job.workspacePath)).mode), 0o700);

    const result = await current.manager.writePayload(job.jobId, [
      Buffer.from('abc'),
      Buffer.from('def')
    ]);
    assert.equal(result.size, 6);

    const payloadPath = path.join(job.workspacePath, 'payload.bin');
    assert.equal(await readFile(payloadPath, 'utf8'), 'abcdef');
    assert.equal(permissions((await stat(payloadPath)).mode), 0o600);
  } finally {
    await current.cleanup();
  }
});

test('falha de escrita ou validação remove o workspace do job', async () => {
  const current = await fixture();
  try {
    const invalidWrite = await current.manager.createJob('job-write-failure');
    async function* brokenStream() {
      yield Buffer.from('parcial');
      throw new Error('stream interrompido');
    }
    await assert.rejects(() => current.manager.writePayload(invalidWrite.jobId, brokenStream()), /stream interrompido/);
    assert.equal(current.manager.hasJob(invalidWrite.jobId), false);
    await assert.rejects(() => lstat(invalidWrite.workspacePath), { code: 'ENOENT' });

    const invalidValidation = await current.manager.createJob('job-validation-failure');
    await current.manager.writePayload(invalidValidation.jobId, [Buffer.from('não é mídia')]);
    await assert.rejects(
      () => current.manager.validatePayload(invalidValidation.jobId, () => {
        throw new Error('formato inválido');
      }),
      /formato inválido/
    );
    assert.equal(current.manager.hasJob(invalidValidation.jobId), false);
    await assert.rejects(() => lstat(invalidValidation.workspacePath), { code: 'ENOENT' });
  } finally {
    await current.cleanup();
  }
});

test('cancelamento explícito limpa somente o workspace associado', async () => {
  const current = await fixture();
  try {
    const first = await current.manager.createJob('job-cancelled');
    const second = await current.manager.createJob('job-kept');
    await current.manager.writePayload(first.jobId, [Buffer.from('first')]);
    await current.manager.writePayload(second.jobId, [Buffer.from('second')]);

    assert.equal(await current.manager.cleanupJob(first.jobId), true);
    assert.equal(current.manager.hasJob(first.jobId), false);
    assert.equal(current.manager.hasJob(second.jobId), true);
    await assert.rejects(() => lstat(first.workspacePath), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(second.workspacePath, 'payload.bin'), 'utf8'), 'second');
  } finally {
    await current.cleanup();
  }
});

test('validação lê o inode aberto e promoção só aceita o token emitido', async () => {
  const current = await fixture();
  try {
    const job = await current.manager.createJob('job-validated');
    await current.manager.writePayload(job.jobId, [Buffer.from('audio-validado')]);

    const validated = await current.manager.validatePayload(job.jobId, async target => {
      assert.equal(await readFile(target.path, 'utf8'), 'audio-validado');
      assert.equal(target.size, Buffer.byteLength('audio-validado'));
      return { codec: 'teste' };
    });

    assert.equal(validated.validation.codec, 'teste');
    await assert.rejects(
      () => current.manager.promote({ ...validated, token: 'token-forjado' }, 'track.mp3'),
      /Token de validação inválido/
    );
    assert.equal(current.manager.hasJob(job.jobId), true);
  } finally {
    await current.cleanup();
  }
});

test('recusa promoção se o payload mudar depois da validação e não toca MUSIC_DIR', async () => {
  const current = await fixture();
  try {
    const job = await current.manager.createJob('job-tampered');
    await current.manager.writePayload(job.jobId, [Buffer.from('original')]);
    const validated = await current.manager.validatePayload(job.jobId, () => true);

    await writeFile(path.join(job.workspacePath, 'payload.bin'), 'alterado depois');
    await assert.rejects(() => current.manager.promote(validated, 'track.mp3'), /mudou depois da validação/);
    await assert.rejects(() => lstat(path.join(current.musicDir, 'track.mp3')), { code: 'ENOENT' });
    assert.equal(current.manager.hasJob(job.jobId), false);
    await assert.rejects(() => lstat(job.workspacePath), { code: 'ENOENT' });
  } finally {
    await current.cleanup();
  }
});

test('promove somente payload validado para pasta existente sem sobrescrever e remove staging', async () => {
  const current = await fixture();
  try {
    await mkdir(path.join(current.musicDir, 'Album'));
    const job = await current.manager.createJob('job-success');
    await current.manager.writePayload(job.jobId, [Buffer.from('conteúdo final')]);
    const validated = await current.manager.validatePayload(job.jobId, () => ({ format: 'mp3' }));

    const promoted = await current.manager.promote(validated, 'Album/faixa.mp3');
    assert.equal(promoted.relativePath, 'Album/faixa.mp3');
    assert.equal(promoted.size, Buffer.byteLength('conteúdo final'));
    assert.equal(await readFile(promoted.absolutePath, 'utf8'), 'conteúdo final');
    assert.equal(permissions((await stat(promoted.absolutePath)).mode), 0o640);
    assert.equal(current.manager.hasJob(job.jobId), false);
    await assert.rejects(() => lstat(job.workspacePath), { code: 'ENOENT' });
  } finally {
    await current.cleanup();
  }
});

test('bloqueia traversal, pasta symlink e colisão sem alterar arquivos externos ou existentes', async () => {
  const current = await fixture();
  try {
    const traversal = await current.manager.createJob('job-traversal');
    await current.manager.writePayload(traversal.jobId, [Buffer.from('payload')]);
    const traversalValidated = await current.manager.validatePayload(traversal.jobId, () => true);
    await assert.rejects(() => current.manager.promote(traversalValidated, '../escape.mp3'), /Destino final inválido/);
    await assert.rejects(() => lstat(path.join(current.root, 'escape.mp3')), { code: 'ENOENT' });

    const outside = path.join(current.root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(current.musicDir, 'link'));
    const symlinkJob = await current.manager.createJob('job-symlink-destination');
    await current.manager.writePayload(symlinkJob.jobId, [Buffer.from('payload')]);
    const symlinkValidated = await current.manager.validatePayload(symlinkJob.jobId, () => true);
    await assert.rejects(() => current.manager.promote(symlinkValidated, 'link/faixa.mp3'), /não é segura/);
    await assert.rejects(() => lstat(path.join(outside, 'faixa.mp3')), { code: 'ENOENT' });

    const existingPath = path.join(current.musicDir, 'existente.mp3');
    await writeFile(existingPath, 'original');
    const collision = await current.manager.createJob('job-collision');
    await current.manager.writePayload(collision.jobId, [Buffer.from('novo')]);
    const collisionValidated = await current.manager.validatePayload(collision.jobId, () => true);
    await assert.rejects(() => current.manager.promote(collisionValidated, 'existente.mp3'), /Já existe um arquivo/);
    assert.equal(await readFile(existingPath, 'utf8'), 'original');
  } finally {
    await current.cleanup();
  }
});
