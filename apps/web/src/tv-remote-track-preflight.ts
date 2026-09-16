type TvRemoteTrackPreflight = (trackId: string) => Promise<void>;

type Registration = {
  token: symbol;
  prepare: TvRemoteTrackPreflight;
};

const registrations = new Map<string, Registration>();

export function registerTvRemoteTrackPreflight(sessionId: string, prepare: TvRemoteTrackPreflight) {
  const token = Symbol(sessionId);
  registrations.set(sessionId, { token, prepare });
  return () => {
    if (registrations.get(sessionId)?.token === token) registrations.delete(sessionId);
  };
}

export async function prepareTvRemoteTrack(sessionId: string, trackId: string) {
  await registrations.get(sessionId)?.prepare(trackId);
}
