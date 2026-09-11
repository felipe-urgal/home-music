const adoptedTrackByAudio = new WeakMap<HTMLAudioElement, string>();

export function markAdoptedAudioTrack(audio: HTMLAudioElement, trackId: string) {
  adoptedTrackByAudio.set(audio, trackId);
}

export function consumeAdoptedAudioTrack(audio: HTMLAudioElement, trackId: string) {
  if (adoptedTrackByAudio.get(audio) !== trackId) return false;
  adoptedTrackByAudio.delete(audio);
  return true;
}
