import './tv-now-playing-equalizer.css';

export const TV_REMOTE_TRACK_REQUEST_EVENT = 'home-music:tv-remote-track-request';

type TvRemoteTrackRequestDetail = {
  trackId: string;
};

export function requestTvRemoteTrack(trackId: string) {
  window.dispatchEvent(new CustomEvent<TvRemoteTrackRequestDetail>(TV_REMOTE_TRACK_REQUEST_EVENT, {
    detail: { trackId }
  }));
}

export function subscribeToTvRemoteTrackRequests(onTrackId: (trackId: string) => void) {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<TvRemoteTrackRequestDetail>;
    const trackId = customEvent.detail?.trackId;
    if (typeof trackId === 'string' && trackId) onTrackId(trackId);
  };
  window.addEventListener(TV_REMOTE_TRACK_REQUEST_EVENT, listener);
  return () => window.removeEventListener(TV_REMOTE_TRACK_REQUEST_EVENT, listener);
}
