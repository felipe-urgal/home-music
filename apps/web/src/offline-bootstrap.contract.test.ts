import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('offline bootstrap contract', () => {
  it('mantém OfflineApp no shell inicial, entra pelo manifesto e reconcilia bytes fora do caminho crítico', () => {
    const app = source('App.tsx');
    const login = source('components/LoginScreen.tsx');

    expect(app).toMatch(/import \{ OfflineApp \} from '\.\/OfflineApp'/);
    expect(app).not.toMatch(/lazy\(/);
    expect(app).not.toMatch(/loadOfflineApp/);
    expect(app).toMatch(/readOfflineColdStartRecords\(offline\.records\)/);
    expect(app).toMatch(/navigator\.onLine !== false/);
    expect(app).toMatch(/automaticOfflineMode = auth\.unreachable && offline\.records\.length > 0/);
    expect(app).toMatch(/offlineSnapshot\(offline, coldStartRecords \?\? offline\.records\)/);
    expect(app).toMatch(/loading: false/);
    expect(app).toMatch(/showOfflineMode = offlineMode \|\| automaticOfflineMode/);
    expect(app).not.toMatch(/Verificando seus downloads offline/);
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

  it('serve o shell cacheado sem revalidar durante a navegação e mantém APIs fora do cache estático', () => {
    const worker = source('../public/sw.js');
    const registration = source('register-service-worker.ts');

    expect(worker).toMatch(/const CACHE_NAME = `\$\{CACHE_PREFIX\}v3`/);
    expect(worker).toMatch(/async function cacheFirstNavigation\(request\)/);
    expect(worker).toMatch(/const cachedShell = await cache\.match\(SHELL_URL\)/);
    expect(worker).toMatch(/if \(cachedShell\) return cachedShell;/);
    expect(worker).toMatch(/if \(isApiPath\(url\.pathname\)\) return;[\s\S]*if \(request\.mode === 'navigate'\)/);
    expect(worker).toMatch(/event\.respondWith\(cacheFirstNavigation\(request\)\)/);
    expect(worker).toMatch(/event\.data\?\.type === SHELL_REFRESH_REQUEST[\s\S]*event\.waitUntil\(refreshShellAfterClientLoad\(\)\)/);
    expect(registration).toMatch(/navigator\.onLine === false/);
    expect(registration).toMatch(/postMessage\(\{ type: SHELL_REFRESH_REQUEST \}\)/);
  });
});
