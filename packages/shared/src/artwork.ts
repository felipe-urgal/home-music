export const ARTWORK_FALLBACK_VERSION = 1;
export const ARTWORK_TONE_COUNT = 6;

export const ARTWORK_FALLBACK_PALETTES = [
  { glow: 'rgba(62, 156, 255, .45)', surface: '#18334a', base: '#081018' },
  { glow: 'rgba(88, 196, 167, .42)', surface: '#183a36', base: '#081210' },
  { glow: 'rgba(171, 116, 255, .42)', surface: '#2d2147', base: '#0d0914' },
  { glow: 'rgba(255, 143, 90, .42)', surface: '#45261c', base: '#130b08' },
  { glow: 'rgba(236, 103, 160, .4)', surface: '#402131', base: '#12090e' },
  { glow: 'rgba(214, 190, 82, .4)', surface: '#3f381d', base: '#111006' }
] as const;

export type ArtworkFallbackTrack = {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
};

export type ArtworkFallbackIdentity = {
  version: typeof ARTWORK_FALLBACK_VERSION;
  label: string;
  tone: number;
  seed: string;
  palette: {
    glow: string;
    surface: string;
    base: string;
  };
};

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function isKnown(value: string, unknownLabel: string) {
  return Boolean(value) && value.toLocaleLowerCase('pt-BR') !== unknownLabel.toLocaleLowerCase('pt-BR');
}

function initials(value: string) {
  const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length >= 2) {
    const firstWord = words[0] ?? '';
    const secondWord = words[1] ?? '';
    return `${Array.from(firstWord)[0] ?? ''}${Array.from(secondWord)[0] ?? ''}`.toLocaleUpperCase('pt-BR');
  }

  const characters = Array.from(words[0] ?? value).filter(character => /[\p{L}\p{N}]/u.test(character));
  return characters.slice(0, 2).join('').toLocaleUpperCase('pt-BR') || 'HM';
}

export function artworkFallbackHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildArtworkFallback(track: ArtworkFallbackTrack): ArtworkFallbackIdentity {
  const album = clean(track.album);
  const albumArtist = clean(track.albumArtist) || clean(track.artist);
  const artist = clean(track.artist);
  const title = clean(track.title) || 'Música';

  let display = title;
  let seed = `track:${track.id}:${title}`;

  if (isKnown(album, 'Álbum desconhecido')) {
    display = album;
    seed = `album:${albumArtist}:${album}`;
  } else if (isKnown(albumArtist, 'Artista desconhecido')) {
    display = albumArtist;
    seed = `artist:${albumArtist}`;
  } else if (isKnown(artist, 'Artista desconhecido')) {
    display = artist;
    seed = `artist:${artist}`;
  }

  const tone = artworkFallbackHash(seed) % ARTWORK_TONE_COUNT;
  const palette = ARTWORK_FALLBACK_PALETTES[tone] ?? ARTWORK_FALLBACK_PALETTES[0];

  return {
    version: ARTWORK_FALLBACK_VERSION,
    label: initials(display),
    tone,
    seed,
    palette: { ...palette }
  };
}
