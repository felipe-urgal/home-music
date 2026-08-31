import { useCallback, useEffect, useState } from 'react';

export type RoutedScreen = 'player' | 'library' | 'account' | 'admin';

export type LibraryRouteState = {
  libraryTab: 'folders' | 'playlists';
  folderPath: string;
  selectedPlaylistId: string | null;
};

export type AppRoute = {
  screen: RoutedScreen;
  path: string;
  valid: boolean;
  library?: LibraryRouteState;
};

const NAVIGATION_EVENT = 'home-music:navigation';

function canonicalPathname(pathname: string) {
  if (!pathname.startsWith('/')) return null;
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function decodeSegments(encoded: string) {
  if (!encoded) return [];
  const parts = encoded.split('/');
  if (parts.some(part => !part)) return null;
  try {
    return parts.map(part => decodeURIComponent(part));
  } catch {
    return null;
  }
}

function invalidRoute(): AppRoute {
  return { screen: 'player', path: '/', valid: false };
}

export function parseAppPath(pathname: string): AppRoute {
  const canonical = canonicalPathname(pathname);
  if (!canonical) return invalidRoute();

  if (canonical === '/') return { screen: 'player', path: '/', valid: true };
  if (canonical === '/account') return { screen: 'account', path: '/account', valid: true };
  if (canonical === '/admin') return { screen: 'admin', path: '/admin', valid: true };

  if (canonical === '/library' || canonical === '/library/folders') {
    return {
      screen: 'library',
      path: '/library',
      valid: true,
      library: { libraryTab: 'folders', folderPath: '', selectedPlaylistId: null }
    };
  }

  const folderPrefix = '/library/folders/';
  if (canonical.startsWith(folderPrefix)) {
    const segments = decodeSegments(canonical.slice(folderPrefix.length));
    if (!segments?.length) return invalidRoute();
    const folderPath = segments.join('/');
    return {
      screen: 'library',
      path: libraryPathForState({ libraryTab: 'folders', folderPath, selectedPlaylistId: null }),
      valid: true,
      library: { libraryTab: 'folders', folderPath, selectedPlaylistId: null }
    };
  }

  if (canonical === '/library/playlists') {
    return {
      screen: 'library',
      path: '/library/playlists',
      valid: true,
      library: { libraryTab: 'playlists', folderPath: '', selectedPlaylistId: null }
    };
  }

  const playlistPrefix = '/library/playlists/';
  if (canonical.startsWith(playlistPrefix)) {
    const segments = decodeSegments(canonical.slice(playlistPrefix.length));
    if (!segments || segments.length !== 1 || !segments[0]) return invalidRoute();
    const selectedPlaylistId = segments[0];
    return {
      screen: 'library',
      path: libraryPathForState({ libraryTab: 'playlists', folderPath: '', selectedPlaylistId }),
      valid: true,
      library: { libraryTab: 'playlists', folderPath: '', selectedPlaylistId }
    };
  }

  return invalidRoute();
}

export function libraryPathForState(state: LibraryRouteState) {
  if (state.libraryTab === 'playlists') {
    return state.selectedPlaylistId
      ? `/library/playlists/${encodeURIComponent(state.selectedPlaylistId)}`
      : '/library/playlists';
  }

  const folderPath = state.folderPath.trim().replace(/^\/+|\/+$/g, '');
  if (!folderPath) return '/library';
  return `/library/folders/${folderPath.split('/').map(encodeURIComponent).join('/')}`;
}

export function libraryRouteFromPath(pathname: string) {
  const route = parseAppPath(pathname);
  return route.valid && route.screen === 'library' ? route.library ?? null : null;
}

export function navigateAppPath(path: string, options: { replace?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const parsed = parseAppPath(path);
  const target = parsed.valid ? parsed.path : '/';
  const current = window.location.pathname;
  if (current !== target) {
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method](null, '', target);
  }
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

function pathForScreen(screen: RoutedScreen, libraryPath: string) {
  if (screen === 'player') return '/';
  if (screen === 'library') return libraryPath;
  if (screen === 'account') return '/account';
  return '/admin';
}

export function useRoutedScreen(options: {
  libraryPath: string;
  canAccessAdmin: boolean;
}) {
  const { libraryPath, canAccessAdmin } = options;

  const resolveCurrentScreen = useCallback(() => {
    if (typeof window === 'undefined') return 'player' as RoutedScreen;
    const route = parseAppPath(window.location.pathname);
    if (!route.valid) {
      window.history.replaceState(null, '', '/');
      return 'player' as RoutedScreen;
    }
    if (route.screen === 'admin' && !canAccessAdmin) {
      window.history.replaceState(null, '', '/account');
      return 'account' as RoutedScreen;
    }
    if (route.path !== window.location.pathname) {
      window.history.replaceState(null, '', route.path);
    }
    return route.screen;
  }, [canAccessAdmin]);

  const [screen, setScreenState] = useState<RoutedScreen>(resolveCurrentScreen);

  useEffect(() => {
    const sync = () => setScreenState(resolveCurrentScreen());
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    sync();
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, [resolveCurrentScreen]);

  const navigate = useCallback((requested: RoutedScreen) => {
    const target = requested === 'admin' && !canAccessAdmin ? 'account' : requested;
    const path = pathForScreen(target, libraryPath);
    navigateAppPath(path);
    setScreenState(target);
  }, [canAccessAdmin, libraryPath]);

  return [screen, navigate] as const;
}
