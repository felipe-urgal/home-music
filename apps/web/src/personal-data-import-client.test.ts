import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPersonalDataImport,
  PersonalDataImportClientError,
  previewPersonalDataImport,
  readPersonalDataImportFile
} from './personal-data-import-client';

const emptyCounts = { total: 0, found: 0, missing: 0, ambiguous: 0, conflict: 0 };
const preview = {
  format: 'home-music-personal-data' as const,
  version: 1 as const,
  exportedAt: '2026-09-06T12:00:00.000Z',
  references: emptyCounts,
  domains: {
    favorites: { items: 0, references: emptyCounts },
    manualPlaylists: { items: 0, references: emptyCounts },
    smartPlaylists: { items: 0 },
    libraryViews: { items: 0 },
    playbackHistory: { items: 0, references: emptyCounts },
    playbackState: { references: emptyCounts }
  },
  issues: [],
  issuesTruncated: false
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('personal data import client', () => {
  it('lê JSON local sem interpretar regras do domínio', async () => {
    const bundle = { format: 'qualquer-formato', nested: { value: 1 } };
    const file = {
      name: 'backup.json',
      size: 64,
      text: async () => JSON.stringify(bundle)
    } as File;

    await expect(readPersonalDataImportFile(file)).resolves.toEqual(bundle);
  });

  it('rejeita arquivo não JSON e JSON malformado antes da rede', async () => {
    await expect(readPersonalDataImportFile({
      name: 'backup.txt',
      size: 10,
      text: async () => '{}'
    } as File)).rejects.toThrow('arquivo JSON');

    await expect(readPersonalDataImportFile({
      name: 'backup.json',
      size: 10,
      text: async () => '{'
    } as File)).rejects.toThrow('JSON válido');
  });

  it('faz preview com o contrato compartilhado e exige confirmationToken válido', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      ...preview,
      confirmationToken: 'a'.repeat(64)
    }));
    vi.stubGlobal('fetch', fetchMock);

    const bundle = { format: 'home-music-personal-data', version: 1 };
    const result = await previewPersonalDataImport(bundle);

    expect(result.confirmationToken).toBe('a'.repeat(64));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/account/personal-data/import/preview');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Home-Music-Request': '1' });
    expect(JSON.parse(String(init.body))).toEqual(bundle);
  });

  it('propaga código HTTP acionável quando apply exige novo preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: 'O bundle ou a biblioteca mudou depois do preview.',
      code: 'preview-changed'
    }, 409)));

    try {
      await applyPersonalDataImport({}, 'a'.repeat(64));
      throw new Error('apply deveria falhar');
    } catch (error) {
      expect(error).toBeInstanceOf(PersonalDataImportClientError);
      expect((error as PersonalDataImportClientError).status).toBe(409);
      expect((error as PersonalDataImportClientError).code).toBe('preview-changed');
    }
  });
});
