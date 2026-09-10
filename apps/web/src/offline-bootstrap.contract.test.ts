import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('offline bootstrap contract', () => {
  it('mantém OfflineApp no shell inicial e decide cold start por bytes locais, não por workerSupported', () => {
    const app = source('App.tsx');
    const login = source('components/LoginScreen.tsx');

    expect(app).toMatch(/import \{ OfflineApp \} from '\.\/OfflineApp'/);
    expect(app).not.toMatch(/lazy\(/);
    expect(app).not.toMatch(/loadOfflineApp/);
    expect(app).toMatch(/readOfflineColdStartRecords\(offline\.records\)/);
    expect(app).toMatch(/automaticOfflineMode = auth\.unreachable && Boolean\(coldStartRecords\?\.length\)/);
    expect(app).toMatch(/showOfflineMode = offlineMode \|\| automaticOfflineMode/);
    expect(app).not.toMatch(/offline\.supported.*automaticOfflineMode/);
    expect(app).toMatch(/unreachable=\{auth\.unreachable\}/);

    expect(login).toMatch(/if \(unreachable\)/);
    expect(login).toMatch(/Home Music indisponível/);
    expect(login).not.toMatch(/coldStartRecords/);
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
    expect(worker).toMatch(/async function prepareCacheFirstNavigation\(request\)/);
    expect(worker).toMatch(/const cachedShell = await cache\.match\(SHELL_URL\)/);
    expect(worker).toMatch(/if \(cachedShell\) \{[\s\S]*self\.navigator\.onLine !== false[\s\S]*refreshCachedShell\(request, cache\)[\s\S]*return \{ response: cachedShell, maintenance \};/);
    expect(worker).toMatch(/if \(isApiPath\(url\.pathname\)\) return;[\s\S]*if \(request\.mode === 'navigate'\)/);
    expect(worker).toMatch(/event\.respondWith\(navigation\.then\(result => result\.response\)\)/);
    expect(worker).toMatch(/event\.waitUntil\(navigation\.then\(result => result\.maintenance\)\)/);
  });
});
