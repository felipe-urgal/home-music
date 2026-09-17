import { describe, expect, it } from 'vitest';
import { isIosTvLanPlatform, selectTvLanTransport } from './tv-lan-transport-selection';

describe('TV LAN transport selection', () => {
  it('selects the bridge for iPhone/iPad user agents', () => {
    expect(selectTvLanTransport({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })).toBe('bridge');
  });

  it('recognizes iPadOS desktop-style platform by touch capability', () => {
    expect(isIosTvLanPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it('keeps the direct transport for Android and desktop browsers', () => {
    expect(selectTvLanTransport({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    })).toBe('direct');
    expect(selectTvLanTransport({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    })).toBe('direct');
  });
});
