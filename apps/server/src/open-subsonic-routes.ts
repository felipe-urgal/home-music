import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Playlist, Track } from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';
import type { OpenSubsonicAuthenticatedKey, OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import type { PersonalLibraryService } from './personal-library-service.js';
import { parseByteRange } from './security.js';
import type { TrackMediaInfrastructure } from './track-media-infrastructure.js';
import type { TranscodeQuality } from './transcoding.js';

const PROTOCOL_VERSION = '1.16.1';
const SERVER_TYPE = 'Home Music';
const SERVER_VERSION = '0.1.0';
const MUSIC_FOLDER_ID = '1';
const DEFAULT_LIST_COUNT = 20;
const MAX_LIST_COUNT = 500;
const VALID_KEY_REQUESTS_PER_MINUTE = 600;
const INVALID_AUTH_ATTEMPTS_PER_MINUTE = 30;
export const MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS = 4_096;

type QueryValue = string | string[] | undefined;
type Query = Record<string, QueryValue>;

type OpenSubsonicLibrary = Pick<LibraryService, 'listPublicTracks' | 'getTrack'>;
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
type OpenSubsonicMedia = Pick<
  TrackMediaInfrastructure,
  'openTrack' | 'cover' | 'lyrics' | 'prepareTranscode' | 'ffmpegAvailable'
>;
type OpenSubsonicCredentials = Pick<OpenSubsonicCredentialStore, 'authenticate'>;

type OpenSubsonicRouteOptions = {
  library: OpenSubsonicLibrary;
  personal: OpenSubsonicPersonal;
  media: OpenSubsonicMedia;
  credentials: OpenSubsonicCredentials;
};

type CatalogAlbum = {
  id: string;
  name: string;
  artistId: string;
  artist: string;
  tracks: Track[];
};

type CatalogArtist = {
  id: string;
  name: string;
  albums: CatalogAlbum[];
};

type Catalog = {
  tracks: Track[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
  artistById: Map<string, CatalogArtist>;
  albumById: Map<string, CatalogAlbum>;
  albumByTrackId: Map<string, CatalogAlbum>;
};

type RateEntry = { windowStartedAt: number; count: number };

export class OpenSubsonicRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  hit(subject: string, limit: number, now = Date.now()) {
    const current = this.entries.get(subject);
    if (current) {
      if (now - current.windowStartedAt >= 60_000) {
        this.entries.set(subject, { windowStartedAt: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    }

    if (this.entries.size >= MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS) {
      this.cleanup(now);
      if (this.entries.size >= MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS) return false;
    }

    this.entries.set(subject, { windowStartedAt: now, count: 1 });
    return true;
  }

  private cleanup(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= 120_000) this.entries.delete(key);
    }
  }
}

function responseBase() {
  return {
    version: PROTOCOL_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true
  } as const;
}

function success(payload: Record<string, unknown> = {}) {
  return {
    'subsonic-response': {
      status: 'ok',
      ...responseBase(),
      ...payload
    }
  };
}

function failure(code: number, message: string) {
  return {
    'subsonic-response': {
      status: 'failed',
      ...responseBase(),
      error: { code, message }
    }
  };
}

function one(query: Query, key: string) {
  const value = query[key];
  return typeof value === 'string' ? value : null;
}

function many(query: Query, key: string) {
  const value = query[key];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function has(query: Query, key: string) {
  return query[key] !== undefined;
}

function cleanText(value: string | null, maxLength = 500) {
  if (value == null) return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function boundedInteger(value: string | null, fallback: number, maximum = MAX_LIST_COUNT) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

function booleanParameter(value: string | null, fallback: boolean) {
  if (value == null || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function stableId(prefix: 'artist' | 'album', ...parts: string[]) {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix === 'artist' ? 'ar' : 'al'}-${digest}`;
}

function artistName(track: Track) {
  return cleanText(track.albumArtist, 300) ?? cleanText(track.artist, 300) ?? 'Artista desconhecido';
}

function albumName(track: Track) {
  return cleanText(track.album, 300) ?? 'Álbum desconhecido';
}

function buildCatalog(tracks: Track[]): Catalog {
  const artistsByName = new Map<string, { id: string; name: string; albumsByName: Map<string, CatalogAlbum> }>();
  const albumByTrackId = new Map<string, CatalogAlbum>();

  for (const track of tracks) {
    const artist = artistName(track);
    const album = albumName(track);
    const artistKey = artist.toLocaleLowerCase('pt-BR');
    let artistRecord = artistsByName.get(artistKey);
    if (!artistRecord) {
      artistRecord = {
        id: stableId('artist', artistKey),
        name: artist,
        albumsByName: new Map()
      };
      artistsByName.set(artistKey, artistRecord);
    }

    const albumKey = album.toLocaleLowerCase('pt-BR');
    let albumRecord = artistRecord.albumsByName.get(albumKey);
    if (!albumRecord) {
      albumRecord = {
        id: stableId('album', artistRecord.id, albumKey),
        name: album,
        artistId: artistRecord.id,
        artist: artistRecord.name,
        tracks: []
      };
      artistRecord.albumsByName.set(albumKey, albumRecord);
    }
    albumRecord.tracks.push(track);
    albumByTrackId.set(track.id, albumRecord);
  }

  const artists = [...artistsByName.values()]
    .map(record => ({
      id: record.id,
      name: record.name,
      albums: [...record.albumsByName.values()]
        .map(album => ({
          ...album,
          tracks: [...album.tracks].sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'))
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const albums = artists.flatMap(artist => artist.albums);

  return {
    tracks,
    artists,
    albums,
    artistById: new Map(artists.map(artist => [artist.id, artist])),
    albumById: new Map(albums.map(album => [album.id, album])),
    albumByTrackId
  };
}

function coverTrackId(tracks: readonly Track[]) {
  return tracks.find(track => track.hasCover)?.id ?? null;
}

function coverArtId(tracks: readonly Track[]) {
  const trackId = coverTrackId(tracks);
  return trackId ? `track:${trackId}` : undefined;
}

function albumDuration(album: CatalogAlbum) {
  return Math.max(0, Math.round(album.tracks.reduce((total, track) => total + (track.duration ?? 0), 0)));
}

function artistResponse(artist: CatalogArtist) {
  const coverArt = coverArtId(artist.albums.flatMap(album => album.tracks));
  return {
    id: artist.id,
    name: artist.name,
    ...(coverArt ? { coverArt } : {}),
    albumCount: artist.albums.length
  };
}

function albumResponse(album: CatalogAlbum) {
  const coverArt = coverArtId(album.tracks);
  return {
    id: album.id,
    parent: album.artistId,
    album: album.name,
    title: album.name,
    name: album.name,
    isDir: true,
    artist: album.artist,
    artistId: album.artistId,
    ...(coverArt ? { coverArt } : {}),
    songCount: album.tracks.length,
    duration: albumDuration(album)
  };
}

function songResponse(
  track: Track,
  catalog: Catalog,
  library: OpenSubsonicLibrary,
  favoriteIds?: ReadonlySet<string>
) {
  const album = catalog.albumByTrackId.get(track.id);
  const internal = library.getTrack(track.id);
  if (!album || !internal) return null;
  const coverArt = track.hasCover ? `track:${track.id}` : coverArtId(album.tracks);
  return {
    id: track.id,
    parent: album.id,
    isDir: false,
    title: track.title,
    album: album.name,
    artist: track.artist || album.artist,
    ...(coverArt ? { coverArt } : {}),
    size: internal.fileSize,
    contentType: internal.mimeType,
    suffix: track.format.replace(/^\./, '').toLowerCase(),
    duration: Math.max(0, Math.round(track.duration ?? 0)),
    albumId: album.id,
    artistId: album.artistId,
    type: 'music',
    isVideo: false,
    ...(favoriteIds?.has(track.id) ? { starred: true } : {})
  };
}

function indexesFromArtists(artists: CatalogArtist[]) {
  const groups = new Map<string, CatalogArtist[]>();
  for (const artist of artists) {
    const first = Array.from(artist.name.trim())[0]?.toLocaleUpperCase('pt-BR') ?? '#';
    const key = /[\p{L}\p{N}]/u.test(first) ? first : '#';
    const items = groups.get(key) ?? [];
    items.push(artist);
    groups.set(key, items);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR'))
    .map(([name, items]) => ({ name, artist: items.map(artistResponse) }));
}

function playlistResponse(playlist: Playlist, catalog: Catalog) {
  const tracks = playlist.trackIds
    .map(id => catalog.tracks.find(track => track.id === id))
    .filter((track): track is Track => Boolean(track));
  return {
    id: playlist.id,
    name: playlist.name,
    public: false,
    created: playlist.createdAt,
    changed: playlist.updatedAt,
    songCount: tracks.length,
    duration: Math.max(0, Math.round(tracks.reduce((total, track) => total + (track.duration ?? 0), 0)))
  };
}

function normalizeEndpoint(value: string) {
  return value.endsWith('.view') ? value.slice(0, -5) : value;
}

function transcodeQuality(maxBitRate: number): TranscodeQuality {
  if (maxBitRate <= 96) return 'economy';
  if (maxBitRate <= 160) return 'balanced';
  return 'high';
}

function authenticationFailure(query: Query) {
  const apiKeyPresent = has(query, 'apiKey');
  const passwordAuthPresent = has(query, 'u') || has(query, 'p');
  const tokenAuthPresent = has(query, 't') || has(query, 's');
  if (apiKeyPresent && (passwordAuthPresent || tokenAuthPresent)) {
    return failure(43, 'Múltiplos mecanismos de autenticação foram enviados.');
  }
  if (!apiKeyPresent && tokenAuthPresent) {
    return failure(41, 'Autenticação token/salt legada não é suportada. Use uma API key do Home Music.');
  }
  if (!apiKeyPresent && passwordAuthPresent) {
    return failure(42, 'Senha web não é aceita pelo adapter OpenSubsonic. Use uma API key do Home Music.');
  }
  return null;
}

function authenticatedRequest(
  request: FastifyRequest,
  query: Query,
  credentials: OpenSubsonicCredentials,
  limiter: OpenSubsonicRateLimiter
): { identity: OpenSubsonicAuthenticatedKey } | { response: ReturnType<typeof failure>; statusCode?: number } {
  const mechanismError = authenticationFailure(query);
  if (mechanismError) return { response: mechanismError };

  const apiKey = one(query, 'apiKey');
  if (!apiKey) {
    const subject = `invalid:${request.ip}`;
    if (!limiter.hit(subject, INVALID_AUTH_ATTEMPTS_PER_MINUTE)) {
      return { response: failure(0, 'Muitas tentativas de autenticação. Tente novamente em instantes.'), statusCode: 429 };
    }
    return { response: failure(44, 'API key inválida ou ausente.') };
  }

  const identity = credentials.authenticate(apiKey);
  if (!identity) {
    const subject = `invalid:${request.ip}`;
    if (!limiter.hit(subject, INVALID_AUTH_ATTEMPTS_PER_MINUTE)) {
      return { response: failure(0, 'Muitas tentativas de autenticação. Tente novamente em instantes.'), statusCode: 429 };
    }
    return { response: failure(44, 'API key inválida ou revogada.') };
  }

  if (!limiter.hit(`key:${identity.keyId}`, VALID_KEY_REQUESTS_PER_MINUTE)) {
    return { response: failure(0, 'Limite temporário de requisições atingido.'), statusCode: 429 };
  }
  return { identity };
}

async function sendOriginalRange(
  reply: FastifyReply,
  opened: { handle: FileHandle; stat: { size: number } },
  contentType: string,
  rangeHeader: string | undefined
) {
  const range = parseByteRange(rangeHeader, opened.stat.size);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', contentType);
  reply.header('Cache-Control', 'private, no-store');

  if (range === null) {
    await opened.handle.close();
    reply.header('Content-Range', `bytes */${opened.stat.size}`);
    return reply.code(416).send();
  }
  if (range === undefined) {
    reply.header('Content-Length', opened.stat.size);
    return reply.send(opened.handle.createReadStream({ autoClose: true }));
  }
  reply.code(206);
  reply.header('Content-Range', `bytes ${range.start}-${range.end}/${opened.stat.size}`);
  reply.header('Content-Length', range.end - range.start + 1);
  return reply.send(opened.handle.createReadStream({ start: range.start, end: range.end, autoClose: true }));
}

async function handleStream(
  request: FastifyRequest<{ Querystring: Query }>,
  reply: FastifyReply,
  options: OpenSubsonicRouteOptions
) {
  const id = one(request.query, 'id');
  if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));

  const rawFormat = cleanText(one(request.query, 'format'), 32);
  if (rawFormat && rawFormat !== 'raw' && rawFormat !== 'm4a' && rawFormat !== 'aac') {
    return reply.send(failure(0, 'Formato de transcoding solicitado não é suportado.'));
  }

  const maxBitRateRaw = one(request.query, 'maxBitRate');
  const maxBitRate = maxBitRateRaw == null ? null : boundedInteger(maxBitRateRaw, 0, 320);
  if (maxBitRateRaw != null && (maxBitRate == null || maxBitRate < 32)) {
    return reply.send(failure(10, 'Parâmetro maxBitRate inválido.'));
  }

  const wantsTranscode = rawFormat === 'm4a' || rawFormat === 'aac' || maxBitRate != null;
  if (wantsTranscode) {
    if (!options.media.ffmpegAvailable) {
      return reply.send(failure(0, 'Transcoding não está disponível neste servidor.'));
    }
    const quality = transcodeQuality(maxBitRate ?? 160);
    try {
      const prepared = await options.media.prepareTranscode(id, quality, 'off');
      if (!prepared) return reply.send(failure(70, 'Música não encontrada.'));
      const info = await prepared.transcoded.stat();
      if (!info.isFile() || info.size <= 0) {
        await prepared.transcoded.close();
        return reply.send(failure(0, 'Áudio transcodificado não está disponível.'));
      }
      return sendOriginalRange(
        reply,
        { handle: prepared.transcoded, stat: { size: info.size } },
        'audio/mp4',
        request.headers.range
      );
    } catch {
      return reply.send(failure(0, 'Não foi possível preparar o áudio solicitado.'));
    }
  }

  const source = await options.media.openTrack(id);
  if (!source) return reply.send(failure(70, 'Música não encontrada.'));
  return sendOriginalRange(reply, source.opened, source.track.mimeType, request.headers.range);
}

function ensureOwnUsername(query: Query, identity: OpenSubsonicAuthenticatedKey) {
  const requested = one(query, 'username');
  return requested == null || requested === identity.user.username;
}

function playlistError(status: string) {
  if (status === 'not-found') return failure(70, 'Playlist não encontrada.');
  if (status === 'read-only') return failure(50, 'Esta playlist é somente leitura.');
  return failure(10, 'Dados da playlist são inválidos.');
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

    const catalog = buildCatalog(options.library.listPublicTracks());
    const favoriteIds = new Set(options.personal.getFavoriteIds(userId));

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
      const track = catalog.tracks.find(item => item.id === id);
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
