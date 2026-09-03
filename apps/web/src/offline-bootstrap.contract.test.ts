import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('offline bootstrap contract', () => {
  it('mantém a decisão automática de offline na raiz da aplicação', () => {
    const app = source('App.tsx');
    const login = source('components/LoginScreen.tsx');

    expect(app).toMatch(/automaticOfflineMode = auth\.unreachable && offlineCount > 0/);
    expect(app).toMatch(/showOfflineMode = offlineMode \|\| automaticOfflineMode/);
    expect(app).toMatch(/void loadOfflineApp\(\)\.catch/);
    expect(app).toMatch(/unreachable=\{auth\.unreachable\}/);

    expect(login).toMatch(/if \(unreachable\)/);
    expect(login).toMatch(/Home Music indisponível/);
    expect(login).not.toMatch(/offlineCount/);
    expect(login).not.toMatch(/onOpenOffline/);
  });

  it('mantém resposta real do servidor como autoridade de autenticação', () => {
    const auth = source('useAuth.ts');

    expect(auth).toMatch(/const response = await fetchAuthStatusResponse\(\);\s+reachedServer = true;/);
    expect(auth).toMatch(/if \(!response\.ok\) throw new Error/);
    expect(auth).toMatch(/if \(reachedServer\) forgetOfflineUserId\(\);/);
    expect(auth).toMatch(/const offline = !reachedServer;/);
  });

  it('serve o shell cacheado antes da rede e mantém APIs fora do cache estático', () => {
    const worker = source('../public/sw.js');

    expect(worker).toMatch(/const CACHE_NAME = `\$\{CACHE_PREFIX\}v3`/);
    expect(worker).toMatch(/async function cacheFirstNavigation\(request\)/);
    expect(worker).toMatch(/const cachedShell = await cache\.match\(SHELL_URL\)/);
    expect(worker).toMatch(/if \(cachedShell\) \{[\s\S]*void refresh;[\s\S]*return cachedShell;/);
    expect(worker).toMatch(/if \(isApiPath\(url\.pathname\)\) return;[\s\S]*if \(request\.mode === 'navigate'\)/);
    expect(worker).toMatch(/event\.respondWith\(cacheFirstNavigation\(request\)\)/);
  });
});
