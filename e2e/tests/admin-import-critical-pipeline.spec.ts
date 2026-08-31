import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
type Job = {
  id: string;
  source: { type: 'url' | 'provider'; provider: string | null };
  label: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  mediaDecision: null | {
    profile: 'original';
    action: 'preserve';
    reason: 'original-compatible';
    selectedAudioStream: number;
    input: {
      container: string;
      codec: string;
      durationSeconds: number;
      bitRate: number;
      sampleRate: number;
      channels: number;
      audioStreams: number;
      videoStreams: number;
    };
    output: { container: string; codec: string; extension: string; bitRate: number };
  };
  metadataPreview: null | {
    embedded: MetadataValues;
    provider: MetadataValues | null;
    overrides: MetadataValues;
    effective: MetadataValues;
    fieldStates: Record<'title' | 'artist' | 'album' | 'albumArtist', 'trusted'>;
    durationSeconds: number;
    cover: { available: boolean; contentType: null; sizeBytes: null };
    generatedAt: string;
  };
};

type MetadataValues = {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
};

const now = '2026-08-31T12:00:00.000Z';

function baseJob(id: string, label: string, source: Job['source'], status: JobStatus): Job {
  return {
    id,
    source,
    label,
    status,
    createdAt: now,
    updatedAt: now,
    startedAt: status === 'processing' ? now : null,
    finishedAt: null,
    error: null,
    mediaDecision: null,
    metadataPreview: null
  };
}

function validatedUrlJob(job: Job): Job {
  const values: MetadataValues = {
    title: 'URL E2E',
    artist: 'Fixture Artist',
    album: 'Fixture Album',
    albumArtist: 'Fixture Artist'
  };
  return {
    ...job,
    status: 'pending',
    updatedAt: '2026-08-31T12:00:01.000Z',
    mediaDecision: {
      profile: 'original',
      action: 'preserve',
      reason: 'original-compatible',
      selectedAudioStream: 0,
      input: {
        container: 'wav',
        codec: 'pcm_s16le',
        durationSeconds: 10,
        bitRate: 128000,
        sampleRate: 8000,
        channels: 1,
        audioStreams: 1,
        videoStreams: 0
      },
      output: { container: 'wav', codec: 'pcm_s16le', extension: '.wav', bitRate: 128000 }
    },
    metadataPreview: {
      embedded: values,
      provider: null,
      overrides: { title: null, artist: null, album: null, albumArtist: null },
      effective: values,
      fieldStates: { title: 'trusted', artist: 'trusted', album: 'trusted', albumArtist: 'trusted' },
      durationSeconds: 10,
      cover: { available: false, contentType: null, sizeBytes: null },
      generatedAt: '2026-08-31T12:00:01.000Z'
    }
  };
}

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

