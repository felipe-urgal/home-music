export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  format: string;
  hasCover: boolean;
};

export type LibraryResponse = {
  tracks: Track[];
  scannedAt: string;
  musicDir: string;
};
