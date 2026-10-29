export const WAVEFORM_BAR_COUNT = 72;

const MIN_HEIGHT = 8;
const MAX_HEIGHT = 96;

/** Reduz os picos da faixa a N barras (altura em %), preservando o contorno dinâmico. */
export function waveformBars(peaks: readonly number[], count = WAVEFORM_BAR_COUNT): number[] {
  if (peaks.length === 0 || count <= 0) return [];

  const buckets = Array.from({ length: count }, (_value, index) => {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count));
    let peak = 0;
    for (let cursor = start; cursor < end && cursor < peaks.length; cursor += 1) {
      peak = Math.max(peak, peaks[cursor]);
    }
    return peak;
  });

  const loudest = Math.max(...buckets);
  if (loudest <= 0) return buckets.map(() => MIN_HEIGHT);

  return buckets.map(peak => {
    const shaped = Math.sqrt(peak / loudest);
    return Math.round(MIN_HEIGHT + shaped * (MAX_HEIGHT - MIN_HEIGHT));
  });
}
