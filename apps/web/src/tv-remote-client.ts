import type {
  TvRemoteCommand,
  TvRemoteEvent,
  TvRemotePlaybackSnapshot,
  TvRemoteSessionSummary
} from '@home-music/shared';
import { apiFetch } from './api-client';

const sessionsPath = '/api/tv-remote/sessions';
const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-Home-Music-Request': '1'
};

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    // Keep the stable client-side fallback when the server did not return JSON.
  }
  return fallback;
}

async function expectJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await responseError(response, fallback));
  return response.json() as Promise<T>;
}

async function expectEmpty(response: Response, fallback: string): Promise<void> {
  if (!response.ok) throw new Error(await responseError(response, fallback));
}

export async function createTvRemoteSession(): Promise<TvRemoteSessionSummary> {
  const response = await apiFetch(sessionsPath, {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  return expectJson<TvRemoteSessionSummary>(response, 'Não foi possível criar o controle remoto.');
}

export async function getTvRemoteSession(sessionId: string): Promise<TvRemoteSessionSummary> {
  const response = await apiFetch(`${sessionsPath}/${encodeURIComponent(sessionId)}`);
  return expectJson<TvRemoteSessionSummary>(response, 'Controle remoto não encontrado.');
}

export async function publishTvRemoteStatus(
  sessionId: string,
  snapshot: TvRemotePlaybackSnapshot
): Promise<void> {
  const response = await apiFetch(`${sessionsPath}/${encodeURIComponent(sessionId)}/status`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify(snapshot)
  });
  await expectEmpty(response, 'Não foi possível atualizar o controle remoto.');
}

export async function sendTvRemoteCommand(sessionId: string, command: TvRemoteCommand): Promise<void> {
  const response = await apiFetch(`${sessionsPath}/${encodeURIComponent(sessionId)}/commands`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify(command)
  });
  await expectEmpty(response, 'Não foi possível enviar o comando.');
}

export async function closeTvRemoteSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`${sessionsPath}/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  await expectEmpty(response, 'Não foi possível encerrar o controle remoto.');
}

export type TvRemoteTransportStatus = 'connecting' | 'open' | 'error';

export type TvRemoteEventHandlers = {
  onCommand?: (command: TvRemoteCommand, eventId: number) => void;
  onSnapshot?: (snapshot: TvRemotePlaybackSnapshot, eventId: number) => void;
  onClosed?: (reason: Extract<TvRemoteEvent, { type: 'closed' }>['data']['reason'], eventId: number) => void;
  onTransportStatus?: (status: TvRemoteTransportStatus) => void;
  onError?: (error: unknown) => void;
};

export function openTvRemoteEvents(sessionId: string, handlers: TvRemoteEventHandlers): () => void {
  let largestProcessedId = 0;
  let stopped = false;
  handlers.onTransportStatus?.('connecting');
  const source = new EventSource(`${sessionsPath}/${encodeURIComponent(sessionId)}/events`);

  const handle = <T>(event: MessageEvent<string>, callback: (value: T, eventId: number) => void) => {
    if (stopped) return;
    const rawId = event.lastEventId;
    if (!/^\d+$/.test(rawId)) return;
    const eventId = Number(rawId);
    if (!Number.isSafeInteger(eventId) || eventId <= largestProcessedId) return;
    try {
      const value = JSON.parse(event.data) as T;
      largestProcessedId = eventId;
      callback(value, eventId);
    } catch (error) {
      handlers.onError?.(error);
    }
  };

  source.onopen = () => handlers.onTransportStatus?.('open');
  source.onerror = () => handlers.onTransportStatus?.('error');
  source.addEventListener('command', event => {
    handle<TvRemoteCommand>(event as MessageEvent<string>, (command, eventId) => {
      handlers.onCommand?.(command, eventId);
    });
  });
  source.addEventListener('snapshot', event => {
    handle<TvRemotePlaybackSnapshot>(event as MessageEvent<string>, (snapshot, eventId) => {
      handlers.onSnapshot?.(snapshot, eventId);
    });
  });
  source.addEventListener('closed', event => {
    handle<Extract<TvRemoteEvent, { type: 'closed' }>['data']>(
      event as MessageEvent<string>,
      (data, eventId) => {
        handlers.onClosed?.(data.reason, eventId);
        stopped = true;
        source.close();
      }
    );
  });

  return () => {
    if (stopped) return;
    stopped = true;
    source.close();
  };
}
