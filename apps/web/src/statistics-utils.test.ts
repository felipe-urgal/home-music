import { describe, expect, it } from 'vitest';
import { formatListeningMinutes, formatPlayCount } from './statistics-utils';

describe('statistics utils', () => {
  it('formata minutos de forma compacta', () => {
    expect(formatListeningMinutes(42)).toBe('42 min');
    expect(formatListeningMinutes(60)).toBe('1h');
    expect(formatListeningMinutes(125)).toBe('2h 5min');
    expect(formatListeningMinutes(Number.NaN)).toBe('0 min');
  });

  it('flexiona contagem de reproduções', () => {
    expect(formatPlayCount(1)).toBe('1 reprodução');
    expect(formatPlayCount(3)).toBe('3 reproduções');
  });
});
