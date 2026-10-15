import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Track } from '@home-music/shared';
import type { OpenSubsonicAuthenticatedKey } from './open-subsonic-credentials.js';
import type { PersonalLibraryService } from './personal-library-service.js';
import {
  authenticatedRequest,
  OpenSubsonicRateLimiter,
  type OpenSubsonicCredentials
} from './open-subsonic-auth.js';
import {
  albumResponse,
  artistResponse,
  buildCatalog,
  indexesFromArtists,
  lazyObject,
  lazyReadonlySet,
  playlistResponse,
  songResponse,
  type OpenSubsonicLibrary
} from './open-subsonic-catalog.js';
import {
  booleanParameter,
  boundedInteger,
  cleanText,
  DEFAULT_LIST_COUNT,
  failure,
  has,
  many,
  normalizeEndpoint,
  one,
  success,
  type Query
} from './open-subsonic-http.js';
import { handleStream, type OpenSubsonicMedia } from './open-subsonic-stream.js';

export { MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS, OpenSubsonicRateLimiter } from './open-subsonic-auth.js';

const MUSIC_FOLDER_ID = '1';
type OpenSubsonicPersonal = Pick<
  PersonalLibraryService,
  | 'getFavoriteIds'
  | 'setFavorite'
  | 'getPlaylists'
  | 'createPlaylist'
  | 'renamePlaylist'
  | 'deletePlaylist'
  | 'setPlaylistTracks'
  | 'recordHistory'
>;
export type OpenSubsonicRouteOptions = {
  library: OpenSubsonicLibrary;
  personal: OpenSubsonicPersonal;
  media: OpenSubsonicMedia;
  credentials: OpenSubsonicCredentials;
};


function ensureOwnUsername(query: Query, identity: OpenSubsonicAuthenticatedKey) {
  const requested = one(query, 'username');
  return requested == null || requested === identity.user.username;
}

function playlistError(status: string) {
  if (status === 'not-found') return failure(70, 'Playlist não encontrada.');
  if (status === 'read-only') return failure(50, 'Esta playlist é somente leitura.');
  return failure(10, 'Dados da playlist são inválidos.');
}

function userResponse(identity: OpenSubsonicAuthenticatedKey) {
  return {
    username: identity.user.username,
    scrobblingEnabled: true,
    adminRole: identity.user.role === 'admin',
    settingsRole: false,
    downloadRole: false,
    uploadRole: false,
    playlistRole: true,
    coverArtRole: true,
    commentRole: false,
    podcastRole: false,
    streamRole: true,
    jukeboxRole: false,
    shareRole: false,
    folder: [MUSIC_FOLDER_ID]
  };
}

