import { describe, expect, it } from 'vitest';
import { passwordChangeValidation } from './account-client';

describe('account password validation', () => {
  it('aceita senha nova válida e confirmação idêntica', () => {
    expect(passwordChangeValidation('senha-atual-123', 'nova-senha-segura-456', 'nova-senha-segura-456')).toBeNull();
  });

  it('rejeita senha curta, igual à atual e confirmação diferente', () => {
    expect(passwordChangeValidation('senha-atual-123', 'curta', 'curta')).toContain('12 caracteres');
    expect(passwordChangeValidation('senha-atual-123', 'senha-atual-123', 'senha-atual-123')).toContain('diferente');
    expect(passwordChangeValidation('senha-atual-123', 'nova-senha-segura-456', 'outra-senha-segura-789')).toContain('confirmação');
  });

  it('rejeita senha composta somente por whitespace', () => {
    expect(passwordChangeValidation('senha-atual-123', '            ', '            ')).toContain('somente espaços');
  });
});
