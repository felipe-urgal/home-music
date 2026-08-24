import { useEffect, useState } from 'react';

const SYSTEM_VOLUME_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';

function isIOSLike() {
  if (typeof navigator === 'undefined') return false;

  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function prefersSystemVolume() {
  if (typeof window === 'undefined') return false;

  const coarsePointer = typeof window.matchMedia === 'function' &&
    window.matchMedia(SYSTEM_VOLUME_MEDIA_QUERY).matches;

  return coarsePointer || isIOSLike();
}

export function useSystemVolumePreference() {
  const [usesSystemVolume, setUsesSystemVolume] = useState(prefersSystemVolume);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia(SYSTEM_VOLUME_MEDIA_QUERY);
    const update = () => setUsesSystemVolume(media.matches || isIOSLike());

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return usesSystemVolume;
}
