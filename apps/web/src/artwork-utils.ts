import type { Track } from '@home-music/shared';
import {
  ARTWORK_FALLBACK_VERSION,
  ARTWORK_TONE_COUNT,
  buildArtworkFallback as buildSharedArtworkFallback,
  type ArtworkFallbackIdentity
} from '@home-music/shared/artwork';

export { ARTWORK_FALLBACK_VERSION, ARTWORK_TONE_COUNT };
export type { ArtworkFallbackIdentity };

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
  return buildSharedArtworkFallback(track);
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
