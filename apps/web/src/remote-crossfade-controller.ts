import {
  hasTvRemoteCrossfadePair,
  type TvRemotePlaybackSnapshot
} from '@home-music/shared/tv-remote';

export type RemoteCrossfadeState = {
  pending: number | null;
  message: string | null;
};

type Intent = {
  seconds: number;
  id?: number;
  controller: AbortController;
  timer: number;
};

type RemoteCrossfadeControllerOptions = {
  send: (sessionId: string, seconds: number, signal: AbortSignal) => Promise<number>;
  setTimer: (callback: () => void, milliseconds: number) => number;
  clearTimer: (timer: number) => void;
  onState: (state: RemoteCrossfadeState) => void;
};

export function crossfadeConfirmation(
  snapshot: TvRemotePlaybackSnapshot | null,
  id: number,
  seconds: number
): string | null {
  if (!snapshot || !hasTvRemoteCrossfadePair(snapshot) || snapshot.lastAppliedCrossfadeCommandId < id) return null;
  if (snapshot.lastAppliedCrossfadeCommandId > id) return 'Outra alteração de Crossfade prevaleceu. Confira o valor atual.';
  return snapshot.crossfadeSeconds === seconds
    ? `Crossfade: ${seconds} s`
    : 'O valor do Crossfade já foi alterado. Confira o valor atual.';
}

export function createRemoteCrossfadeController(
  sessionId: string,
  options: RemoteCrossfadeControllerOptions
) {
  let latest: TvRemotePlaybackSnapshot | null = null;
  let enabled = false;
  let intent: Intent | null = null;
  let disposed = false;

  const finish = (message: string | null) => {
    const active = intent;
    intent = null;
    if (active) {
      options.clearTimer(active.timer);
      active.controller.abort();
    }
    if (!disposed) options.onState({ pending: null, message });
  };

  const reconcile = () => {
    if (!intent || intent.id === undefined) return;
    const result = crossfadeConfirmation(latest, intent.id, intent.seconds);
    if (result) finish(result);
  };

  return {
    update(snapshot: TvRemotePlaybackSnapshot | null, nextEnabled: boolean) {
      if (disposed) return;
      latest = snapshot;
      enabled = nextEnabled;
      if (!enabled) {
        finish(null);
        return;
      }
      reconcile();
    },

    async choose(seconds: number) {
      if (disposed || !enabled || intent || latest?.crossfadeSeconds === seconds) return;
      const active: Intent = {
        seconds,
        controller: new AbortController(),
        timer: 0
      };
      intent = active;
      active.timer = options.setTimer(() => {
        if (intent === active) finish('A TV não confirmou a alteração. Confira o valor e tente novamente.');
      }, 10_000);
      options.onState({ pending: seconds, message: null });

      try {
        const id = await options.send(sessionId, seconds, active.controller.signal);
        if (disposed || intent !== active) return;
        active.id = id;
        reconcile();
      } catch {
        if (!disposed && intent === active) finish('Não foi possível alterar o Crossfade. Tente novamente.');
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      const active = intent;
      intent = null;
      if (active) {
        options.clearTimer(active.timer);
        active.controller.abort();
      }
    }
  };
}
