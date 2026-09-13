export type TvRemoteLibraryLocation =
  | { kind: 'root' }
  | { kind: 'folders'; folderPath: string }
  | { kind: 'playlists' }
  | { kind: 'playlist'; playlistId: string };

function parentFolderPath(folderPath: string) {
  const parts = folderPath.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

export function backTvRemoteLibraryLocation(
  location: TvRemoteLibraryLocation
): TvRemoteLibraryLocation | null {
  switch (location.kind) {
    case 'root':
      return null;
    case 'folders':
      if (!location.folderPath) return { kind: 'root' };
      return { kind: 'folders', folderPath: parentFolderPath(location.folderPath) };
    case 'playlists':
      return { kind: 'root' };
    case 'playlist':
      return { kind: 'playlists' };
  }
}

export function shouldShowTvRemoteLibrarySearch(location: TvRemoteLibraryLocation) {
  return location.kind === 'playlist'
    || (location.kind === 'folders' && Boolean(location.folderPath));
}
