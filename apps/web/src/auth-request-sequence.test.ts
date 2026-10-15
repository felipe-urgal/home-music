import { describe, expect, it } from 'vitest';
import { AuthRequestSequence } from './auth-request-sequence';

describe('AuthRequestSequence', () => {
  it('descarta resposta lenta A depois da resposta B, mesmo sem abort cooperativo', async () => {
    const requests = new AuthRequestSequence();
    const applied: string[] = [];
    let resolveOld!: (value: string) => void;
    const old = new Promise<string>(resolve => { resolveOld = resolve; });
    const a = requests.begin();
    const pending = old.then(value => { if (a.isCurrent()) applied.push(value); });
    const b = requests.begin();
    expect(a.signal.aborted).toBe(true);
    if (b.isCurrent()) applied.push('new');
    resolveOld('stale');
    await pending;
    expect(applied).toEqual(['new']);
  });

  it('invalida bootstrap/status anteriores ao login, logout ou troca de senha', () => {
    const requests = new AuthRequestSequence();
    for (const operation of ['login', 'logout', 'password']) {
      const request = requests.begin();
      requests.invalidate();
      expect(request.signal.aborted, operation).toBe(true);
      expect(request.isCurrent(), operation).toBe(false);
    }
  });

  it('descarta resposta após unmount e suporta o remount do StrictMode', () => {
    const requests = new AuthRequestSequence();
    const old = requests.begin();
    requests.dispose();
    expect(old.signal.aborted).toBe(true);
    expect(old.isCurrent()).toBe(false);
    requests.resume();
    const next = requests.begin();
    expect(next.isCurrent()).toBe(true);
    expect(old.isCurrent()).toBe(false);
  });
});
