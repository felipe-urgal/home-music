import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';

type Job = {
  id: string;
  source: { type: 'upload'; provider: null };
  label: string;
  status: 'pending' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  startedAt: null;
  finishedAt: string | null;
  error: null;
};

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(adminUsername);
  await page.getByLabel('Senha', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openImport(page: Page) {
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await page.getByRole('button', { name: /^Importar mídia/ }).click();
  await expect(page.locator('#admin-import-title')).toHaveText('Importar mídia');
}

function newJob(id: string, label: string): Job {
  const now = '2026-08-28T20:00:00.000Z';
  return {
    id,
    source: { type: 'upload', provider: null },
    label,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null
  };
}

test('admin envia por seletor e drag-and-drop, vê progresso e pode cancelar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  const jobs: Job[] = [];
  const uploadedBodies: string[] = [];
  let cancelledId: string | null = null;
  let sequence = 0;

  await page.route('**/api/admin/imports', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobs: [...jobs].reverse(),
        upload: {
          maxBytes: 1024,
          acceptedExtensions: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']
        }
      })
    });
  });

  await page.route('**/api/admin/imports/uploads**', async route => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    expect(request.headers()['x-home-music-request']).toBe('1');

    if (method === 'POST' && url.pathname === '/api/admin/imports/uploads') {
      const body = request.postDataJSON() as { fileName: string; size: number };
      sequence += 1;
      const job = newJob(`upload-${sequence}`, body.fileName);
      jobs.push(job);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ job }) });
      return;
    }

    const id = decodeURIComponent(url.pathname.split('/').at(-1) || '');
    const job = jobs.find(item => item.id === id);
    if (!job) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Job não encontrado.' }) });
      return;
    }

    if (method === 'PUT') {
      expect(request.headers()['content-type']).toContain('application/octet-stream');
      uploadedBodies.push(request.postDataBuffer()?.toString('utf8') || '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job, receivedBytes: request.postDataBuffer()?.byteLength || 0 })
      });
      return;
    }

    if (method === 'DELETE') {
      cancelledId = id;
      job.status = 'cancelled';
      job.finishedAt = '2026-08-28T20:00:01.000Z';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) });
      return;
    }

    await route.fallback();
  });

  await login(page);
  await openImport(page);

  await expect(page.getByText('Até 1 KB')).toBeVisible();
  await expect(page.getByText('MP3 · FLAC · WAV · M4A · AAC · OGG · OPUS')).toBeVisible();

  const fileInput = page.getByLabel('Selecionar arquivo de áudio');
  await fileInput.setInputFiles({
    name: 'selecao.flac',
    mimeType: 'audio/flac',
    buffer: Buffer.from('abcd')
  });
  const status = page.locator('.admin-import-upload-status');
  await expect(status).toContainText('selecao.flac');
  await expect(status).toContainText('Aguardando validação');
  await expect(status).toContainText('100%');
  await expect(status).toContainText('ainda não entrou na biblioteca');
  expect(uploadedBodies).toContain('abcd');

  await status.getByRole('button', { name: 'Cancelar selecao.flac' }).click();
  await expect(status).toContainText('Cancelado');
  expect(cancelledId).toBe('upload-1');

  const dataTransfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['drop'], 'arrastada.mp3', { type: 'audio/mpeg' }));
    return value;
  });
  await page.locator('.admin-import-dropzone').dispatchEvent('drop', { dataTransfer });
  await expect(status).toContainText('arrastada.mp3');
  await expect(status).toContainText('100%');
  expect(uploadedBodies).toContain('drop');

  const queue = page.locator('.admin-import-job-list');
  await expect(queue).toContainText('arrastada.mp3');
  await expect(queue).toContainText('selecao.flac');
});
