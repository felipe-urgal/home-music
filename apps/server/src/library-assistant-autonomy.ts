import { DatabaseSync } from 'node:sqlite';
import { isLibraryAssistantAutoApplicable, type LibraryAssistantDecision } from '@home-music/shared/library-assistant';
import type { LibraryService } from './library-service.js';
import type { LibraryAssistantService } from './library-assistant-service.js';
import type { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';

export type LibraryAssistantAutonomyConfig = {
  enabled: boolean;
  metadata: boolean;
  fillMissingOnly: true;
};

export type LibraryAssistantAutonomyState = {
  config: LibraryAssistantAutonomyConfig;
  activeRunId: string | null;
  pendingRevision: number | null;
  lastSummary: { runId: string; applied: number; review: number; stale: number; failed: number; finishedAt: string } | null;
};

const DEFAULT_CONFIG: LibraryAssistantAutonomyConfig = { enabled: false, metadata: true, fillMissingOnly: true };

export class LibraryAssistantAutonomyStore {
  private readonly db: DatabaseSync;
  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS library_assistant_autonomy (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      metadata INTEGER NOT NULL DEFAULT 1,
      pending_revision INTEGER,
      active_run_id TEXT,
      last_summary_json TEXT
    ); INSERT OR IGNORE INTO library_assistant_autonomy(singleton, enabled, metadata) VALUES (1, ${DEFAULT_CONFIG.enabled ? 1 : 0}, ${DEFAULT_CONFIG.metadata ? 1 : 0});`);
  }
  get(): LibraryAssistantAutonomyState {
    const row = this.db.prepare('SELECT * FROM library_assistant_autonomy WHERE singleton = 1').get() as Record<string, unknown>;
    let lastSummary: LibraryAssistantAutonomyState['lastSummary'] = null;
    try { lastSummary = row.last_summary_json ? JSON.parse(String(row.last_summary_json)) : null; } catch { lastSummary = null; }
    return {
      config: { enabled: Boolean(row.enabled), metadata: Boolean(row.metadata), fillMissingOnly: true },
      activeRunId: row.active_run_id ? String(row.active_run_id) : null,
      pendingRevision: row.pending_revision == null ? null : Number(row.pending_revision),
      lastSummary
    };
  }
  setConfig(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Configuração de autonomia inválida.');
    const value = input as Record<string, unknown>;
    if (typeof value.enabled !== 'boolean') throw new TypeError('enabled deve ser booleano.');
    if ('metadata' in value && typeof value.metadata !== 'boolean') throw new TypeError('metadata deve ser booleano.');
    this.db.prepare('UPDATE library_assistant_autonomy SET enabled = ?, metadata = ? WHERE singleton = 1').run(value.enabled ? 1 : 0, value.metadata === false ? 0 : 1);
    if (!value.enabled) this.db.prepare('UPDATE library_assistant_autonomy SET pending_revision = NULL WHERE singleton = 1').run();
    return this.get().config;
  }
  setPending(revision: number | null) { this.db.prepare('UPDATE library_assistant_autonomy SET pending_revision = ? WHERE singleton = 1').run(revision); }
  setActive(runId: string | null) { this.db.prepare('UPDATE library_assistant_autonomy SET active_run_id = ? WHERE singleton = 1').run(runId); }
  setSummary(summary: NonNullable<LibraryAssistantAutonomyState['lastSummary']>) { this.db.prepare('UPDATE library_assistant_autonomy SET last_summary_json = ? WHERE singleton = 1').run(JSON.stringify(summary)); }
  close() { this.db.close(); }
}

type ReviewPort = Pick<LibraryAssistantCompositeReviewService, 'getReviewQueue' | 'decideBatch'>;

export class LibraryAssistantAutonomyController {
  private draining = false;
  private closed = false;
  constructor(
    private readonly store: LibraryAssistantAutonomyStore,
    private readonly assistant: Pick<LibraryAssistantService, 'startRun' | 'getRun' | 'cancelRun'>,
    private readonly review: ReviewPort
  ) {}

  state() { return this.store.get(); }
  resume() { if (this.store.get().config.enabled) void this.drain(); }
  configure(input: unknown) {
    const config = this.store.setConfig(input);
    if (!config.enabled) {
      const active = this.store.get().activeRunId;
      if (active) this.assistant.cancelRun(active);
      this.store.setActive(null);
    } else void this.drain();
    return this.store.get();
  }

  notifyLibraryChanged(revision: number, relevantChanges: number) {
    const state = this.store.get();
    if (!state.config.enabled || !state.config.metadata || relevantChanges <= 0) return;
    this.store.setPending(revision);
    void this.drain();
  }

  async close() { this.closed = true; }

  private async drain() {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      for (;;) {
        const state = this.store.get();
        if (!state.config.enabled || !state.config.metadata || state.pendingRevision == null || this.closed) return;
        this.store.setPending(null);
        const run = this.assistant.startRun('metadata', 'assistant-autonomy');
        this.store.setActive(run.id);
        const settled = await this.waitForRun(run.id);
        if (!settled || this.closed) return;
        let applied = 0;
        let stale = settled.status === 'stale' ? 1 : 0;
        let failed = settled.status === 'failed' ? 1 : 0;
        if (settled.status === 'completed' && this.store.get().config.enabled) {
          const queue = this.review.getReviewQueue(500);
          const decisions: LibraryAssistantDecision[] = queue.items
            .filter(item => item.suggestion.runId === run.id)
            .filter(item => item.suggestion.target.capability === 'metadata')
            .filter(item => item.suggestion.target.currentValue.trim() === '')
            .filter(item => isLibraryAssistantAutoApplicable(item.suggestion))
            .slice(0, 100)
            .map(item => ({
              runId: run.id,
              suggestionId: item.suggestion.id,
              action: 'apply' as const,
              expectedLibraryRevision: item.runLibraryRevision,
              expectedCurrentValue: item.suggestion.target.currentValue
            }));
          if (decisions.length) {
            const result = await this.review.decideBatch(decisions);
            applied = result.summary.applied;
            stale += result.summary.stale;
            failed += result.summary.failed;
          }
          const remaining = this.review.getReviewQueue(500).items.filter(item => item.suggestion.runId === run.id).length;
          this.store.setSummary({ runId: run.id, applied, review: remaining, stale, failed, finishedAt: new Date().toISOString() });
        }
        this.store.setActive(null);
      }
    } finally { this.draining = false; }
  }

  private async waitForRun(runId: string) {
    for (;;) {
      const run = this.assistant.getRun(runId);
      if (!run || ['completed', 'failed', 'cancelled', 'stale'].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

export function attachLibraryAssistantAutonomyLifecycle(library: LibraryService, controller: LibraryAssistantAutonomyController) {
  const originalRescan = library.rescan.bind(library);
  library.rescan = ((trigger?: Parameters<LibraryService['rescan']>[0]) => {
    const before = library.status().revision;
    return originalRescan(trigger).then(result => {
      if (library.status().revision !== before) controller.notifyLibraryChanged(library.status().revision, result.added + result.updated);
      return result;
    });
  }) as LibraryService['rescan'];

  const originalImport = library.updateForPromotedImport.bind(library);
  library.updateForPromotedImport = (async (...args: Parameters<LibraryService['updateForPromotedImport']>) => {
    const before = library.status().revision;
    await originalImport(...args);
    const after = library.status().revision;
    if (after !== before) controller.notifyLibraryChanged(after, 1);
  }) as LibraryService['updateForPromotedImport'];
}
