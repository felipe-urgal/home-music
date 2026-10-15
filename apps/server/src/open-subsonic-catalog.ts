import { createHash } from 'node:crypto';
import type { Playlist, Track } from '@home-music/shared';
import type { LibraryService } from './library-service.js';
import { cleanText } from './open-subsonic-http.js';

export type OpenSubsonicLibrary = Pick<LibraryService, 'listPublicTracks' | 'getTrack'>;
export type CatalogAlbum = {
  id: string;
  name: string;
  artistId: string;
  artist: string;
  created: string;
  tracks: Track[];
};

export type CatalogArtist = {
  id: string;
  name: string;
  albums: CatalogAlbum[];
};

export type Catalog = {
  tracks: Track[];
  artists: CatalogArtist[];
  albums: CatalogAlbum[];
  artistById: Map<string, CatalogArtist>;
  albumById: Map<string, CatalogAlbum>;
  albumByTrackId: Map<string, CatalogAlbum>;
};

export function stableId(prefix: 'artist' | 'album', ...parts: string[]) {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix === 'artist' ? 'ar' : 'al'}-${digest}`;
}

export function safeIsoTimestamp(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '1970-01-01T00:00:00.000Z';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '1970-01-01T00:00:00.000Z' : date.toISOString();
}

export function artistName(track: Track) {
  return cleanText(track.albumArtist, 300) ?? cleanText(track.artist, 300) ?? 'Artista desconhecido';
}

export function albumName(track: Track) {
  return cleanText(track.album, 300) ?? 'Álbum desconhecido';
}

export function buildCatalog(tracks: Track[], library: OpenSubsonicLibrary): Catalog {
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
    const trackCreated = safeIsoTimestamp(library.getTrack(track.id)?.mtimeMs);
    let albumRecord = artistRecord.albumsByName.get(albumKey);
    if (!albumRecord) {
      albumRecord = {
        id: stableId('album', artistRecord.id, albumKey),
        name: album,
        artistId: artistRecord.id,
        artist: artistRecord.name,
        created: trackCreated,
        tracks: []
      };
      artistRecord.albumsByName.set(albumKey, albumRecord);
    } else if (trackCreated < albumRecord.created) {
      albumRecord.created = trackCreated;
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

export function lazyObject<T extends object>(factory: () => T): T {
  let value: T | null = null;
  return new Proxy({} as T, {
    get(_target, property) {
      value ??= factory();
      return Reflect.get(value, property, value);
    }
  });
}

export function lazyReadonlySet<T>(factory: () => ReadonlySet<T>): ReadonlySet<T> {
  let value: ReadonlySet<T> | null = null;
  return new Proxy(new Set<T>(), {
    get(_target, property) {
      value ??= factory();
      const member = Reflect.get(value, property, value);
      return typeof member === 'function' ? member.bind(value) : member;
    }
  });
}

export function coverTrackId(tracks: readonly Track[]) {
  return tracks.find(track => track.hasCover)?.id ?? null;
}

export function coverArtId(tracks: readonly Track[]) {
  const trackId = coverTrackId(tracks);
  return trackId ? `track:${trackId}` : undefined;
}

export function albumDuration(album: CatalogAlbum) {
  return Math.max(0, Math.round(album.tracks.reduce((total, track) => total + (track.duration ?? 0), 0)));
}

export function artistResponse(artist: CatalogArtist) {
  const coverArt = coverArtId(artist.albums.flatMap(album => album.tracks));
  return {
    id: artist.id,
    name: artist.name,
    ...(coverArt ? { coverArt } : {}),
    albumCount: artist.albums.length
  };
}

export function albumResponse(album: CatalogAlbum) {
  const coverArt = coverArtId(album.tracks) ?? '';
  return {
    id: album.id,
    parent: album.artistId,
    album: album.name,
    title: album.name,
    name: album.name,
    isDir: true,
    isVideo: false,
    artist: album.artist,
    artistId: album.artistId,
    artists: [{ id: album.artistId, name: album.artist }],
    coverArt,
    songCount: album.tracks.length,
    duration: albumDuration(album),
    created: album.created
  };
}

export function songResponse(
  track: Track,
  catalog: Catalog,
  library: OpenSubsonicLibrary,
  favoriteIds?: ReadonlySet<string>
) {
  const album = catalog.albumByTrackId.get(track.id);
  const internal = library.getTrack(track.id);
  if (!album || !internal) return null;
  const coverArt = track.hasCover ? `track:${track.id}` : coverArtId(album.tracks);
  const displayArtist = track.artist || album.artist;
  const artist = { id: album.artistId, name: displayArtist };
  const albumArtist = { id: album.artistId, name: album.artist };
  return {
    id: track.id,
    parent: album.id,
    isDir: false,
    title: track.title,
    album: album.name,
    artist: displayArtist,
    artists: [artist],
    albumArtists: [albumArtist],
    ...(coverArt ? { coverArt } : {}),
    size: internal.fileSize,
    contentType: internal.mimeType,
    suffix: track.format.replace(/^\./, '').toLowerCase(),
    duration: Math.max(0, Math.round(track.duration ?? 0)),
    albumId: album.id,
    artistId: album.artistId,
    type: 'music',
    isVideo: false,
    path: track.id,
    discNumber: 1,
    created: safeIsoTimestamp(internal.mtimeMs),
    ...(favoriteIds?.has(track.id) ? { starred: true } : {})
  };
}

export function indexesFromArtists(artists: CatalogArtist[]) {
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

export function playlistResponse(playlist: Playlist, catalog: Catalog) {
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

