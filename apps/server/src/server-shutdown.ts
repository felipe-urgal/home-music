import { closeAll } from './close-resources.js';

export type RuntimeShutdownSteps = {
  stopAutoRescan(): void;
  beginLibraryShutdown(): void;
  waitForLibraryIdle(): Promise<void>;
  stopRhythm(): Promise<void>;
  closeInfrastructure(): void;
};

// The same cleanup is invoked from Fastify onClose and as a fallback after
// app.close(). If one hook aborts Fastify's lifecycle, SQLite owners must still
// be released; if Fastify did invoke this hook, never close them twice.
export function createRuntimeShutdown(steps: RuntimeShutdownSteps): () => Promise<void> {
  let shutdown: Promise<void> | null = null;
  return () => {
    shutdown ??= closeAll([
      () => steps.stopAutoRescan(),
      () => steps.beginLibraryShutdown(),
      async () => {
        try {
          await steps.waitForLibraryIdle();
        } catch {
          // The library already reports its own rejected scan or mutation.
        }
      },
      () => steps.stopRhythm(),
      () => steps.closeInfrastructure()
    ]);
    return shutdown;
  };
}

// app.close() can reject before invoking all onClose hooks. Always run the
// one-shot runtime cleanup as a fallback, without concealing Fastify's error.
export function closeFastifyWithRuntime(
  closeFastify: () => Promise<void>,
  closeRuntime: () => Promise<void>
): Promise<void> {
  return closeAll([closeFastify, closeRuntime]);
}
