import { describe, expect, it } from 'vitest';
import {
  adminCoverUrl,
  MAX_ADMIN_COVER_BYTES,
  validateAdminCoverFile
} from './admin-track-cover';

describe('validateAdminCoverFile', () => {
  it('aceita formatos suportados dentro do limite', () => {
    expect(() => validateAdminCoverFile({ type: 'image/png', size: 1024 })).not.toThrow();
    expect(() => validateAdminCoverFile({ type: 'image/jpeg', size: 1024 })).not.toThrow();
    expect(() => validateAdminCoverFile({ type: 'image/webp', size: 1024 })).not.toThrow();
  });

  it('rejeita formato, arquivo vazio e tamanho excessivo', () => {
    expect(() => validateAdminCoverFile({ type: 'image/gif', size: 1024 })).toThrow(/JPEG, PNG ou WebP/);
    expect(() => validateAdminCoverFile({ type: 'image/png', size: 0 })).toThrow(/vazio/);
    expect(() => validateAdminCoverFile({ type: 'image/png', size: MAX_ADMIN_COVER_BYTES + 1 })).toThrow(/8 MiB/);
  });
});

describe('adminCoverUrl', () => {
  it('usa versão no override e nenhuma URL quando não há capa efetiva', () => {
    expect(adminCoverUrl('track a', {
      trackId: 'track a',
      physicalHasCover: false,
      effectiveHasCover: true,
      override: {
        contentType: 'image/png',
        width: 1,
        height: 1,
        sizeBytes: 100,
        updatedAt: '2026-08-28T00:00:00.000Z',
        version: 'abc 123'
      }
    })).toBe('/api/tracks/track%20a/cover?v=abc%20123');

    expect(adminCoverUrl('track-a', {
      trackId: 'track-a',
      physicalHasCover: false,
      effectiveHasCover: false,
      override: null
    })).toBeNull();
  });
});
