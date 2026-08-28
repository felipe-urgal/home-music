export const PLAYLISTS_CHANGED_EVENT = 'home-music:playlists-changed';
export const LIBRARY_CHANGED_EVENT = 'home-music:library-changed';

export function notifyPlaylistsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
}

export function notifyLibraryChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
}
