export const PLAYLISTS_CHANGED_EVENT = 'home-music:playlists-changed';

export function notifyPlaylistsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
}
