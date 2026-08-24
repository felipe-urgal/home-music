export const DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS = 0;
export const MIN_AUTO_RESCAN_INTERVAL_SECONDS = 60;
export const MAX_AUTO_RESCAN_INTERVAL_SECONDS = 24 * 60 * 60;

export function parseAutoRescanIntervalSeconds(raw: string | undefined) {
  if (raw == null || raw.trim() === '') return DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('HOME_MUSIC_RESCAN_INTERVAL_SECONDS deve ser um número inteiro >= 0.');
  }
  if (value === 0) return 0;
  if (value < MIN_AUTO_RESCAN_INTERVAL_SECONDS || value > MAX_AUTO_RESCAN_INTERVAL_SECONDS) {
    throw new Error(
      `HOME_MUSIC_RESCAN_INTERVAL_SECONDS deve ser 0 ou ficar entre ${MIN_AUTO_RESCAN_INTERVAL_SECONDS} e ${MAX_AUTO_RESCAN_INTERVAL_SECONDS}.`
    );
  }
  return value;
}

type TimerHandle = ReturnType<typeof setTimeout>;

type SchedulerClock = {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

type AutoRescanSchedulerOptions = {
  intervalMs: number;
  initialDelayMs: number;
  run: () => Promise<void>;
  onError?: (error: unknown) => void;
  clock?: SchedulerClock;
};

const defaultClock: SchedulerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle)
};

export function startAutoRescanScheduler({
  intervalMs,
  initialDelayMs,
  run,
  onError,
  clock = defaultClock
}: AutoRescanSchedulerOptions) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => undefined;

  let stopped = false;
  let timer: TimerHandle | null = null;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = clock.setTimeout(() => {
      timer = null;
      void execute();
    }, Math.max(0, delayMs));
    timer.unref?.();
  };

  const execute = async () => {
    if (stopped) return;
    try {
      await run();
    } catch (error) {
      onError?.(error);
    } finally {
      if (!stopped) schedule(intervalMs);
    }
  };

  schedule(Math.min(initialDelayMs, intervalMs));

  return () => {
    stopped = true;
    if (timer) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };
}
