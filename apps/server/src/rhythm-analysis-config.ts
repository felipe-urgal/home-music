export const DEFAULT_RHYTHM_ANALYSIS_ENABLED = true;

export function parseRhythmAnalysisEnabled(raw: string | undefined) {
  if (raw == null || raw.trim() === '') return DEFAULT_RHYTHM_ANALYSIS_ENABLED;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new Error('HOME_MUSIC_RHYTHM_ANALYSIS_ENABLED deve ser true ou false.');
}
