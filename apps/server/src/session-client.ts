/**
 * Persist only coarse allow-listed categories derived on the server.
 * Never store raw User-Agent, IP, device identifiers or browser versions.
 * This is display-only metadata, never an authentication input.
 */
export function describeSessionClient(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string' || !userAgent || userAgent.length > 1024) return null;
  const ua = userAgent;
  const platform = /android/i.test(ua) ? 'Android'
    : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
      : /windows/i.test(ua) ? 'Windows'
        : /macintosh|mac os x/i.test(ua) ? 'macOS'
          : /linux/i.test(ua) ? 'Linux'
            : null;
  const browser = /edg(?:e|ios|a)?\//i.test(ua) ? 'Edge'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
      : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
        : /crios|chrome|chromium/i.test(ua) ? 'Chrome'
          : /safari/i.test(ua) ? 'Safari'
            : null;
  if (/smart-tv|tizen|webos|android tv|crkey/i.test(ua)) {
    return platform ? `TV · ${platform}` : 'TV';
  }
  if (!browser && !platform) return null;
  return [browser ?? 'Navegador', platform].filter(Boolean).join(' · ');
}