export function registerOpenSubsonicRoutes(
  app: FastifyInstance,
  options: OpenSubsonicRouteOptions
) {
  const limiter = new OpenSubsonicRateLimiter();

  app.get<{
    Params: { endpoint: string };
    Querystring: Query;
  }>('/rest/:endpoint', async (request, reply) => {
    const endpoint = normalizeEndpoint(request.params.endpoint);
    reply.type('application/json; charset=utf-8');
    reply.header('Cache-Control', 'private, no-store');

    const format = one(request.query, 'f');
    if (format && format !== 'json') {
      return reply.send(failure(0, 'O subset inicial do Home Music suporta respostas OpenSubsonic em JSON.'));
    }

    if (endpoint === 'getOpenSubsonicExtensions') {
      reply.header('Cache-Control', 'public, no-store');
      return reply.send(success({
        openSubsonicExtensions: [
          { name: 'apiKeyAuthentication', versions: [1] },
          { name: 'songLyrics', versions: [1] }
        ]
      }));
    }

    const auth = authenticatedRequest(request, request.query, options.credentials, limiter);
    if ('response' in auth) {
      if (auth.statusCode === 429) reply.header('Retry-After', '60');
      return reply.code(auth.statusCode ?? 200).send(auth.response);
    }
    const identity = auth.identity;
    const userId = identity.user.id;

    if (endpoint === 'ping') return reply.send(success());
    if (endpoint === 'getLicense') return reply.send(success({ license: { valid: true } }));
    if (endpoint === 'tokenInfo') {
      return reply.send(success({ tokenInfo: { username: identity.user.username } }));
    }
    if (endpoint === 'getUser') {
      if (!ensureOwnUsername(request.query, identity)) {
        return reply.send(failure(50, 'Não é permitido consultar outro usuário.'));
      }
      return reply.send(success({ user: userResponse(identity) }));
    }

    const catalog = lazyObject(() => buildCatalog(options.library.listPublicTracks(), options.library));
    const favoriteIds = lazyReadonlySet(() => new Set(options.personal.getFavoriteIds(userId)));

    if (endpoint === 'getMusicFolders') {
      return reply.send(success({
        musicFolders: { musicFolder: [{ id: MUSIC_FOLDER_ID, name: 'Home Music' }] }
      }));
    }

    if (endpoint === 'getIndexes') {
      return reply.send(success({
        indexes: {
          lastModified: 0,
          ignoredArticles: '',
          index: indexesFromArtists(catalog.artists)
        }
      }));
    }

    if (endpoint === 'getArtists') {
      return reply.send(success({
        artists: { ignoredArticles: '', index: indexesFromArtists(catalog.artists) }
      }));
    }

    if (endpoint === 'getArtist') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const artist = catalog.artistById.get(id);
      if (!artist) return reply.send(failure(70, 'Artista não encontrado.'));
      return reply.send(success({
        artist: {
          ...artistResponse(artist),
          album: artist.albums.map(albumResponse)
        }
      }));
    }

    if (endpoint === 'getAlbumList2') {
      const type = one(request.query, 'type');
      if (!type) return reply.send(failure(10, 'Parâmetro obrigatório ausente: type.'));
      const offset = boundedInteger(one(request.query, 'offset'), 0);
      const size = boundedInteger(one(request.query, 'size'), DEFAULT_LIST_COUNT);
      if (offset == null || size == null) return reply.send(failure(10, 'Paginação inválida.'));
      let albums = [...catalog.albums];
      if (type === 'alphabeticalByName') {
        albums.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
      } else if (type === 'alphabeticalByArtist') {
        albums.sort((left, right) => left.artist.localeCompare(right.artist, 'pt-BR') || left.name.localeCompare(right.name, 'pt-BR'));
      } else {
        return reply.send(failure(0, `Tipo de lista de álbuns não suportado: ${type}.`));
      }
      return reply.send(success({ albumList2: { album: albums.slice(offset, offset + size).map(albumResponse) } }));
    }

    if (endpoint === 'getAlbum') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const album = catalog.albumById.get(id);
      if (!album) return reply.send(failure(70, 'Álbum não encontrado.'));
      return reply.send(success({
        album: {
          ...albumResponse(album),
          song: album.tracks
            .map(track => songResponse(track, catalog, options.library, favoriteIds))
            .filter(Boolean)
        }
      }));
    }

    if (endpoint === 'getRandomSongs') {
      const size = boundedInteger(one(request.query, 'size'), 10);
      const musicFolderId = one(request.query, 'musicFolderId');
      if (size == null) return reply.send(failure(10, 'Tamanho da lista inválido.'));
      if (musicFolderId != null && musicFolderId !== MUSIC_FOLDER_ID) {
        return reply.send(failure(70, 'Pasta de música não encontrada.'));
      }
      const songs = [...catalog.tracks];
      const count = Math.min(size, songs.length);
      for (let index = 0; index < count; index += 1) {
        const chosen = randomInt(index, songs.length);
        [songs[index], songs[chosen]] = [songs[chosen], songs[index]];
      }
      return reply.send(success({
        randomSongs: {
          song: songs.slice(0, count)
            .map(track => songResponse(track, catalog, options.library, favoriteIds))
            .filter(Boolean)
        }
      }));
    }

    // A biblioteca ainda não indexa gênero; respostas vazias são válidas e não inventam dados.
    if (endpoint === 'getGenres') {
      return reply.send(success({ genres: { genre: [] } }));
    }

    if (endpoint === 'getSongsByGenre') {
      const genre = cleanText(one(request.query, 'genre'), 200);
      const count = boundedInteger(one(request.query, 'count'), DEFAULT_LIST_COUNT);
      const offset = boundedInteger(one(request.query, 'offset'), 0);
      const musicFolderId = one(request.query, 'musicFolderId');
      if (!genre) return reply.send(failure(10, 'Parâmetro obrigatório ausente: genre.'));
      if (count == null || offset == null) return reply.send(failure(10, 'Paginação inválida.'));
      if (musicFolderId != null && musicFolderId !== MUSIC_FOLDER_ID) {
        return reply.send(failure(70, 'Pasta de música não encontrada.'));
      }
      return reply.send(success({ songsByGenre: { song: [] } }));
    }

    if (endpoint === 'getSong') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const track = catalog.tracks.find(item => item.id === id);
      if (!track) return reply.send(failure(70, 'Música não encontrada.'));
      const song = songResponse(track, catalog, options.library, favoriteIds);
      if (!song) return reply.send(failure(70, 'Música não encontrada.'));
      return reply.send(success({ song }));
    }

    if (endpoint === 'getMusicDirectory') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      if (id === MUSIC_FOLDER_ID) {
        return reply.send(success({
          directory: {
            id,
            name: 'Home Music',
            child: catalog.artists.map(artist => ({ ...artistResponse(artist), isDir: true, title: artist.name }))
          }
        }));
      }
      const artist = catalog.artistById.get(id);
      if (artist) {
        return reply.send(success({
          directory: {
            id: artist.id,
            parent: MUSIC_FOLDER_ID,
            name: artist.name,
            child: artist.albums.map(albumResponse)
          }
        }));
      }
      const album = catalog.albumById.get(id);
      if (album) {
        return reply.send(success({
          directory: {
            id: album.id,
            parent: album.artistId,
            name: album.name,
            child: album.tracks
              .map(track => songResponse(track, catalog, options.library, favoriteIds))
              .filter(Boolean)
          }
        }));
      }
      return reply.send(failure(70, 'Diretório de música não encontrado.'));
    }

    if (endpoint === 'search3') {
      const rawQuery = one(request.query, 'query');
      if (rawQuery == null) return reply.send(failure(10, 'Parâmetro obrigatório ausente: query.'));
      const needle = rawQuery.trim().toLocaleLowerCase('pt-BR');
      const artistCount = boundedInteger(one(request.query, 'artistCount'), DEFAULT_LIST_COUNT);
      const artistOffset = boundedInteger(one(request.query, 'artistOffset'), 0);
      const albumCount = boundedInteger(one(request.query, 'albumCount'), DEFAULT_LIST_COUNT);
      const albumOffset = boundedInteger(one(request.query, 'albumOffset'), 0);
      const songCount = boundedInteger(one(request.query, 'songCount'), DEFAULT_LIST_COUNT);
      const songOffset = boundedInteger(one(request.query, 'songOffset'), 0);
      if ([artistCount, artistOffset, albumCount, albumOffset, songCount, songOffset].some(value => value == null)) {
        return reply.send(failure(10, 'Paginação da busca inválida.'));
      }
      const match = (value: string) => !needle || value.toLocaleLowerCase('pt-BR').includes(needle);
      const artists = catalog.artists.filter(artist => match(artist.name));
      const albums = catalog.albums.filter(album => match(album.name) || match(album.artist));
      const songs = catalog.tracks.filter(track => match(track.title) || match(track.artist) || match(track.album));
      return reply.send(success({
        searchResult3: {
          artist: artists.slice(artistOffset!, artistOffset! + artistCount!).map(artistResponse),
          album: albums.slice(albumOffset!, albumOffset! + albumCount!).map(albumResponse),
          song: songs
            .slice(songOffset!, songOffset! + songCount!)
            .map(track => songResponse(track, catalog, options.library, favoriteIds))
            .filter(Boolean)
        }
      }));
    }

    if (endpoint === 'stream') {
      return handleStream(request, reply, options);
    }

    if (endpoint === 'getCoverArt') {
      const rawId = one(request.query, 'id');
      if (!rawId) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const trackId = rawId.startsWith('track:') ? rawId.slice(6) : rawId;
      if (!options.library.getTrack(trackId)) return reply.send(failure(70, 'Capa não encontrada.'));
      const cover = await options.media.cover(trackId);
      if (!cover) return reply.send(failure(70, 'Capa não encontrada.'));
      reply.type(cover.format);
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(cover.data);
    }

    if (endpoint === 'getLyricsBySongId') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const track = options.library.getTrack(id);
      if (!track) return reply.send(failure(70, 'Música não encontrada.'));
      const lyrics = await options.media.lyrics(id);
      const structuredLyrics = lyrics ? [{
        displayArtist: track.artist,
        displayTitle: track.title,
        lang: 'und',
        synced: lyrics.synchronized,
        line: lyrics.lines.map(line => ({
          ...(line.time == null ? {} : { start: Math.max(0, Math.round(line.time * 1000)) }),
          value: line.text
        }))
      }] : [];
      return reply.send(success({ lyricsList: { structuredLyrics } }));
    }

    if (endpoint === 'getPlaylists') {
      if (!ensureOwnUsername(request.query, identity)) {
        return reply.send(failure(50, 'Não é permitido consultar playlists de outro usuário.'));
      }
      return reply.send(success({
        playlists: { playlist: options.personal.getPlaylists(userId).map(playlist => playlistResponse(playlist, catalog)) }
      }));
    }

    if (endpoint === 'getPlaylist') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const playlist = options.personal.getPlaylists(userId).find(item => item.id === id);
      if (!playlist) return reply.send(failure(70, 'Playlist não encontrada.'));
      const entry = playlist.trackIds
        .map(trackId => catalog.tracks.find(track => track.id === trackId))
        .filter((track): track is Track => Boolean(track))
        .map(track => songResponse(track, catalog, options.library, favoriteIds))
        .filter(Boolean);
      return reply.send(success({ playlist: { ...playlistResponse(playlist, catalog), entry } }));
    }

    if (endpoint === 'createPlaylist') {
      const name = cleanText(one(request.query, 'name'), 120);
      if (!name) return reply.send(failure(10, 'Parâmetro obrigatório ausente ou inválido: name.'));
      const songIds = many(request.query, 'songId');
      if (songIds.some(id => !options.library.getTrack(id))) {
        return reply.send(failure(70, 'Uma das músicas da playlist não foi encontrada.'));
      }
      const created = options.personal.createPlaylist(userId, name);
      if (created.status !== 'ok' || !created.playlist) return reply.send(playlistError(created.status));
      if (songIds.length) {
        const updated = options.personal.setPlaylistTracks(userId, created.playlist.id, songIds);
        if (updated.status !== 'ok') return reply.send(playlistError(updated.status));
      }
      const playlist = options.personal.getPlaylists(userId).find(item => item.id === created.playlist!.id);
      if (!playlist) return reply.send(failure(70, 'Playlist não encontrada após a criação.'));
      const entry = playlist.trackIds
        .map(trackId => catalog.tracks.find(track => track.id === trackId))
        .filter((track): track is Track => Boolean(track))
        .map(track => songResponse(track, catalog, options.library, favoriteIds))
        .filter(Boolean);
      return reply.send(success({ playlist: { ...playlistResponse(playlist, catalog), entry } }));
    }

    if (endpoint === 'updatePlaylist') {
      const playlistId = one(request.query, 'playlistId');
      if (!playlistId) return reply.send(failure(10, 'Parâmetro obrigatório ausente: playlistId.'));
      const current = options.personal.getPlaylists(userId).find(item => item.id === playlistId);
      if (!current) return reply.send(failure(70, 'Playlist não encontrada.'));

      const rawName = has(request.query, 'name') ? cleanText(one(request.query, 'name'), 120) : null;
      if (has(request.query, 'name') && !rawName) return reply.send(failure(10, 'Nome da playlist inválido.'));
      const additions = many(request.query, 'songIdToAdd');
      if (additions.some(id => !options.library.getTrack(id))) {
        return reply.send(failure(70, 'Uma das músicas adicionadas não foi encontrada.'));
      }
      const removalIndexes = many(request.query, 'songIndexToRemove').map(value => Number(value));
      if (removalIndexes.some(value => !Number.isSafeInteger(value) || value < 0)) {
        return reply.send(failure(10, 'Índice de remoção da playlist inválido.'));
      }

      if (rawName) {
        const renamed = options.personal.renamePlaylist(userId, playlistId, rawName);
        if (renamed.status !== 'ok') return reply.send(playlistError(renamed.status));
      }
      if (additions.length || removalIndexes.length) {
        const nextTrackIds = [...current.trackIds];
        for (const index of [...new Set(removalIndexes)].sort((left, right) => right - left)) {
          if (index < nextTrackIds.length) nextTrackIds.splice(index, 1);
        }
        nextTrackIds.push(...additions);
        const updated = options.personal.setPlaylistTracks(userId, playlistId, nextTrackIds);
        if (updated.status !== 'ok') return reply.send(playlistError(updated.status));
      }
      return reply.send(success());
    }

    if (endpoint === 'deletePlaylist') {
      const id = one(request.query, 'id');
      if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      const deleted = options.personal.deletePlaylist(userId, id);
      if (deleted.status !== 'ok') return reply.send(playlistError(deleted.status));
      return reply.send(success());
    }

    if (endpoint === 'getStarred2') {
      const songs = catalog.tracks
        .filter(track => favoriteIds.has(track.id))
        .map(track => songResponse(track, catalog, options.library, favoriteIds))
        .filter(Boolean);
      return reply.send(success({ starred2: { artist: [], album: [], song: songs } }));
    }

    if (endpoint === 'star' || endpoint === 'unstar') {
      if (has(request.query, 'artistId') || has(request.query, 'albumId')) {
        return reply.send(failure(0, 'O Home Music mapeia favoritos OpenSubsonic somente para músicas.'));
      }
      const ids = many(request.query, 'id');
      if (!ids.length) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      if (ids.some(id => !options.library.getTrack(id))) {
        return reply.send(failure(70, 'Uma das músicas não foi encontrada.'));
      }
      const favorite = endpoint === 'star';
      for (const id of ids) options.personal.setFavorite(userId, id, favorite);
      return reply.send(success());
    }

    if (endpoint === 'scrobble') {
      const ids = many(request.query, 'id');
      if (!ids.length) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));
      if (ids.some(id => !options.library.getTrack(id))) {
        return reply.send(failure(70, 'Uma das músicas não foi encontrada.'));
      }
      const submission = booleanParameter(one(request.query, 'submission'), true);
      if (submission == null) return reply.send(failure(10, 'Parâmetro submission inválido.'));
      if (!submission) return reply.send(success());

      const times = many(request.query, 'time');
      if (times.length && times.length !== ids.length) {
        return reply.send(failure(10, 'A quantidade de parâmetros time deve acompanhar os ids.'));
      }
      const playedAt = times.map(value => {
        if (!/^\d+$/.test(value)) return null;
        const milliseconds = Number(value);
        if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      });
      if (playedAt.some(value => value == null)) return reply.send(failure(10, 'Parâmetro time inválido.'));

      for (let index = 0; index < ids.length; index += 1) {
        options.personal.recordHistory(userId, ids[index], playedAt[index] ?? undefined);
      }
      return reply.send(success());
    }

    return reply.send(failure(0, `Endpoint OpenSubsonic não suportado pelo Home Music: ${endpoint}.`));
  });
}

