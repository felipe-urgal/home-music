import { describe, expect, it } from 'vitest';
import {
  DJ_RECORDING_MIME_CANDIDATES,
  djRecordingExtension,
  djRecordingFilename,
  selectDjRecordingMimeType
} from './dj-recording';

describe('DJ recording', () => {
  it('prefere Opus/WebM quando suportado', () => {
    const supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
    expect(selectDjRecordingMimeType({
      isTypeSupported: mimeType => supported.has(mimeType)
    })).toBe('audio/webm;codecs=opus');
  });

  it('degrada quando nenhum MIME conhecido é suportado', () => {
    expect(selectDjRecordingMimeType({
      isTypeSupported: () => false
    })).toBeNull();
    expect(selectDjRecordingMimeType(undefined)).toBeNull();
  });

  it('aceita construtor sem feature detection de MIME', () => {
    expect(selectDjRecordingMimeType({})).toBe('');
  });

  it('gera nome previsível com extensão coerente', () => {
    const date = new Date(2026, 8, 29, 16, 7, 5);
    expect(djRecordingFilename(date, 'audio/webm;codecs=opus'))
      .toBe('home-music-dj-20260929-160705.webm');
    expect(djRecordingFilename(date, 'audio/ogg;codecs=opus'))
      .toBe('home-music-dj-20260929-160705.ogg');
    expect(djRecordingFilename(date, 'audio/mp4'))
      .toBe('home-music-dj-20260929-160705.m4a');
    expect(DJ_RECORDING_MIME_CANDIDATES.length).toBeGreaterThan(1);
    expect(djRecordingExtension('')).toBe('webm');
  });
});
