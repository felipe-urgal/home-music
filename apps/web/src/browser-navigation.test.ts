import { describe, expect, it } from 'vitest';
import {
  libraryPathForState,
  libraryRouteFromPath,
  parseAppPath,
  routeForAccess
} from './browser-navigation';

describe('browser navigation routes', () => {
  it('mapeia superfícies principais para rotas canônicas', () => {
    expect(parseAppPath('/')).toMatchObject({ screen: 'player', path: '/', valid: true });
    expect(parseAppPath('/library')).toMatchObject({
      screen: 'library',
      path: '/library',
      valid: true,
      library: { libraryTab: 'folders', folderPath: '', selectedPlaylistId: null }
    });
    expect(parseAppPath('/library/playlists/')).toMatchObject({
      screen: 'library',
      path: '/library/playlists',
      valid: true,
      library: { libraryTab: 'playlists', selectedPlaylistId: null }
    });
    expect(parseAppPath('/account/')).toMatchObject({ screen: 'account', path: '/account', valid: true });
    expect(parseAppPath('/admin')).toMatchObject({ screen: 'admin', path: '/admin', valid: true });
  });

  it('preserva deep links de pasta com encoding por segmento', () => {
    const path = libraryPathForState({
      libraryTab: 'folders',
      folderPath: 'Rock nacional/Anos 80',
      selectedPlaylistId: null
    });
    expect(path).toBe('/library/folders/Rock%20nacional/Anos%2080');
    expect(libraryRouteFromPath(path)).toEqual({
      libraryTab: 'folders',
      folderPath: 'Rock nacional/Anos 80',
      selectedPlaylistId: null
    });
  });

  it('preserva pontos e espaços significativos nos nomes de pasta', () => {
    const folderPath = ' AC.DC /Music.v1 ';
    const path = libraryPathForState({
      libraryTab: 'folders',
      folderPath,
      selectedPlaylistId: null
    });

    expect(path).toBe('/library/folders/%20AC.DC%20/Music.v1%20');
    expect(libraryRouteFromPath(path)).toEqual({
      libraryTab: 'folders',
      folderPath,
      selectedPlaylistId: null
    });
  });

  it('remove apenas barras sintéticas nas extremidades do caminho de pasta', () => {
    const path = libraryPathForState({
      libraryTab: 'folders',
      folderPath: '/ AC.DC /',
      selectedPlaylistId: null
    });

    expect(path).toBe('/library/folders/%20AC.DC%20');
    expect(libraryRouteFromPath(path)?.folderPath).toBe(' AC.DC ');
  });

  it('preserva playlist selecionada em URL compartilhável', () => {
    const path = libraryPathForState({
      libraryTab: 'playlists',
      folderPath: '',
      selectedPlaylistId: 'playlist/estranha'
    });
    expect(path).toBe('/library/playlists/playlist%2Festranha');
    expect(libraryRouteFromPath(path)).toEqual({
      libraryTab: 'playlists',
      folderPath: '',
      selectedPlaylistId: 'playlist/estranha'
    });
  });

  it('rejeita URLs desconhecidas ou encoding inválido com fallback seguro', () => {
    expect(parseAppPath('/qualquer-coisa')).toEqual({ screen: 'player', path: '/', valid: false });
    expect(parseAppPath('/library/playlists/a/b')).toEqual({ screen: 'player', path: '/', valid: false });
    expect(parseAppPath('/library/folders/%E0%A4%A')).toEqual({ screen: 'player', path: '/', valid: false });
  });

  it('redireciona rota administrativa sem permissão para Minha conta', () => {
    const adminRoute = parseAppPath('/admin');
    expect(routeForAccess(adminRoute, true)).toEqual(adminRoute);
    expect(routeForAccess(adminRoute, false)).toEqual({
      screen: 'account',
      path: '/account',
      valid: true
    });
  });
});
