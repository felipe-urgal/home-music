import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

function webSource(name: string) {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

describe('PlayerScreen responsibility boundaries', () => {
  it('mantém PlayerScreen como orquestrador sem estado de reprodução local', () => {
    const screen = componentSource('PlayerScreen.tsx');

    for (const component of [
      'PlayerTrackPresentation',
      'PlayerPlaybackControls',
      'LyricsPanel',
      'PlayerQueuePanel'
    ]) {
      expect(screen).toMatch(new RegExp(`<${component}\\b`));
    }

    expect(screen).not.toMatch(/useState\s*\(/);
    expect(screen).not.toMatch(/useRef\s*\(/);
    expect(screen).not.toMatch(/useEffect\s*\(/);
  });

  it('mantém playback canônico em useAudioPlayer', () => {
    const player = webSource('useAudioPlayer.ts');

    expect(player).toMatch(/const \[queue, setQueue\] = useState/);
    expect(player).toMatch(/const \[playing, setPlaying\] = useState/);
    expect(player).toMatch(/const \[currentTime, setCurrentTime\] = useState/);
    expect(player).toMatch(/const \[shuffle, setShuffle\] = useState/);
    expect(player).toMatch(/const \[repeatMode, setRepeatMode\] = useState/);
  });

  it('isola estado visual de fila em PlayerQueuePanel', () => {
    const queue = componentSource('PlayerQueuePanel.tsx');

    expect(queue).toMatch(/const \[showQueue, setShowQueue\] = useState/);
    expect(queue).toMatch(/const \[dragFrom, setDragFrom\] = useState/);
    expect(queue).toMatch(/const \[visibleQueueCount, setVisibleQueueCount\] = useState/);
    expect(queue).not.toMatch(/setPlaying/);
    expect(queue).not.toMatch(/setShuffle/);
    expect(queue).not.toMatch(/setRepeatMode/);
  });
});
