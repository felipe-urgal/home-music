import type { Track } from '@home-music/shared';

export const ARTWORK_FALLBACK_VERSION = 1;
export const ARTWORK_TONE_COUNT = 6;

const ARTWORK_FALLBACK_PALETTES = [
  { glow: 'rgba(62, 156, 255, .45)', surface: '#18334a', base: '#081018' },
  { glow: 'rgba(88, 196, 167, .42)', surface: '#183a36', base: '#081210' },
  { glow: 'rgba(171, 116, 255, .42)', surface: '#2d2147', base: '#0d0914' },
  { glow: 'rgba(255, 143, 90, .42)', surface: '#45261c', base: '#130b08' },
  { glow: 'rgba(236, 103, 160, .4)', surface: '#402131', base: '#12090e' },
  { glow: 'rgba(214, 190, 82, .4)', surface: '#3f381d', base: '#111006' }
] as const;

export type ArtworkFallbackIdentity = {
  version: typeof ARTWORK_FALLBACK_VERSION;
  label: string;
  tone: number;
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

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeArtworkSize(size: number) {
  if (!Number.isFinite(size)) return 512;
  return Math.max(64, Math.min(1024, Math.round(size)));
}

export function buildArtworkFallback(track: Track): ArtworkFallbackIdentity {
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

  const tone = hashSeed(seed) % ARTWORK_TONE_COUNT;
  const palette = ARTWORK_FALLBACK_PALETTES[tone] ?? ARTWORK_FALLBACK_PALETTES[0];

  return {
    version: ARTWORK_FALLBACK_VERSION,
    label: initials(display),
    tone,
    palette: { ...palette }
  };
}

export function artworkFallbackSvg(identity: ArtworkFallbackIdentity, requestedSize = 512) {
  const size = normalizeArtworkSize(requestedSize);
  const label = escapeXml(identity.label);
  const gradientId = `hm-fallback-v${identity.version}-${identity.tone}`;
  const glowId = `${gradientId}-glow`;
  const fontSize = Math.round(size * 0.32);
  const discSize = Math.round(size * 0.19);
  const discX = size - Math.round(size * 0.08) - discSize;
  const discY = discX;
  const discCenterX = discX + discSize / 2;
  const discCenterY = discY + discSize / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" data-home-music-artwork="fallback" data-fallback-version="${identity.version}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${identity.palette.surface}"/><stop offset=".74" stop-color="${identity.palette.base}"/></linearGradient><radialGradient id="${glowId}" cx="24%" cy="18%" r="52%"><stop offset="0" stop-color="${identity.palette.glow}"/><stop offset="1" stop-color="${identity.palette.glow}" stop-opacity="0"/></radialGradient></defs><rect width="${size}" height="${size}" fill="url(#${gradientId})"/><rect width="${size}" height="${size}" fill="url(#${glowId})"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" fill="#f5f9fc" fill-opacity=".92" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="${fontSize}" font-weight="760">${label}</text><circle cx="${discCenterX}" cy="${discCenterY}" r="${discSize / 2}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="${Math.max(1, Math.round(size / 256))}"/><circle cx="${discCenterX}" cy="${discCenterY}" r="${Math.max(2, Math.round(size * 0.02))}" fill="#fff" fill-opacity=".62"/></svg>`;
}

export function artworkFallbackDataUrl(identity: ArtworkFallbackIdentity, requestedSize = 512) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artworkFallbackSvg(identity, requestedSize))}`;
}
