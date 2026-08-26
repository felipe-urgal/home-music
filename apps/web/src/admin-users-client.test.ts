import { describe, expect, it } from 'vitest';
import { canManageAdminTarget } from './admin-users-client';

describe('admin users frontend guard', () => {
  it('bloqueia auto-operações na superfície administrativa', () => {
    expect(canManageAdminTarget('user-a', 'user-a')).toBe(false);
  });

  it('permite ações visuais sobre outra conta', () => {
    expect(canManageAdminTarget('admin-a', 'user-b')).toBe(true);
  });
});
