import type { TvLanQrPayload } from '@home-music/shared/tv-lan-remote';

export type TvLanTransportResponse = {
  status: number;
  body: unknown;
};

export type TvLanTransport = {
  challenge: (input: { sessionId: string; clientNonce: string }) => Promise<TvLanTransportResponse>;
  join: (input: {
    sessionId: string;
    clientNonce: string;
    tvNonce: string;
    expiresAt: number;
    proof: string;
  }) => Promise<TvLanTransportResponse>;
  signalSend: (input: { authorization: string; body: string }) => Promise<TvLanTransportResponse>;
  signalPoll: (input: { authorization: string; cursor: number }) => Promise<TvLanTransportResponse>;
  close: (input: { authorization: string }) => Promise<TvLanTransportResponse>;
  finish?: () => void;
  dispose: () => void;
};

export type TvLanTransportFactory = (
  pairing: TvLanQrPayload,
  options: { signal: AbortSignal; requestTimeoutMs: number }
) => Promise<TvLanTransport>;
