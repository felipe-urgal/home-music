import type { TvRemoteSignal } from '@home-music/shared/tv-remote';
import {
  openTvRemoteEvents,
  sendTvRemoteSignal,
  type TvRemoteEventHandlers
} from './tv-remote-client';

export type TvRemoteSessionTransport = {
  mode: 'server' | 'lan';
  sendSignal: (signal: TvRemoteSignal) => Promise<void>;
  subscribeSignals: (
    listener: (signal: TvRemoteSignal) => void | Promise<void>,
    onError?: (error: Error) => void,
    onReady?: () => void,
    onClosed?: () => void
  ) => () => void;
  close: () => void;
};

export type ServerTvRemoteSessionTransport = TvRemoteSessionTransport & {
  subscribeEvents: (handlers: TvRemoteEventHandlers) => () => void;
};

type ServerDependencies = {
  sendSignal?: typeof sendTvRemoteSignal;
  openEvents?: typeof openTvRemoteEvents;
};

type LanSignaling = {
  sendSignal: (signal: TvRemoteSignal) => Promise<void>;
  start: (
    listener: (signal: TvRemoteSignal) => void | Promise<void>,
    onError?: (error: Error) => void
  ) => void;
  close: () => void;
};

export function createServerTvRemoteSessionTransport(
  sessionId: string,
  dependencies: ServerDependencies = {}
): ServerTvRemoteSessionTransport {
  const publishSignal = dependencies.sendSignal ?? sendTvRemoteSignal;
  const subscribeEvents = dependencies.openEvents ?? openTvRemoteEvents;
  const subscriptions = new Set<() => void>();
  let closed = false;

  const subscribe = (handlers: TvRemoteEventHandlers) => {
    if (closed) return () => undefined;
    const stop = subscribeEvents(sessionId, handlers);
    subscriptions.add(stop);
    return () => {
      subscriptions.delete(stop);
      stop();
    };
  };

  return {
    mode: 'server',
    sendSignal: signal => {
      if (closed) return Promise.reject(new Error('A sessão remota foi encerrada.'));
      return publishSignal(sessionId, signal);
    },
    subscribeSignals: (listener, onError, onReady, onClosed) => {
      if (closed) return () => undefined;
      const handlers: TvRemoteEventHandlers = {
        onReady,
        onClosed,
        onSignal: signal => {
          void Promise.resolve(listener(signal)).catch(error => {
            onError?.(error instanceof Error ? error : new Error('Falha ao processar sinal remoto.'));
          });
        },
        onError: error => onError?.(error instanceof Error ? error : new Error('Evento remoto inválido.'))
      };
      return subscribe(handlers);
    },
    subscribeEvents: subscribe,
    close: () => {
      if (closed) return;
      closed = true;
      for (const stop of subscriptions) stop();
      subscriptions.clear();
    }
  };
}

export function wrapLanTvRemoteSessionTransport(signaling: LanSignaling): TvRemoteSessionTransport {
  let closed = false;
  let subscribed = false;
  return {
    mode: 'lan',
    sendSignal: signal => {
      if (closed) return Promise.reject(new Error('A sessão LAN foi encerrada.'));
      return signaling.sendSignal(signal);
    },
    subscribeSignals: (listener, onError, onReady) => {
      if (closed || subscribed) return () => undefined;
      subscribed = true;
      onReady?.();
      signaling.start(listener, onError);
      return () => { subscribed = false; };
    },
    close: () => {
      if (closed) return;
      closed = true;
      signaling.close();
    }
  };
}
