import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  LibraryAssistantLyricsSource,
  LocalLyricsPreviewLine,
  LocalLyricsQuality
} from '@home-music/shared/library-assistant';
import { MAX_MANAGED_LYRICS_BYTES } from './track-lyrics-overrides.js';

const MAX_CANDIDATES = 500;
const MAX_MODEL_LABEL_LENGTH = 160;
const MAX_PROVIDER_VERSION_LENGTH = 160;
const MAX_LANGUAGE_LENGTH = 32;
const MAX_PREVIEW_LINES = 500;

type Row = Record<string, unknown>;

export type LocalLyricsCandidate = {
  id: string;
  trackId: string;
  source: Extract<LibraryAssistantLyricsSource, 'local-transcription' | 'local-alignment'>;
  synchronized: true;
  text: string;
  language: string | null;
  providerVersion: string | null;
  modelLabel: string;
  baseLyricsFingerprint: string;
  quality: LocalLyricsQuality;
  previewLines: LocalLyricsPreviewLine[];
  createdAt: string;
};

type SaveCandidate = Omit<LocalLyricsCandidate, 'createdAt' | 'synchronized'> & {
  createdAt?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireIdentifier(value: string, label: string, maximum = 192) {
  if (!value || value.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new TypeError(`${label} inválido.`);
  }
}

function requireFingerprint(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Fingerprint de lyrics inválido.');
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function validateQuality(value: LocalLyricsQuality) {
  for (const count of [value.totalLines, value.alignedLines, value.lowConfidenceLines, value.unalignedLines]) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new RangeError('Qualidade de alinhamento inválida.');
  }
  if (value.alignedLines + value.lowConfidenceLines + value.unalignedLines !== value.totalLines) {
    throw new RangeError('Contagem de alinhamento inconsistente.');
  }
  if (!Number.isFinite(value.coverage) || value.coverage < 0 || value.coverage > 1) {
    throw new RangeError('Cobertura de alinhamento inválida.');
  }
  if (!Number.isFinite(value.divergence) || value.divergence < 0 || value.divergence > 1) {
    throw new RangeError('Divergência de alinhamento inválida.');
  }
  for (const seconds of [value.durationSeconds, value.maxTimestampSeconds]) {
    if (seconds != null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 60 * 60)) {
      throw new RangeError('Duração de alinhamento inválida.');
    }
  }
}

function validatePreview(lines: LocalLyricsPreviewLine[]) {
  if (!Array.isArray(lines) || lines.length > MAX_PREVIEW_LINES) throw new RangeError('Preview de lyrics inválido.');
  for (const line of lines) {
    if (typeof line.text !== 'string' || !line.text.trim() || line.text.length > 2_000) {
      throw new RangeError('Linha de preview inválida.');
    }
    if (!['aligned', 'low-confidence', 'unaligned'].includes(line.state)) {
      throw new TypeError('Estado de preview inválido.');
    }
    if (line.time != null && (!Number.isFinite(line.time) || line.time < 0 || line.time > 24 * 60 * 60)) {
      throw new RangeError('Timestamp de preview inválido.');
    }
  }
}

export class LocalLyricsCandidateStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_lyrics_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('local-transcription', 'local-alignment')),
        content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) BETWEEN 1 AND ${MAX_MANAGED_LYRICS_BYTES}),
        language TEXT,
        provider_version TEXT,
        model_label TEXT NOT NULL,
        base_lyrics_fingerprint TEXT NOT NULL CHECK(length(base_lyrics_fingerprint) = 64),
        quality_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_local_lyrics_candidates_created
      ON local_lyrics_candidates(created_at DESC, id DESC);
    `);
  }

  close() {
    this.db.close();
  }

  get(id: string): LocalLyricsCandidate | null {
    requireIdentifier(id, 'candidateId');
    const row = this.db.prepare(`
      SELECT * FROM local_lyrics_candidates WHERE id = ? LIMIT 1;
    `).get(id) as Row | undefined;
    if (!row) return null;
    const source = row.source === 'local-alignment' ? 'local-alignment' : 'local-transcription';
    return {
      id: text(row.id),
      trackId: text(row.track_id),
      source,
      synchronized: true,
      text: text(row.content),
      language: nullableText(row.language),
      providerVersion: nullableText(row.provider_version),
      modelLabel: text(row.model_label),
      baseLyricsFingerprint: text(row.base_lyrics_fingerprint),
      quality: safeJson(row.quality_json, {
        totalLines: 0,
        alignedLines: 0,
        lowConfidenceLines: 0,
        unalignedLines: 0,
        coverage: 0,
        monotonic: false,
        divergence: 1,
        durationSeconds: null,
        maxTimestampSeconds: null
      }),
      previewLines: safeJson(row.preview_json, []),
      createdAt: text(row.created_at)
    };
  }

  save(input: SaveCandidate) {
    requireIdentifier(input.id, 'candidateId');
    requireIdentifier(input.trackId, 'trackId', 64);
    requireFingerprint(input.baseLyricsFingerprint);
    const clean = input.text.replace(/^\uFEFF/, '').trim();
    if (!clean || Buffer.byteLength(clean, 'utf8') > MAX_MANAGED_LYRICS_BYTES) {
      throw new RangeError('Candidato local de lyrics excede o limite permitido.');
    }
    if (input.source !== 'local-transcription' && input.source !== 'local-alignment') {
      throw new TypeError('Fonte local de lyrics inválida.');
    }
    if (!input.modelLabel.trim() || input.modelLabel.length > MAX_MODEL_LABEL_LENGTH || /[\r\n\t]/.test(input.modelLabel)) {
      throw new TypeError('Identificação do modelo inválida.');
    }
    if (input.providerVersion != null && (
      input.providerVersion.length > MAX_PROVIDER_VERSION_LENGTH || /[\r\n\t]/.test(input.providerVersion)
    )) throw new TypeError('Versão do Whisper inválida.');
    if (input.language != null && (
      input.language.length > MAX_LANGUAGE_LENGTH || !/^[A-Za-z-]{2,32}$/.test(input.language)
    )) throw new TypeError('Idioma detectado inválido.');
    validateQuality(input.quality);
    validatePreview(input.previewLines);

    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.prepare(`
      INSERT INTO local_lyrics_candidates(
        id, track_id, source, content, language, provider_version, model_label,
        base_lyrics_fingerprint, quality_json, preview_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      input.id,
      input.trackId,
      input.source,
      clean,
      input.language,
      input.providerVersion,
      input.modelLabel,
      input.baseLyricsFingerprint,
      JSON.stringify(input.quality),
      JSON.stringify(input.previewLines),
      createdAt
    );
    this.prune();
    return this.get(input.id)!;
  }

  delete(id: string) {
    requireIdentifier(id, 'candidateId');
    const result = this.db.prepare('DELETE FROM local_lyrics_candidates WHERE id = ?;').run(id);
    return Number(result.changes) > 0;
  }

  private prune() {
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM local_lyrics_candidates;').get() as Row)?.count ?? 0);
    if (count <= MAX_CANDIDATES) return;
    this.db.prepare(`
      DELETE FROM local_lyrics_candidates
      WHERE id IN (
        SELECT id FROM local_lyrics_candidates
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      );
    `).run(count - MAX_CANDIDATES);
  }
}
