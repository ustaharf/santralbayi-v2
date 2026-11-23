const DEFAULT_VDS_HOST = '178.208.187.42';
const DEFAULT_VDS_WEB_ORIGIN = `http://${DEFAULT_VDS_HOST}:3000`;

function readActiveLiveOrigin(): string {
  try {
    if (typeof window !== 'undefined') {
      const bridge = (
        window as unknown as {
          AndroidBridge?: { getLiveServerOrigin?: () => string };
        }
      ).AndroidBridge;
      const fromNative = bridge?.getLiveServerOrigin?.()?.trim() || '';
      if (/^https?:\/\/[^/\s]+/i.test(fromNative)) {
        return fromNative.replace(/\/+$/, '');
      }
      const fromLs = window.localStorage.getItem('sb_live_origin_v1')?.trim() || '';
      if (/^https?:\/\/[^/\s]+/i.test(fromLs)) {
        return fromLs.replace(/\/+$/, '');
      }
    }
  } catch {}
  return DEFAULT_VDS_WEB_ORIGIN;
}

export const VDS_WEB_ORIGIN = readActiveLiveOrigin();
export const VDS_HOST = (() => {
  try {
    return new URL(VDS_WEB_ORIGIN).hostname || DEFAULT_VDS_HOST;
  } catch {
    return DEFAULT_VDS_HOST;
  }
})();
export const VDS_PBX_API_ORIGIN = `http://${DEFAULT_VDS_HOST}:8000`;

export function setActiveLiveOrigin(newOrigin: string): boolean {
  try {
    const clean = String(newOrigin || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+/i.test(clean)) return false;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('sb_live_origin_v1', clean);
      const bridge = (
        window as unknown as {
          AndroidBridge?: { setLiveServerOrigin?: (origin: string) => boolean };
        }
      ).AndroidBridge;
      bridge?.setLiveServerOrigin?.(clean);
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveServerApiUrl(path: string): string {
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    const p = window.location.port;
    if ((h === 'localhost' || h === '127.0.0.1') && (!p || p === '80' || p === '443')) {
      return `${readActiveLiveOrigin()}${path}`;
    }
  }
  return path;
}
