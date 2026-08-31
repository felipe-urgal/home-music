export type LibraryViewSort =
  | 'current'
  | 'title-asc'
  | 'title-desc'
  | 'artist-asc'
  | 'artist-desc'
  | 'album-asc'
  | 'album-desc';

export type LibraryViewCoverFilter = 'all' | 'with-cover' | 'without-cover';

export type LibraryViewDefinition = {
  query: string;
  format: string;
  cover: LibraryViewCoverFilter;
  sort: LibraryViewSort;
};

export type SavedLibraryView = {
  id: string;
  name: string;
  definition: LibraryViewDefinition;
  createdAt: string;
  updatedAt: string;
};

export type LibraryViewsResponse = {
  views: SavedLibraryView[];
};

export type LibraryViewResponse = {
  view: SavedLibraryView;
};
