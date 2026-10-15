/**
 * Per-useAuth request generation. Aborting saves work; the generation check
 * remains authoritative when a mocked fetch or browser ignores cancellation.
 */
export class AuthRequestSequence {
  private generation = 0;
  private controller: AbortController | null = null;
  private disposed = false;

  begin() {
    this.invalidate();
    const version = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () => !this.disposed && this.generation === version
    };
  }

  invalidate() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  resume() {
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
  }
}
