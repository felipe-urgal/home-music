import type { Track } from '@home-music/shared';

export const ARTWORK_TONE_COUNT = 6;

export type ArtworkFallback = {
  label: string;
  tone: number;
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

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildArtworkFallback(track: Track): ArtworkFallback {
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

  return {
    label: initials(display),
    tone: hashSeed(seed) % ARTWORK_TONE_COUNT
  };
}
