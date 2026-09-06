import type {
  PersonalDataBundleV1,
  PersonalDataImportPreviewDomain,
  PersonalDataImportPreviewIssueReason,
  PersonalDataImportPreviewIssueV1,
  PersonalDataImportPreviewReferenceCounts,
  PersonalDataImportPreviewReferenceStatus,
  PersonalDataImportPreviewV1,
  PortableTrackReferenceV1
} from '@home-music/shared/personal-data';
import { PERSONAL_DATA_IMPORT_LIMITS } from '@home-music/shared/personal-data';
import {
  parsePersonalDataBundleV1,
  PersonalDataImportValidationError
} from './personal-data-import-parser.js';
import type {
  PersonalDataTrackMatcher,
  PersonalDataTrackMatchResult
} from './personal-data-track-matcher.js';

type TrackMatcher = Pick<PersonalDataTrackMatcher, 'matchMany'>;

export type PersonalDataImportReferenceLocation =
  | { kind: 'favorite'; index: number }
  | { kind: 'manual-playlist-track'; playlistIndex: number; trackIndex: number }
  | { kind: 'playback-history'; index: number }
  | { kind: 'playback-current' }
  | { kind: 'playback-base-queue'; index: number }
  | { kind: 'playback-queue'; index: number };

export type PersonalDataImportPlannedReference = {
  domain: PersonalDataImportPreviewDomain;
  field: string;
  location: PersonalDataImportReferenceLocation;
  reference: PortableTrackReferenceV1;
  match: PersonalDataTrackMatchResult;
};

export type PersonalDataImportPlan = {
  bundle: PersonalDataBundleV1;
  references: PersonalDataImportPlannedReference[];
  preview: PersonalDataImportPreviewV1;
};

type PendingReference = Omit<PersonalDataImportPlannedReference, 'match'>;

export class PersonalDataImportPlanner {
  constructor(private readonly matcher: TrackMatcher) {}

  plan(value: unknown): PersonalDataImportPlan {
    const bundle = parsePersonalDataBundleV1(value);
    const pending = collectReferences(bundle);
    const matches = this.matcher.matchMany(pending.map(item => item.reference));

    if (matches.length !== pending.length) {
      throw new Error('Personal data matcher returned an inconsistent result count.');
    }

    const references = pending.map((item, index): PersonalDataImportPlannedReference => {
      const match = matches[index]!;
      if (match.status === 'invalid') {
        throw new PersonalDataImportValidationError(
          'invalid-bundle',
          item.field,
          'Referência de faixa inválida no bundle pessoal.'
        );
      }
      return { ...item, match };
    });

    return {
      bundle,
      references,
      preview: buildPreview(bundle, references)
    };
  }
}

function collectReferences(bundle: PersonalDataBundleV1): PendingReference[] {
  const references: PendingReference[] = [];

  bundle.favorites.forEach((reference, index) => {
    references.push({
      domain: 'favorites',
      field: `$.favorites[${index}]`,
      location: { kind: 'favorite', index },
      reference
    });
  });

  bundle.manualPlaylists.forEach((playlist, playlistIndex) => {
    playlist.tracks.forEach((reference, trackIndex) => {
      references.push({
        domain: 'manual-playlists',
        field: `$.manualPlaylists[${playlistIndex}].tracks[${trackIndex}]`,
        location: { kind: 'manual-playlist-track', playlistIndex, trackIndex },
        reference
      });
    });
  });

  bundle.playbackHistory.forEach((item, index) => {
    references.push({
      domain: 'playback-history',
      field: `$.playbackHistory[${index}].track`,
      location: { kind: 'playback-history', index },
      reference: item.track
    });
  });

  if (bundle.playbackState.currentTrack) {
    references.push({
      domain: 'playback-state',
      field: '$.playbackState.currentTrack',
      location: { kind: 'playback-current' },
      reference: bundle.playbackState.currentTrack
    });
  }

  bundle.playbackState.baseQueue.forEach((reference, index) => {
    references.push({
      domain: 'playback-state',
      field: `$.playbackState.baseQueue[${index}]`,
      location: { kind: 'playback-base-queue', index },
      reference
    });
  });

  bundle.playbackState.queue.forEach((reference, index) => {
    references.push({
      domain: 'playback-state',
      field: `$.playbackState.queue[${index}]`,
      location: { kind: 'playback-queue', index },
      reference
    });
  });

  return references;
}

function buildPreview(
  bundle: PersonalDataBundleV1,
  references: PersonalDataImportPlannedReference[]
): PersonalDataImportPreviewV1 {
  const total = emptyCounts();
  const favorites = emptyCounts();
  const manualPlaylists = emptyCounts();
  const playbackHistory = emptyCounts();
  const playbackState = emptyCounts();
  const issues: PersonalDataImportPreviewIssueV1[] = [];
  let unresolved = 0;

  for (const planned of references) {
    const status = previewStatus(planned.match);
    increment(total, status);
    increment(domainCounts(planned.domain), status);

    if (status !== 'found') {
      unresolved += 1;
      if (issues.length < PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues) {
        issues.push({
          domain: planned.domain,
          field: planned.field,
          relativePath: planned.reference.relativePath,
          status,
          reason: previewReason(planned.match)
        });
      }
    }
  }

  return {
    format: bundle.format,
    version: bundle.version,
    exportedAt: bundle.exportedAt,
    references: total,
    domains: {
      favorites: { items: bundle.favorites.length, references: favorites },
      manualPlaylists: { items: bundle.manualPlaylists.length, references: manualPlaylists },
      smartPlaylists: { items: bundle.smartPlaylists.length },
      libraryViews: { items: bundle.libraryViews.length },
      playbackHistory: { items: bundle.playbackHistory.length, references: playbackHistory },
      playbackState: { references: playbackState }
    },
    issues,
    issuesTruncated: unresolved > issues.length
  };

  function domainCounts(domain: PersonalDataImportPreviewDomain) {
    switch (domain) {
      case 'favorites': return favorites;
      case 'manual-playlists': return manualPlaylists;
      case 'playback-history': return playbackHistory;
      case 'playback-state': return playbackState;
    }
  }
}

function emptyCounts(): PersonalDataImportPreviewReferenceCounts {
  return { total: 0, found: 0, missing: 0, ambiguous: 0, conflict: 0 };
}

function increment(
  counts: PersonalDataImportPreviewReferenceCounts,
  status: PersonalDataImportPreviewReferenceStatus
) {
  counts.total += 1;
  counts[status] += 1;
}

function previewStatus(match: PersonalDataTrackMatchResult): PersonalDataImportPreviewReferenceStatus {
  if (match.status === 'found') return 'found';
  if (match.status === 'ambiguous') return 'ambiguous';
  if (match.status === 'missing' && match.reason === 'relative-path-conflict') return 'conflict';
  return 'missing';
}

function previewReason(match: PersonalDataTrackMatchResult): PersonalDataImportPreviewIssueReason {
  switch (match.reason) {
    case 'relative-path-conflict':
    case 'relative-path-ambiguous':
    case 'hints-ambiguous':
    case 'insufficient-hints':
    case 'no-candidate':
      return match.reason;
    case 'invalid-reference':
      throw new Error('Invalid reference escaped personal data validation.');
    case 'relative-path':
    case 'hints':
      throw new Error('Found match cannot be emitted as a preview issue.');
  }
}
