import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TvRemotePlaybackSnapshot } from '@home-music/shared';
import {
  closeTvRemoteSession,
  createTvRemoteSession,
  getTvRemoteSession,
  openTvRemoteEvents,
  publishTvRemoteStatus,
  sendTvRemoteCommand
} from './tv-remote-client';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function'
      ? listener as (event: MessageEvent<string>) => void
      : (event: MessageEvent<string>) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown, lastEventId: string) {
    const event = { data: JSON.stringify(data), lastEventId } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const snapshot: TvRemotePlaybackSnapshot = {
  trackId: 'track-1',
  title: 'Faixa',
  artist: 'Artista',
  playing: true,
  currentTime: 12,
  duration: 120,
  updatedAt: '2026-09-12T18:00:00.000Z'
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tv remote HTTP client', () => {
  it('usa cookies same-origin e proteção anti-CSRF em todas as mutações', async () => {
    const session = { id: 'a/b', expiresAt: '2026-09-12T18:15:00.000Z', snapshot: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createTvRemoteSession()).resolves.toEqual(session);
    await expect(getTvRemoteSession('a/b')).resolves.toEqual(session);
    await publishTvRemoteStatus('a/b', snapshot);
    await sendTvRemoteCommand('a/b', { type: 'seek', deltaSeconds: 10 });
    await closeTvRemoteSession('a/b');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/tv-remote/sessions', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', headers: { 'X-Home-Music-Request': '1' }
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/tv-remote/sessions/a%2Fb', expect.objectContaining({
      credentials: 'same-origin'
    }));
    for (const index of [3, 4, 5]) {
      expect(fetchMock.mock.calls[index - 1]?.[1]?.headers).toEqual(expect.objectContaining({
        'X-Home-Music-Request': '1'
      }));
    }
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/tv-remote/sessions/a%2Fb', expect.objectContaining({
      method: 'DELETE', credentials: 'same-origin', keepalive: true
    }));
  });

  it('propaga a mensagem estável do servidor em falhas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Controle remoto não encontrado.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    )));

    await expect(getTvRemoteSession('missing')).rejects.toThrow('Controle remoto não encontrado.');
  });
});

describe('tv remote SSE client', () => {
  it('entrega eventos tipados, ignora replay e fecha ao receber closed', () => {
    const commands: string[] = [];
    const snapshots: string[] = [];
    const closed: string[] = [];
    const statuses: string[] = [];
    const stop = openTvRemoteEvents('a/b', {
      onCommand: command => commands.push(command.type),
      onSnapshot: value => snapshots.push(value.trackId ?? ''),
      onClosed: reason => closed.push(reason),
      onTransportStatus: status => statuses.push(status)
    });
    const source = FakeEventSource.instances[0]!;

    expect(source.url).toBe('/api/tv-remote/sessions/a%2Fb/events');
    expect(statuses).toEqual(['connecting']);
    source.onopen?.(new Event('open'));
    source.emit('command', { type: 'next' }, '1');
    source.emit('command', { type: 'previous' }, '1');
    source.emit('snapshot', snapshot, '2');
    source.emit('closed', { reason: 'expired' }, '3');
    source.emit('command', { type: 'previous' }, '4');

    expect(statuses).toEqual(['connecting', 'open']);
    expect(commands).toEqual(['next']);
    expect(snapshots).toEqual(['track-1']);
    expect(closed).toEqual(['expired']);
    expect(source.closed).toBe(true);
    stop();
  });

  it('reporta erro de transporte sem descartar a assinatura para reconexão nativa', () => {
    const statuses: string[] = [];
    const stop = openTvRemoteEvents('session', { onTransportStatus: status => statuses.push(status) });
    const source = FakeEventSource.instances[0]!;

    source.onerror?.(new Event('error'));
    expect(statuses).toEqual(['connecting', 'error']);
    expect(source.closed).toBe(false);

    stop();
    expect(source.closed).toBe(true);
  });
});
