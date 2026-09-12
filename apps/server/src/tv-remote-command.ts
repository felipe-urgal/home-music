import type { TvRemoteCommand } from '@home-music/shared/tv-remote';

export function parseTvRemoteCommand(value: unknown): TvRemoteCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;

  if (body.type === 'toggle-play' || body.type === 'previous' || body.type === 'next') {
    return Object.keys(body).length === 1 ? { type: body.type } : null;
  }

  if (body.type === 'seek' && (body.deltaSeconds === -10 || body.deltaSeconds === 10)) {
    return Object.keys(body).length === 2 ? { type: 'seek', deltaSeconds: body.deltaSeconds } : null;
  }

  if (body.type === 'play-track' && typeof body.trackId === 'string' && Object.keys(body).length === 2) {
    const trackId = body.trackId.trim();
    return trackId ? { type: 'play-track', trackId } : null;
  }

  return null;
}
