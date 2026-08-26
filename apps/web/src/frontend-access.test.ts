import { describe, expect, it } from 'vitest';
import { canUseAdminLibraryActions } from './frontend-access';

describe('frontend role surfaces', () => {
  it('expõe ações administrativas somente para admin', () => {
    expect(canUseAdminLibraryActions({ role: 'admin' })).toBe(true);
    expect(canUseAdminLibraryActions({ role: 'user' })).toBe(false);
  });

  it('falha fechado quando a identidade não está disponível', () => {
    expect(canUseAdminLibraryActions(null)).toBe(false);
    expect(canUseAdminLibraryActions(undefined)).toBe(false);
  });
});
