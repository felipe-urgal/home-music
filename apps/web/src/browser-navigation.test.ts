import { describe, expect, it } from 'vitest';
import {
  libraryPathForState,
  libraryRouteFromPath,
  parseAppPath
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
});
