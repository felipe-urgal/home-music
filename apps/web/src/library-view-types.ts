import type {
  LibraryViewDefinition,
  LibraryViewSort,
  LibraryViewCoverFilter,
  LibraryViewResponse,
  LibraryViewsResponse,
  SavedLibraryView
} from '@home-music/shared';

export type {
  LibraryViewDefinition,
  LibraryViewSort,
  LibraryViewCoverFilter,
  LibraryViewResponse,
  LibraryViewsResponse,
  SavedLibraryView
} from '@home-music/shared';

export function compatibleLibraryViewDefinition(
  definition: LibraryViewDefinition,
  availableFormats: readonly string[],
  canSortTracks: boolean
): LibraryViewDefinition {
  const format = definition.format === 'all' || availableFormats.includes(definition.format)
    ? definition.format
    : 'all';
  const sort = canSortTracks ? definition.sort : 'current';

  if (format === definition.format && sort === definition.sort) return definition;

  return {
    ...definition,
    format,
    sort
  };
}
