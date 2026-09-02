import { apiFetch } from './api-client';

const CAPABILITY_REQUEST = 'HOME_MUSIC_GET_CAPABILITIES';
const CAPABILITY_RESPONSE = 'HOME_MUSIC_CAPABILITIES';
const BACKGROUND_FETCH_CAPABILITY_VERSION = 4;
const BACKGROUND_FETCH_REGISTRATION_PREFIX = 'home-music-offline-v1:';
const OFFLINE_AUDIO_CACHE_PREFIX = 'home-music-offline-audio-v2-';

export type OfflineTrackTransfer = {
  response: Response;
  storedByServiceWorker: boolean;
};

type BackgroundFetchRegistrationLike = EventTarget & {
  id: string;
  result: '' | 'success' | 'failure' | string;
  failureReason: string;
};

type BackgroundFetchManagerLike = {
  fetch: (
    id: string,
    requests: RequestInfo | RequestInfo[],
    options?: { title?: string }
  ) => Promise<BackgroundFetchRegistrationLike>;
  get: (id: string) => Promise<BackgroundFetchRegistrationLike | undefined>;
};

type ServiceWorkerRegistrationWithBackgroundFetch = ServiceWorkerRegistration & {
  backgroundFetch?: BackgroundFetchManagerLike;
};

function offlineAudioCacheName(userId: string) {
  return `${OFFLINE_AUDIO_CACHE_PREFIX}${encodeURIComponent(userId)}`;
}

export function backgroundFetchRegistrationId(userId: string, trackId: string) {
  return `${BACKGROUND_FETCH_REGISTRATION_PREFIX}${userId}:${trackId}`;
}

export function backgroundFetchFailureMessage(reason: string) {
  switch (reason) {
    case 'aborted':
      return 'O download em segundo plano foi cancelado.';
    case 'bad-status':
      return 'O servidor não conseguiu entregar a música para o download em segundo plano.';
    case 'fetch-error':
      return 'A conexão falhou durante o download em segundo plano.';
    case 'quota-exceeded':
      return 'O armazenamento do navegador está cheio. Remova algum download offline e tente novamente.';
    case 'download-total-exceeded':
      return 'O navegador interrompeu o download porque o tamanho esperado foi excedido.';
    default:
      return 'Não foi possível concluir o download em segundo plano.';
  }
}

export function supportsBackgroundFetchCapability(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const data = value as {
    type?: unknown;
    version?: unknown;
    offlineAudio?: unknown;
    backgroundFetch?: unknown;
  };
  return Boolean(
    data.type === CAPABILITY_RESPONSE &&
    Number(data.version) >= BACKGROUND_FETCH_CAPABILITY_VERSION &&
    data.offlineAudio === true &&
    data.backgroundFetch === true
  );
}

export function isAndroidBackgroundFetchRuntime(userAgent: string) {
  return /\bAndroid\b/i.test(userAgent);
}

function browserCanProbeBackgroundFetch() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'caches' in window &&
    isAndroidBackgroundFetchRuntime(navigator.userAgent)
  );
}

async function activeWorkerSupportsBackgroundFetch(userId: string) {
  if (!browserCanProbeBackgroundFetch()) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller || typeof MessageChannel === 'undefined') return false;

  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 800);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout);
      resolve(supportsBackgroundFetchCapability(event.data));
    };

    try {
      controller.postMessage({ type: CAPABILITY_REQUEST, userId }, [channel.port2]);
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
}

async function backgroundFetchManager(userId: string) {
  if (!await activeWorkerSupportsBackgroundFetch(userId)) return null;
  try {
    const registration = await navigator.serviceWorker.ready as ServiceWorkerRegistrationWithBackgroundFetch;
    const manager = registration.backgroundFetch;
    if (!manager || typeof manager.fetch !== 'function' || typeof manager.get !== 'function') return null;
    return manager;
  } catch {
    return null;
  }
}

function waitForBackgroundFetch(registration: BackgroundFetchRegistrationLike) {
  if (registration.result) return Promise.resolve(registration);

  return new Promise<BackgroundFetchRegistrationLike>(resolve => {
    const check = () => {
      if (!registration.result) return;
      window.clearInterval(interval);
      registration.removeEventListener('progress', check);
      resolve(registration);
    };
    const interval = window.setInterval(check, 500);
    registration.addEventListener('progress', check);
    check();
  });
}

async function waitForCachedResponse(userId: string, url: string) {
  const cache = await caches.open(offlineAudioCacheName(userId));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await cache.match(url);
    if (response) return response;
    await new Promise(resolve => window.setTimeout(resolve, 250));
  }
  return undefined;
}

function shouldFallbackToForeground(error: unknown) {
  if (!(error instanceof DOMException)) return true;
  return error.name === 'NotAllowedError' || error.name === 'TypeError' || error.name === 'InvalidStateError';
}

async function startOrReuseBackgroundFetch(
  manager: BackgroundFetchManagerLike,
  registrationId: string,
  url: string
) {
  const existing = await manager.get(registrationId);
  if (existing) return existing;

  try {
    return await manager.fetch(
      registrationId,
      new Request(url, { credentials: 'same-origin', cache: 'no-store' }),
      { title: 'Home Music: download offline' }
    );
  } catch (error) {
    const raced = await manager.get(registrationId).catch(() => undefined);
    if (raced) return raced;
    throw error;
  }
}

export async function fetchOfflineTrackResponse(
  trackId: string,
  userId: string,
  url: string
): Promise<OfflineTrackTransfer> {
  const manager = await backgroundFetchManager(userId);
  if (!manager) {
    return { response: await apiFetch(url, { cache: 'no-store' }), storedByServiceWorker: false };
  }

  let registration: BackgroundFetchRegistrationLike;
  try {
    registration = await startOrReuseBackgroundFetch(
      manager,
      backgroundFetchRegistrationId(userId, trackId),
      url
    );
  } catch (error) {
    if (shouldFallbackToForeground(error)) {
      return { response: await apiFetch(url, { cache: 'no-store' }), storedByServiceWorker: false };
    }
    throw error;
  }

  const settled = await waitForBackgroundFetch(registration);
  if (settled.result !== 'success') {
    throw new Error(backgroundFetchFailureMessage(settled.failureReason));
  }

  const response = await waitForCachedResponse(userId, url);
  if (!response) {
    throw new Error('O download terminou, mas o arquivo não pôde ser confirmado no armazenamento offline.');
  }

  return { response, storedByServiceWorker: true };
}
