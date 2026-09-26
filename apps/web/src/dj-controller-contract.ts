export type DjDeckId = 'a' | 'b';

export type DjPlaybackState = 'empty' | 'paused' | 'playing';

export type DjControllerCapabilities = {
  loadTrack: boolean;
  transport: boolean;
  cue: boolean;
  seek: boolean;
  nudge: boolean;
  tempo: boolean;
  beatSync: boolean;
  channelVolume: boolean;
  crossfader: boolean;
  libraryBrowser: boolean;
};

export type DjDeckSyncSnapshot = {
  available: boolean;
  active: boolean;
  masterDeck: DjDeckId | null;
};

export type DjDeckSnapshot = {
  trackId: string | null;
  playbackState: DjPlaybackState;
  currentTimeSeconds: number;
  durationSeconds: number;
  cuePointSeconds: number | null;
  playbackRate: number;
  bpm: number | null;
  rhythmConfidence: number | null;
  sync: DjDeckSyncSnapshot;
  channelVolume: number;
};

export type DjControllerSnapshot = {
  mode: 'inactive' | 'active';
  revision: number;
  primaryPlaybackDeck: DjDeckId | null;
  decks: Record<DjDeckId, DjDeckSnapshot>;
  mixer: {
    crossfader: number;
  };
  browser: {
    selectedTrackId: string | null;
  };
  capabilities: DjControllerCapabilities;
};

export type DjControllerCommand =
  | { type: 'deck.load'; deck: DjDeckId; trackId: string }
  | { type: 'deck.play'; deck: DjDeckId }
  | { type: 'deck.pause'; deck: DjDeckId }
  | { type: 'deck.toggle-play'; deck: DjDeckId }
  | { type: 'deck.set-cue'; deck: DjDeckId }
  | { type: 'deck.return-to-cue'; deck: DjDeckId }
  | { type: 'deck.seek'; deck: DjDeckId; seconds: number }
  | { type: 'deck.nudge'; deck: DjDeckId; delta: number }
  | { type: 'deck.set-tempo'; deck: DjDeckId; playbackRate: number }
  | { type: 'deck.sync'; deck: DjDeckId; masterDeck?: DjDeckId }
  | { type: 'mixer.set-channel-volume'; deck: DjDeckId; value: number }
  | { type: 'mixer.set-crossfader'; value: number }
  | { type: 'browser.move'; delta: number }
  | { type: 'browser.select' }
  | { type: 'browser.load'; deck: DjDeckId };

export const DJ_CONTROLLER_MVP_CAPABILITIES: DjControllerCapabilities = {
  loadTrack: true,
  transport: true,
  cue: true,
  seek: true,
  nudge: true,
  tempo: true,
  beatSync: true,
  channelVolume: true,
  crossfader: true,
  libraryBrowser: true
};

function isDeckId(value: unknown): value is DjDeckId {
  return value === 'a' || value === 'b';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDjControllerCommand(value: unknown): value is DjControllerCommand {
  if (!isObject(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'deck.load':
      return isDeckId(value.deck)
        && typeof value.trackId === 'string'
        && value.trackId.trim().length > 0;
    case 'deck.play':
    case 'deck.pause':
    case 'deck.toggle-play':
    case 'deck.set-cue':
    case 'deck.return-to-cue':
      return isDeckId(value.deck);
    case 'deck.seek':
      return isDeckId(value.deck)
        && isFiniteNumber(value.seconds)
        && value.seconds >= 0;
    case 'deck.nudge':
      return isDeckId(value.deck)
        && isFiniteNumber(value.delta)
        && value.delta !== 0;
    case 'deck.set-tempo':
      return isDeckId(value.deck)
        && isFiniteNumber(value.playbackRate)
        && value.playbackRate > 0;
    case 'deck.sync':
      return isDeckId(value.deck)
        && (value.masterDeck === undefined || isDeckId(value.masterDeck))
        && value.masterDeck !== value.deck;
    case 'mixer.set-channel-volume':
      return isDeckId(value.deck)
        && isFiniteNumber(value.value)
        && value.value >= 0
        && value.value <= 1;
    case 'mixer.set-crossfader':
      return isFiniteNumber(value.value)
        && value.value >= -1
        && value.value <= 1;
    case 'browser.move':
      return Number.isInteger(value.delta) && value.delta !== 0;
    case 'browser.select':
      return true;
    case 'browser.load':
      return isDeckId(value.deck);
    default:
      return false;
  }
}

export function createEmptyDjControllerSnapshot(
  capabilities: DjControllerCapabilities = DJ_CONTROLLER_MVP_CAPABILITIES
): DjControllerSnapshot {
  const emptyDeck = (): DjDeckSnapshot => ({
    trackId: null,
    playbackState: 'empty',
    currentTimeSeconds: 0,
    durationSeconds: 0,
    cuePointSeconds: null,
    playbackRate: 1,
    bpm: null,
    rhythmConfidence: null,
    sync: {
      available: false,
      active: false,
      masterDeck: null
    },
    channelVolume: 1
  });

  return {
    mode: 'inactive',
    revision: 0,
    primaryPlaybackDeck: null,
    decks: {
      a: emptyDeck(),
      b: emptyDeck()
    },
    mixer: {
      crossfader: 0
    },
    browser: {
      selectedTrackId: null
    },
    capabilities: { ...capabilities }
  };
}
