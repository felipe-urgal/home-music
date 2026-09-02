import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('App responsibility boundaries', () => {
  it('mantém App focado em sessão e conectividade', () => {
    const app = source('App.tsx');

    expect(app).toMatch(/<AuthenticatedApp\b/);
    expect(app).toMatch(/<OfflineApp\b/);
    expect(app).toMatch(/<LoginScreen\b/);
    expect(app).toMatch(/useAuth\(\)/);
    expect(app).toMatch(/useOfflineDownloads\(\)/);

    expect(app).not.toMatch(/useAudioPlayer\(/);
    expect(app).not.toMatch(/useLibraryData\(/);
    expect(app).not.toMatch(/useLibraryNavigation\(/);
    expect(app).not.toMatch(/useRoutedScreen\(/);
    expect(app).not.toMatch(/<DesktopShell\b/);
  });

  it('mantém App como autoridade da entrada manual no modo offline', () => {
    const app = source('App.tsx');
    const authenticated = source('AuthenticatedApp.tsx');
    const account = source('components/MyAccountScreen.tsx');

    expect(app).toMatch(/onOpenOffline=\{\(\) => setOfflineMode\(true\)\}/);
    expect(authenticated).toMatch(/offlineMode=\{\{/);
    expect(authenticated).toMatch(/availableCount: offline\.tracks\.length/);
    expect(account).toMatch(/<strong>Modo offline<\/strong>/);
    expect(account).toMatch(/disabled=\{!offlineModeAvailable\}/);
  });

  it('mantém composição autenticada e fontes globais juntas', () => {
    const authenticated = source('AuthenticatedApp.tsx');

    expect(authenticated).toMatch(/useLibraryData\(\)/);
    expect(authenticated).toMatch(/useLibraryNavigation\(/);
    expect(authenticated).toMatch(/useAudioPlayer\(/);
    expect(authenticated).toMatch(/useRoutedScreen\(/);
    expect(authenticated).toMatch(/<DesktopShell\b/);
  });

  it('mantém playback offline isolado da aplicação autenticada', () => {
    const offline = source('OfflineApp.tsx');

    expect(offline).toMatch(/useAudioPlayer\(/);
    expect(offline).toMatch(/offlineMode: true/);
    expect(offline).not.toMatch(/useLibraryData\(/);
    expect(offline).not.toMatch(/useLibraryNavigation\(/);
  });
});