test('provider e URL direta atravessam o workbench crítico sem internet pública', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  const jobs: Job[] = [];
  let providerInspectBody: unknown = null;
  let providerStartBody: unknown = null;
  let urlStartBody: unknown = null;
  let validationBody: unknown = null;
  let promotionBody: unknown = null;
  let duplicateDetected = false;

  await page.route('**/api/admin/imports', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobs: [...jobs].reverse(),
        upload: {
          maxBytes: 1024 * 1024,
          acceptedExtensions: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']
        },
        url: {
          maxBytes: 1024 * 1024,
          timeoutMs: 5000,
          maxRedirects: 3,
          acceptedProtocols: ['http:', 'https:']
        },
        mediaValidation: {
          profiles: [{ id: 'original', label: 'Original', description: 'Preserva a mídia quando compatível.' }]
        },
        providers: [{
          id: 'yt-dlp',
          label: 'yt-dlp',
          configured: true,
          capabilities: { audio: true, metadata: true, thumbnail: true, playlists: true }
        }]
      })
    });
  });

  await page.route('**/api/admin/imports/providers/yt-dlp/batches/inspect', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    providerInspectBody = request.postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ batch: null, limits: null }) });
  });

  await page.route('**/api/admin/imports/providers/yt-dlp', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    providerStartBody = request.postDataJSON();
    const job = baseJob('provider-e2e', 'Provider E2E', { type: 'provider', provider: 'yt-dlp' }, 'processing');
    jobs.push(job);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ job }) });
  });

  await page.route('**/api/admin/imports/providers/jobs/provider-e2e', async route => {
    const request = route.request();
    expect(request.method()).toBe('DELETE');
    expect(request.headers()['x-home-music-request']).toBe('1');
    const job = jobs.find(item => item.id === 'provider-e2e')!;
    job.status = 'cancelled';
    job.finishedAt = '2026-08-31T12:00:02.000Z';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) });
  });

  await page.route('**/api/admin/imports/urls', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    urlStartBody = request.postDataJSON();
    const job = baseJob('url-e2e', 'URL E2E.wav', { type: 'url', provider: null }, 'pending');
    jobs.push(job);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ job }) });
  });

  await page.route('**/api/admin/imports/url-e2e/validate', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    validationBody = request.postDataJSON();
    const index = jobs.findIndex(item => item.id === 'url-e2e');
    const job = validatedUrlJob(jobs[index]);
    jobs[index] = job;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job, validation: job.mediaDecision })
    });
  });

  await page.route('**/api/admin/imports/url-e2e/duplicates', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ check: duplicateDetected ? {
          jobId: 'url-e2e', confidence: 'none', disposition: 'clear', matches: [], hashCompared: true,
          checkedAt: '2026-08-31T12:00:02.000Z', reviewedAt: null
        } : null })
      });
      return;
    }
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    duplicateDetected = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        check: {
          jobId: 'url-e2e', confidence: 'none', disposition: 'clear', matches: [], hashCompared: true,
          checkedAt: '2026-08-31T12:00:02.000Z', reviewedAt: null
        }
      })
    });
  });

  await page.route('**/api/admin/imports/url-e2e/destination**', async route => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        destination: {
          folderPath: 'Importados',
          fileName: 'URL E2E.wav',
          relativePath: 'Importados/URL E2E.wav',
          collisionIndex: 1
        }
      })
    });
  });

  await page.route('**/api/admin/imports/url-e2e/promote', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-home-music-request']).toBe('1');
    promotionBody = request.postDataJSON();
    const job = jobs.find(item => item.id === 'url-e2e')!;
    job.status = 'completed';
    job.finishedAt = '2026-08-31T12:00:03.000Z';
    job.updatedAt = job.finishedAt;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        job,
        destination: {
          folderPath: 'Importados',
          fileName: 'URL E2E.wav',
          relativePath: 'Importados/URL E2E.wav',
          collisionIndex: 1
        }
      })
    });
  });

  await login(page);
  await openImport(page);

  const providerUrl = 'https://music.youtube.com/watch?v=e2e-fixture';
  await page.getByLabel('Link do YouTube ou YouTube Music').fill(providerUrl);
  await page.getByRole('button', { name: 'Analisar link', exact: true }).click();
  await expect(page.getByText('Provider E2E', { exact: true })).toBeVisible();
  expect(providerInspectBody).toEqual({ url: providerUrl });
  expect(providerStartBody).toEqual({ url: providerUrl });
  await page.locator('.admin-import-provider').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByText('Operação encerrada.', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Arquivo ou URL direta/ }).click();
  const directUrl = 'https://fixtures.invalid/audio/e2e.wav';
  await page.getByLabel('URL direta do arquivo').fill(directUrl);
  await page.getByRole('button', { name: 'Analisar URL', exact: true }).click();
  expect(urlStartBody).toEqual({ url: directUrl });

  await expect(page.locator('#admin-import-validation-title')).toHaveText('Formato de saída');
  await page.getByRole('button', { name: 'Validar mídia', exact: true }).click();
  expect(validationBody).toEqual({ profile: 'original' });

  await expect(page.getByText('URL E2E', { exact: true })).toBeVisible();
  await expect(page.getByText('Fixture Artist', { exact: true })).toBeVisible();
  await expect(page.getByText('Sem duplicata', { exact: true })).toBeVisible();
  await expect(page.getByText('Importados/URL E2E.wav', { exact: true })).toBeVisible();
  expect(duplicateDetected).toBe(true);

  await page.getByRole('button', { name: 'Importar para biblioteca', exact: true }).click();
  expect(promotionBody).toEqual({ folderPath: 'Importados' });
  await expect(page.getByText('Importação concluída', { exact: true })).toBeVisible();
});
