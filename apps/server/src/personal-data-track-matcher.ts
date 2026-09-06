import path from 'node:path';
import type { PortableTrackReferenceV1 } from '@home-music/shared/personal-data';
import type { LibraryService } from './library-service.js';
import {
  parsePortableTrackReferenceV1,
  PersonalDataImportValidationError
} from './personal-data-import-parser.js';
import type { PersonalLibraryService } from './personal-library-service.js';

const HINT_DURATION_TOLERANCE_SECONDS = 1;

type PersonalTrackReferenceProjection = Pick<PersonalLibraryService, 'portableTrackReferences'>;
type LibraryTrackProjection = Pick<LibraryService, 'listPublicTracks'>;

type CanonicalTrackReference = {
  trackId: string;
  reference: PortableTrackReferenceV1;
};

type MatchCatalog = {
  entries: CanonicalTrackReference[];
  byRelativePath: Map<string, CanonicalTrackReference[]>;
};

export type PersonalDataTrackMatchStatus = 'found' | 'missing' | 'ambiguous' | 'invalid';
export type PersonalDataTrackMatchStrategy = 'relative-path' | 'hints' | null;
export type PersonalDataTrackMatchReason =
  | 'invalid-reference'
  | 'relative-path'
  | 'relative-path-conflict'
  | 'relative-path-ambiguous'
  | 'hints'
  | 'hints-ambiguous'
  | 'insufficient-hints'
  | 'no-candidate';

export type PersonalDataTrackMatchResult = {
  status: PersonalDataTrackMatchStatus;
  trackId: string | null;
  strategy: PersonalDataTrackMatchStrategy;
  reason: PersonalDataTrackMatchReason;
  candidateTrackIds: string[];
};

export class PersonalDataTrackMatcher {
  constructor(
    private readonly personal: PersonalTrackReferenceProjection,
    private readonly library: LibraryTrackProjection
  ) {}

  match(reference: unknown): PersonalDataTrackMatchResult {
    return this.matchMany([reference])[0]!;
  }

  matchMany(references: readonly unknown[]): PersonalDataTrackMatchResult[] {
    const catalog = this.buildCatalog();
    return references.map(reference => this.matchWithCatalog(reference, catalog));
  }

  private buildCatalog(): MatchCatalog {
    const activeTrackIds = this.library.listPublicTracks().map(track => track.id);
    const portableReferences = this.personal.portableTrackReferences(activeTrackIds);
    const entries: CanonicalTrackReference[] = [];
    const byRelativePath = new Map<string, CanonicalTrackReference[]>();

    for (const trackId of activeTrackIds) {
      const reference = portableReferences.get(trackId);
      if (!reference) continue;
      const entry = { trackId, reference };
      entries.push(entry);
      const pathEntries = byRelativePath.get(reference.relativePath) ?? [];
      pathEntries.push(entry);
      byRelativePath.set(reference.relativePath, pathEntries);
    }

    return { entries, byRelativePath };
  }

  private matchWithCatalog(value: unknown, catalog: MatchCatalog): PersonalDataTrackMatchResult {
    let reference: PortableTrackReferenceV1;
    try {
      reference = parsePortableTrackReferenceV1(value);
    } catch (error) {
      if (error instanceof PersonalDataImportValidationError) {
        return result('invalid', null, null, 'invalid-reference');
      }
      throw error;
    }

    const pathCandidates = catalog.byRelativePath.get(reference.relativePath) ?? [];
    if (pathCandidates.length > 1) {
      return result(
        'ambiguous',
        null,
        'relative-path',
        'relative-path-ambiguous',
        pathCandidates.map(candidate => candidate.trackId)
      );
    }

    const pathCandidate = pathCandidates[0];
    if (pathCandidate) {
      if (pathHintsCompatible(reference, pathCandidate.reference)) {
        return result('found', pathCandidate.trackId, 'relative-path', 'relative-path');
      }
      return result(
        'missing',
        null,
        'relative-path',
        'relative-path-conflict',
        [pathCandidate.trackId]
      );
    }

    if (!hasStrongHints(reference)) {
      return result('missing', null, null, 'insufficient-hints');
    }

    const hintCandidates = catalog.entries.filter(candidate => {
      return fallbackHintsMatch(reference, candidate.reference);
    });

    if (hintCandidates.length === 1) {
      return result('found', hintCandidates[0]!.trackId, 'hints', 'hints');
    }
    if (hintCandidates.length > 1) {
      return result(
        'ambiguous',
        null,
        'hints',
        'hints-ambiguous',
        hintCandidates.map(candidate => candidate.trackId)
      );
    }
    return result('missing', null, null, 'no-candidate');
  }
}

function pathHintsCompatible(
  imported: PortableTrackReferenceV1,
  candidate: PortableTrackReferenceV1
) {
  const importedHints = imported.hints;
  const candidateHints = candidate.hints;

  if (
    comparable(importedHints.title) !== comparable(candidateHints.title)
    || comparable(importedHints.artist) !== comparable(candidateHints.artist)
    || comparable(importedHints.album) !== comparable(candidateHints.album)
  ) {
    return false;
  }

  if (importedHints.durationSeconds == null || candidateHints.durationSeconds == null) {
    return true;
  }
  return durationMatches(importedHints.durationSeconds, candidateHints.durationSeconds);
}

function hasStrongHints(reference: PortableTrackReferenceV1) {
  return Boolean(
    comparable(reference.hints.title)
    && comparable(reference.hints.artist)
    && comparable(reference.hints.album)
    && reference.hints.durationSeconds != null
    && portableFileName(reference.relativePath)
  );
}

function fallbackHintsMatch(
  imported: PortableTrackReferenceV1,
  candidate: PortableTrackReferenceV1
) {
  const importedDuration = imported.hints.durationSeconds;
  const candidateDuration = candidate.hints.durationSeconds;
  if (importedDuration == null || candidateDuration == null) return false;

  return portableFileName(imported.relativePath) === portableFileName(candidate.relativePath)
    && comparable(imported.hints.title) === comparable(candidate.hints.title)
    && comparable(imported.hints.artist) === comparable(candidate.hints.artist)
    && comparable(imported.hints.album) === comparable(candidate.hints.album)
    && durationMatches(importedDuration, candidateDuration);
}

function portableFileName(relativePath: string) {
  return path.posix.basename(relativePath).normalize('NFC');
}

function comparable(value: string) {
  return value.trim().normalize('NFC');
}

function durationMatches(left: number, right: number) {
  return Math.abs(left - right) <= HINT_DURATION_TOLERANCE_SECONDS;
}

function result(
  status: PersonalDataTrackMatchStatus,
  trackId: string | null,
  strategy: PersonalDataTrackMatchStrategy,
  reason: PersonalDataTrackMatchReason,
  candidateTrackIds: string[] = []
): PersonalDataTrackMatchResult {
  return { status, trackId, strategy, reason, candidateTrackIds };
}
