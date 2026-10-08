import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('admin users confirmation', () => {
  it('uses the shared accessible dialog for sensitive actions', () => {
    const source = readFileSync(new URL('./components/AdminUsersScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('ActionDialog');
    expect(source).toContain('canDiscardCredential');
    expect(source).not.toContain('window.confirm(');
  });
});
