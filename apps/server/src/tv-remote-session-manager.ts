import { randomUUID } from 'node:crypto';
import type {
  TvRemoteCommand,
  TvRemoteEvent,
  TvRemotePlaybackSnapshot,
  TvRemoteSessionSummary
} from '@home-music/shared';

const SESSION_TTL_MS = 60_000;
const MAX_SESSIONS_PER_USER = 3;
const EVENT_BUFFER_SIZE = 32;
const CLEANUP_INTERVAL_MS = 15_000;

type EventListener = (event: TvRemoteEvent) => void;
type PendingEvent =
  | { type: 'command'; data: TvRemoteCommand }
  | { type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { type: 'closed'; data: { reason: 'closed' | 'expired' } };
type SetIntervalFunction = (callback: () => void, intervalMs: number) => unknown;
type ClearIntervalFunction = (timer: unknown) => void;

export type TvRemoteSessionManagerOptions = {
  now?: () => number;
  randomId?: () => string;
  setInterval?: SetIntervalFunction;
  clearInterval?: ClearIntervalFunction;
};

type Session = {
  id: string;
  ownerId: string;
  lastTvHeartbeatAt: number;
  snapshot: TvRemotePlaybackSnapshot | null;
  nextEventId: number;
  events: TvRemoteEvent[];
  listeners: Set<EventListener>;
};

function defaultSetInterval(callback: () => void, intervalMs: number) {
  return setInterval(callback, intervalMs);
}

function defaultClearInterval(timer: unknown) {
  clearInterval(timer as ReturnType<typeof setInterval>);
}

function unrefTimer(timer: unknown) {
  if (!timer || typeof timer !== 'object' || !('unref' in timer)) return;
  const unref = (timer as { unref?: unknown }).unref;
  if (typeof unref === 'function') unref.call(timer);
}

export class TvRemoteSessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly clearInterval: ClearIntervalFunction;
  private timer: unknown | null;

  constructor(options: TvRemoteSessionManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? randomUUID;
    this.clearInterval = options.clearInterval ?? defaultClearInterval;
    this.timer = (options.setInterval ?? defaultSetInterval)(
      () => this.expireSessions(),
      CLEANUP_INTERVAL_MS
    );
    unrefTimer(this.timer);
  }

  create(ownerId: string): TvRemoteSessionSummary {
    this.expireSessions();
    const oldest = [...this.sessions.values()].find(session => session.ownerId === ownerId);
    const ownedCount = [...this.sessions.values()].filter(session => session.ownerId === ownerId).length;
    if (ownedCount >= MAX_SESSIONS_PER_USER && oldest) this.remove(oldest, 'closed');

    const session: Session = {
      id: this.randomId(),
      ownerId,
      lastTvHeartbeatAt: this.now(),
      snapshot: null,
      nextEventId: 1,
      events: [],
      listeners: new Set()
    };
    this.sessions.set(session.id, session);
    return this.summary(session);
  }

  get(ownerId: string, sessionId: string): TvRemoteSessionSummary | null {
    const session = this.resolve(ownerId, sessionId);
    return session ? this.summary(session) : null;
  }

  publishCommand(ownerId: string, sessionId: string, command: TvRemoteCommand) {
    const session = this.resolve(ownerId, sessionId);
    if (!session) return false;
    this.publish(session, { type: 'command', data: command });
    return true;
  }

  publishSnapshot(ownerId: string, sessionId: string, snapshot: TvRemotePlaybackSnapshot) {
    const session = this.resolve(ownerId, sessionId);
    if (!session) return false;
    session.lastTvHeartbeatAt = this.now();
    session.snapshot = snapshot;
    this.publish(session, { type: 'snapshot', data: snapshot });
    return true;
  }

  eventsAfter(ownerId: string, sessionId: string, lastEventId: number) {
    const session = this.resolve(ownerId, sessionId);
    if (!session) return null;
    return session.events.filter(event => event.id > lastEventId);
  }

  subscribe(ownerId: string, sessionId: string, listener: EventListener): (() => void) | null {
    const session = this.resolve(ownerId, sessionId);
    if (!session) return null;
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  close(ownerId: string, sessionId: string) {
    const session = this.resolve(ownerId, sessionId);
    if (!session) return false;
    this.remove(session, 'closed');
    return true;
  }

  shutdown() {
    if (this.timer !== null) {
      this.clearInterval(this.timer);
      this.timer = null;
    }
    for (const session of [...this.sessions.values()]) this.remove(session, 'closed');
  }

  private summary(session: Session): TvRemoteSessionSummary {
    return {
      id: session.id,
      expiresAt: new Date(session.lastTvHeartbeatAt + SESSION_TTL_MS).toISOString(),
      snapshot: session.snapshot
    };
  }

  private resolve(ownerId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) return null;
    if (session.lastTvHeartbeatAt + SESSION_TTL_MS <= this.now()) {
      this.remove(session, 'expired');
      return null;
    }
    return session;
  }

  private expireSessions() {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.lastTvHeartbeatAt + SESSION_TTL_MS <= now) this.remove(session, 'expired');
    }
  }

  private publish(session: Session, event: PendingEvent) {
    let published: TvRemoteEvent;
    if (event.type === 'command') {
      published = { id: session.nextEventId, type: event.type, data: event.data };
    } else if (event.type === 'snapshot') {
      published = { id: session.nextEventId, type: event.type, data: event.data };
    } else {
      published = { id: session.nextEventId, type: event.type, data: event.data };
    }
    session.nextEventId += 1;
    session.events.push(published);
    if (session.events.length > EVENT_BUFFER_SIZE) session.events.shift();
    for (const listener of [...session.listeners]) {
      try {
        listener(published);
      } catch {
        session.listeners.delete(listener);
      }
    }
  }

  private remove(session: Session, reason: 'closed' | 'expired') {
    this.publish(session, { type: 'closed', data: { reason } });
    session.listeners.clear();
    this.sessions.delete(session.id);
  }
}
