import type { StatisticsPeriod } from '@home-music/shared';

export const STATISTICS_PERIODS: Array<{ value: StatisticsPeriod; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' }
];

export function formatListeningMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  if (safeMinutes < 60) return `${safeMinutes} min`;

  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}min` : `${hours}h`;
}

export function formatPlayCount(plays: number) {
  return `${plays} ${plays === 1 ? 'reprodução' : 'reproduções'}`;
}
