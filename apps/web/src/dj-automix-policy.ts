export function shouldStartDjAutomixTransition(input: {
  currentTimeSeconds: number;
  durationSeconds: number;
  crossfadeSeconds: number;
  quantizedStartTimeSeconds?: number | null;
  earlyToleranceSeconds?: number;
}) {
  const duration = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;
  const current = Number.isFinite(input.currentTimeSeconds) ? Math.max(0, input.currentTimeSeconds) : 0;
  if (duration <= 0) return false;

  if (input.quantizedStartTimeSeconds != null && Number.isFinite(input.quantizedStartTimeSeconds)) {
    return current >= Math.max(
      0,
      input.quantizedStartTimeSeconds - Math.max(0, input.earlyToleranceSeconds ?? 0)
    );
  }

  const remaining = Math.max(0, duration - current);
  const configured = Math.max(0, input.crossfadeSeconds);
  const triggerWindow = configured > 0 ? configured : 0.15;
  return remaining <= triggerWindow;
}

export function effectiveDjAutomixDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return 0.25;
  return Math.max(0.25, seconds);
}
