export type TvLanTransportKind = 'direct' | 'bridge';

type TvLanPlatformInfo = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

function currentPlatformInfo(): TvLanPlatformInfo {
  if (typeof navigator === 'undefined') {
    return { userAgent: '', platform: '', maxTouchPoints: 0 };
  }
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

export function isIosTvLanPlatform(info: TvLanPlatformInfo = currentPlatformInfo()) {
  if (/iPad|iPhone|iPod/i.test(info.userAgent)) return true;
  return info.platform === 'MacIntel' && info.maxTouchPoints > 1;
}

export function selectTvLanTransport(info: TvLanPlatformInfo = currentPlatformInfo()): TvLanTransportKind {
  return isIosTvLanPlatform(info) ? 'bridge' : 'direct';
}
