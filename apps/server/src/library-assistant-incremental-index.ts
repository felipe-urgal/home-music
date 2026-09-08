import { DatabaseSync } from 'node:sqlite';
import type { LibraryAssistantCapability } from '@home-music/shared/library-assistant';

const MAX_IDENTIFIER_LENGTH = 192;
const REUSABLE_STATUSES = new Set(['matched', 'no_match']);

type AnalysisStateStatus = 'pending' | 'matched' | 'no_match' | 'failed';

type Row = Record<string, unknown>;

export type LibraryAssistantIncrementalTrack = {
  id: string;
  premiseSignature: string;
};

type PlanRunInput = {
  runId: string;
  capability: LibraryAssistantCapability;
  analyzerIds: readonly string[];
  tracks: readonly LibraryAssistantIncrementalTrack[];
  forceFull?: boolean;
  updatedAt: string;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requireIdentifier(value: string, label: string, maximum = MAX_IDENTIFIER_LENGTH) {
  if (!value || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new TypeError(`${label} inválido.`);
  }
}

function stateKey(analyzerId: string, trackId: string) {
  return `${analyzerId}\u0000${trackId}`;
}

export class LibraryAssistantIncrementalIndex {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_analysis_state (
        capability TEXT NOT NULL CHECK(capability IN ('metadata', 'artwork', 'lyrics')),
        analyzer_id TEXT NOT NULL,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        premise_signature TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'matched', 'no_match', 'failed')),
        run_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(capability, analyzer_id, track_id)
      );

      CREATE INDEX IF NOT EXISTS idx_library_assistant_analysis_state_run
      ON library_assistant_analysis_state(run_id, capability);
    `);
  }

  close() {
    this.db.close();
  }

  planRun(input: PlanRunInput) {
    requireIdentifier(input.runId, 'runId');
    for (const analyzerId of input.analyzerIds) requireIdentifier(analyzerId, 'analyzerId', 128);
    for (const track of input.tracks) {
      requireIdentifier(track.id, 'trackId', 64);
      if (!/^[a-f0-9]{64}$/i.test(track.premiseSignature)) {
        throw new TypeError('Assinatura da premissa inválida.');
      }
    }
    if (input.analyzerIds.length === 0 || input.tracks.length === 0) return [] as string[];

    const rows = this.db.prepare(`
      SELECT analyzer_id, track_id, premise_signature, status
      FROM library_assistant_analysis_state
      WHERE capability = ?;
    `).all(input.capability) as Row[];
    const current = new Map(rows.map(row => [
      stateKey(stringValue(row.analyzer_id), stringValue(row.track_id)),
      {
        premiseSignature: stringValue(row.premise_signature),
        status: stringValue(row.status) as AnalysisStateStatus
      }
    ]));

    const selected = input.tracks.filter(track => {
      if (input.forceFull) return true;
      return input.analyzerIds.some(analyzerId => {
        const state = current.get(stateKey(analyzerId, track.id));
        return !state
          || state.premiseSignature !== track.premiseSignature
          || !REUSABLE_STATUSES.has(state.status);
      });
    });

    if (selected.length === 0) return [] as string[];

    const upsert = this.db.prepare(`
      INSERT INTO library_assistant_analysis_state(
        capability, analyzer_id, track_id, premise_signature, status, run_id, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(capability, analyzer_id, track_id) DO UPDATE SET
        premise_signature = excluded.premise_signature,
        status = 'pending',
        run_id = excluded.run_id,
        updated_at = excluded.updated_at;
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const analyzerId of input.analyzerIds) {
        for (const track of selected) {
          upsert.run(
            input.capability,
            analyzerId,
            track.id,
            track.premiseSignature,
            input.runId,
            input.updatedAt
          );
        }
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }

    return selected.map(track => track.id);
  }

  finishRun(runId: string, capability: LibraryAssistantCapability, updatedAt: string) {
    requireIdentifier(runId, 'runId');
    const rows = this.db.prepare(`
      SELECT analyzer_id, track_id, status
      FROM library_assistant_work_items
      WHERE run_id = ?;
    `).all(runId) as Row[];
    if (rows.length === 0) return 0;

    const update = this.db.prepare(`
      UPDATE library_assistant_analysis_state
      SET status = ?, updated_at = ?
      WHERE capability = ?
        AND analyzer_id = ?
        AND track_id = ?
        AND run_id = ?;
    `);
    let changed = 0;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const row of rows) {
        const status = stringValue(row.status);
        if (status !== 'matched' && status !== 'no_match' && status !== 'failed') continue;
        const result = update.run(
          status,
          updatedAt,
          capability,
          stringValue(row.analyzer_id),
          stringValue(row.track_id),
          runId
        );
        changed += Number(result.changes);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }

    return changed;
  }
}
