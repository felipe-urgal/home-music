import assert from 'node:assert/strict';
import test from 'node:test';
import { selectYtDlpAudioFormat } from './yt-dlp-provider.js';

test('yt-dlp escolhe o maior bitrate audio-only quando não há lossless', () => {
  const selected = selectYtDlpAudioFormat({
    formats: [
      { format_id: 'muxed-512', acodec: 'aac', vcodec: 'h264', ext: 'mp4', abr: 512, asr: 48000, audio_channels: 2 },
      { format_id: 'audio-128', acodec: 'aac', vcodec: 'none', ext: 'm4a', abr: 128, asr: 44100, audio_channels: 2 },
      { format_id: 'audio-256', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 256, asr: 48000, audio_channels: 2 },
      { format_id: 'audio-320', acodec: 'aac', vcodec: 'none', ext: 'm4a', abr: 320, asr: 48000, audio_channels: 2 }
    ]
  });

  assert.equal(selected.id, 'audio-320');
  assert.equal(selected.bitRate, 320_000);
  assert.equal(selected.audioOnly, true);
});

test('yt-dlp prefere lossless a um fluxo lossy de 320 kbps', () => {
  const selected = selectYtDlpAudioFormat({
    formats: [
      { format_id: 'audio-320', acodec: 'aac', vcodec: 'none', ext: 'm4a', abr: 320, asr: 48000, audio_channels: 2 },
      { format_id: 'lossless', acodec: 'flac', vcodec: 'none', ext: 'flac', abr: 900, asr: 48000, audio_channels: 2 }
    ]
  });

  assert.equal(selected.id, 'lossless');
  assert.equal(selected.lossless, true);
});
