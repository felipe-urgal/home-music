export const MIN_REPLAY_GAIN_DB = -24;
export const MAX_REPLAY_GAIN_DB = 12;

export function clampReplayGainDb(value: number) {
  return Math.max(MIN_REPLAY_GAIN_DB, Math.min(MAX_REPLAY_GAIN_DB, value));
}

export function replayGainDb(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampReplayGainDb(value);
  }

  if (typeof value === 'string') {
    const match = /[+-]?\d+(?:\.\d+)?/.exec(value);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? clampReplayGainDb(parsed) : null;
  }

  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const db = replayGainDb(record.dB ?? record.db);
  if (db != null) return db;

  const ratio = Number(record.ratio);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return clampReplayGainDb(20 * Math.log10(ratio));
}
