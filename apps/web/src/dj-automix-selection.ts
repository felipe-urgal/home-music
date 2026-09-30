import { djKeyCompatibility, type Track } from '@home-music/shared';

export type DjAutomixSelection = {
  track: Track;
  index: number;
  score: number;
  reason: string;
  usedMusicalScoring: boolean;
};

type CandidateScore = DjAutomixSelection & {
  forwardDistance: number;
};

function safeBpm(track: Track) {
  const bpm = track.rhythm?.bpm;
  const confidence = track.rhythm?.confidence ?? 0;
  if (!Number.isFinite(bpm) || !bpm || bpm <= 0 || confidence < 0.45) return null;
  return { bpm, confidence };
}

function forwardDistance(index: number, currentIndex: number, length: number) {
  if (length <= 0) return 0;
  if (currentIndex < 0) return index + 1;
  const distance = (index - currentIndex + length) % length;
  return distance === 0 ? length : distance;
}

function musicalScore(current: Track, candidate: Track) {
  let score = 0;
  let used = false;
  const reasons: string[] = [];

  const currentBpm = safeBpm(current);
  const candidateBpm = safeBpm(candidate);
  if (currentBpm && candidateBpm) {
    used = true;
    const diff = Math.abs(currentBpm.bpm - candidateBpm.bpm);
    if (diff <= 2) {
      score += 36;
      reasons.push('BPM muito próximo');
    } else if (diff <= 6) {
      score += 28;
      reasons.push('BPM compatível');
    } else if (diff <= 12) {
      score += 14;
      reasons.push('BPM próximo');
    } else if (diff <= 20) {
      score += 2;
    } else {
      score -= 18;
    }
    score += Math.round(Math.min(currentBpm.confidence, candidateBpm.confidence) * 8);
  }

  if (current.key && candidate.key) {
    used = true;
    const compatibility = djKeyCompatibility(current.key, candidate.key);
    if (compatibility.compatible) {
      score += Math.round(compatibility.score * 30);
      reasons.push(
        compatibility.relation === 'same-key'
          ? 'mesma tonalidade'
          : compatibility.relation === 'relative-major-minor'
            ? 'tonalidade relativa'
            : 'Camelot compatível'
      );
    } else if (compatibility.relation === 'distant') {
      score -= 8;
    }
  }

  if (candidate.duration != null && Number.isFinite(candidate.duration)) {
    used = true;
    if (candidate.duration >= 90) score += 4;
    else if (candidate.duration < 30) score -= 6;
  }

  return {
    score,
    used,
    reason: reasons.slice(0, 2).join(' + ')
  };
}

export function selectDjAutomixNext(input: {
  tracks: readonly Track[];
  currentTrack: Track | null;
  currentIndex: number;
  playedTrackIds?: ReadonlySet<string>;
  rejectedTrackIds?: ReadonlySet<string>;
}): DjAutomixSelection | null {
  const { tracks, currentTrack, currentIndex } = input;
  if (!tracks.length) return null;
  if (tracks.length === 1) {
    const only = tracks[0]!;
    return {
      track: only,
      index: 0,
      score: 0,
      reason: 'única faixa disponível',
      usedMusicalScoring: false
    };
  }

  const rejected = input.rejectedTrackIds ?? new Set<string>();
  const candidates = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.id !== currentTrack?.id && !rejected.has(track.id));

  const usableCandidates = candidates.length
    ? candidates
    : tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.id !== currentTrack?.id);

  if (!usableCandidates.length) return null;

  const scored: CandidateScore[] = usableCandidates.map(({ track, index }) => {
    const musical = currentTrack
      ? musicalScore(currentTrack, track)
      : { score: 0, used: false, reason: '' };
    const playedPenalty = input.playedTrackIds?.has(track.id) ? 42 : 0;
    const distance = forwardDistance(index, currentIndex, tracks.length);

    return {
      track,
      index,
      score: musical.score - playedPenalty,
      reason: musical.reason || (playedPenalty ? 'já tocada · evitando repetição' : 'ordem da biblioteca'),
      usedMusicalScoring: musical.used,
      forwardDistance: distance
    };
  });

  const hasMusicalSignal = scored.some(candidate => candidate.usedMusicalScoring);
  if (!hasMusicalSignal) {
    scored.sort((left, right) => {
      const leftPlayed = input.playedTrackIds?.has(left.track.id) ? 1 : 0;
      const rightPlayed = input.playedTrackIds?.has(right.track.id) ? 1 : 0;
      return leftPlayed - rightPlayed
        || left.forwardDistance - right.forwardDistance
        || left.index - right.index;
    });
    return {
      ...scored[0]!,
      score: 0,
      reason: input.playedTrackIds?.has(scored[0]!.track.id)
        ? 'ordem da biblioteca · ciclo reiniciado'
        : 'ordem da biblioteca',
      usedMusicalScoring: false
    };
  }

  scored.sort((left, right) =>
    right.score - left.score
    || left.forwardDistance - right.forwardDistance
    || left.index - right.index
    || left.track.id.localeCompare(right.track.id)
  );

  return scored[0]!;
}
