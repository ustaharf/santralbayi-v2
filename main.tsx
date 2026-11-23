import { Component, ErrorInfo, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import App from './App.tsx';
import { flushMasterVaultImmediate, restoreNativeOfflineVaultMirrorSync } from './persistentVault';
import { setActiveLiveOrigin, VDS_HOST, VDS_WEB_ORIGIN } from './vdsConfig';
import './index.css';

// Eski bellek şişiren IndexedDB paket önbelleğini temizle (Android WebView RAM koruması)
try {
  if (typeof window !== 'undefined' && window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
    window.indexedDB.deleteDatabase('sb_bundle_cache_v1');
  }
} catch {}

// Küresel çalışma anı hata kalkanı (Android WebView kapanmasını engeller)
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.warn('[SantralBayi CrashShield] Yakalanan hata:', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[SantralBayi CrashShield] Yakalanan söz reddi:', event.reason);
  });
}

const isHiddenSyncFrame = (() => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top && window.location.hostname === 'localhost';
  } catch {
    return false;
  }
})();

// İnternetsiz açılışta telefon iç hafızasındaki tüm ayarları fabrika ayarına dönmeden anında geri yükle
restoreNativeOfflineVaultMirrorSync();

if (isHiddenSyncFrame && typeof window !== 'undefined') {
  window.addEventListener('message', (evt: MessageEvent) => {
    try {
      const data = evt.data as { type?: string; lsMap?: Record<string, string> };
      if (data && data.type === 'SB_MIRROR_FULL_LS' && data.lsMap && typeof data.lsMap === 'object') {
        for (const [k, v] of Object.entries(data.lsMap)) {
          if (typeof k === 'string' && typeof v === 'string') {
            window.localStorage.setItem(k, v);
          }
        }
        try {
          if (window.indexedDB && typeof window.indexedDB.deleteDatabase === 'function') {
            window.indexedDB.deleteDatabase('sb_data_vault_v1');
          }
        } catch {}
      }
    } catch {}
  });
}

// Canlı Oturum Aktarımı & İnternetsiz Telefon Hafızası Koruması
try {
  const urlObj = new URL(window.location.href);
  const incomingSession = urlObj.searchParams.get('sb_ota_session');
  if (incomingSession) {
    const decoded = decodeURIComponent(incomingSession);
    if (decoded === 'CLEAR') {
      localStorage.removeItem('sb_active_auth_session_v1');
    } else {
      localStorage.setItem('sb_active_auth_session_v1', decoded);
    }
    urlObj.searchParams.delete('sb_ota_session');
    window.history.replaceState({}, '', urlObj.toString());
  } else if (!localStorage.getItem('sb_active_auth_session_v1')) {
    const bridge = (window as unknown as { AndroidBridge?: { getOfflineSession?: () => string } }).AndroidBridge;
    const nativeSession = bridge?.getOfflineSession?.() || '';
    if (nativeSession && nativeSession.trim().startsWith('{')) {
      localStorage.setItem('sb_active_auth_session_v1', nativeSession);
    }
  }
} catch {}

interface CrashShieldProps {
  children: ReactNode;
}

interface CrashShieldState {
  hasError: boolean;
  errorText: string;
}

class GlobalCrashShield extends Component<CrashShieldProps, CrashShieldState> {
  declare props: Readonly<CrashShieldProps>;
  declare setState: Component<CrashShieldProps, CrashShieldState>['setState'];

  public state: CrashShieldState = {
    hasError: false,
    errorText: '',
  };

  constructor(props: CrashShieldProps) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): CrashShieldState {
    return {
      hasError: true,
      errorText: error?.message || 'Beklenmeyen ekran hatası',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SantralBayi GlobalCrashShield]', error, info);
  }

  private handleRecover = (): void => {
    this.setState({ hasError: false, errorText: '' });
  };

  private handleSafeReload = (): void => {
    try {
      window.location.replace(`${window.location.pathname}?v=${Date.now()}`);
    } catch {
      this.setState({ hasError: false, errorText: '' });
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-16 h-16 rounded-2xl bg-blue-700/30 border border-blue-500/40 flex items-center justify-center text-3xl mb-4">
            🛡️
          </div>
          <h1 className="text-lg font-extrabold tracking-tight text-white mb-2">
            SANTRAL <span className="text-amber-400">BAYİ</span> KORUMA KALKANI
          </h1>
          <p className="text-xs text-slate-300 max-w-xs mb-5 leading-relaxed">
            Geçici bir veri uyuşmazlığı yakalandı ve uygulamanın kapanması engellendi. Verileriniz güvende.
          </p>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={this.handleRecover}
              className="flex-1 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-lg active:scale-95 transition"
            >
              Devam Et
            </button>
            <button
              type="button"
              onClick={this.handleSafeReload}
              className="flex-1 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold text-xs active:scale-95 transition"
            >
              Ekranı Tazele
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

let loadedServerBuildTime: number | null = null;
let pendingUpdateBuildTime: number | null = null;
let isPrefetchingUpdate = false;
let isRedirectingToVds = false;
let liveUpdateEventSource: EventSource | null = null;
let liveUpdateReconnectTimer: number | null = null;

const MIN_SAME_BUILD_COOLDOWN_MS = 2500;

function isUserTypingOrListening(): boolean {
  if (typeof document === 'undefined') return false;
  const activeEl = document.activeElement;
  if (
    activeEl &&
    (activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      (activeEl as HTMLElement).isContentEditable)
  ) {
    return true;
  }
  const audios = Array.from(document.querySelectorAll('audio'));
  if (audios.some((a) => !a.paused && !a.ended && a.currentTime > 0)) {
    return true;
  }
  return false;
}

const prefetchNextBundleQuietly = async (targetBuildTime: number) => {
  try {
    const htmlRes = await fetch(`/?v=${targetBuildTime}&t=${Date.now()}`, { cache: 'no-store' });
    if (!htmlRes.ok) return;
    const htmlText = await htmlRes.text();
    if (!htmlText || !htmlText.includes('__SB_BUNDLE_KEY__')) return;

    const jsMatch = htmlText.match(/src="(\/_live\/app\.js[^"]*)"/i);
    const cssMatch = htmlText.match(/href="(\/_live\/app\.css[^"]*)"/i);
    const jsUrl = jsMatch?.[1] || '/_live/app.js';
    const cssUrl = cssMatch?.[1] || '/_live/app.css';

    const fetchTask = (async () => {
      const [jsRes, cssRes] = await Promise.all([
        fetch(jsUrl, { cache: 'reload' }),
        fetch(cssUrl, { cache: 'reload' }),
      ]);
      if (!jsRes.ok) return;
      const jsText = await jsRes.text();
      const cssText = cssRes.ok ? await cssRes.text() : '';
      const keyMatch = htmlText.match(/__SB_BUNDLE_KEY__\s*=\s*['"]([^'"]+)['"]/i);
      const bundleKey = keyMatch?.[1] || `v_${targetBuildTime}`;
      const bridge = (
        window as unknown as {
          AndroidBridge?: {
            saveOfflineWebBundle?: (ver: string, html: string, js: string, css: string) => boolean;
          };
        }
      ).AndroidBridge;
      if (jsText && jsText.length > 1000 && bridge?.saveOfflineWebBundle) {
        bridge.saveOfflineWebBundle(bundleKey, htmlText, jsText, cssText);
      }
    })();

    await Promise.race([fetchTask.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
  } catch {
    // sessiz geç
  }
};

const applyPendingReloadIfSafe = async (targetBuildTime: number, forceRefresh: boolean) => {
  if (isPrefetchingUpdate) return;
  if (!forceRefresh && isUserTypingOrListening()) {
    pendingUpdateBuildTime = targetBuildTime;
    return;
  }
  if (!forceRefresh) {
    try {
      const lastBuildReloaded = sessionStorage.getItem('sb_last_ota_build_v1');
      const lastReloadTs = Number(sessionStorage.getItem('sb_last_ota_ts_v1') || '0');
      if (
        lastBuildReloaded === String(targetBuildTime) &&
        lastReloadTs > 0 &&
        Date.now() - lastReloadTs < MIN_SAME_BUILD_COOLDOWN_MS
      ) {
        loadedServerBuildTime = targetBuildTime;
        pendingUpdateBuildTime = null;
        return;
      }
      if (lastBuildReloaded === String(targetBuildTime)) {
        const rawBundleKey = String(
          (window as unknown as { __SB_BUNDLE_KEY__?: string }).__SB_BUNDLE_KEY__ || ''
        );
        const currentBundleTs = Number(rawBundleKey.replace(/^v_/, '')) || 0;
        if (currentBundleTs === targetBuildTime) {
          loadedServerBuildTime = targetBuildTime;
          pendingUpdateBuildTime = null;
          return;
        }
      }
    } catch {}
  }

  isPrefetchingUpdate = true;
  pendingUpdateBuildTime = null;
  try {
    sessionStorage.setItem('sb_last_ota_build_v1', String(targetBuildTime));
    sessionStorage.setItem('sb_last_ota_ts_v1', String(Date.now()));
  } catch {}

  loadedServerBuildTime = targetBuildTime;
  await Promise.allSettled([
    flushMasterVaultImmediate(),
    prefetchNextBundleQuietly(targetBuildTime),
  ]);

  const cleanPath = window.location.pathname || '/';
  window.location.replace(`${cleanPath}?v=${targetBuildTime}&r=${Date.now()}`);
};

const handleIncomingServerBuildTime = async (remoteBuildTime: number) => {
  if (isHiddenSyncFrame || isPrefetchingUpdate || isRedirectingToVds) return;
  if (!remoteBuildTime || remoteBuildTime <= 0) return;

  if (window.location.hostname === VDS_HOST) {
    let forceRefresh = false;
    try {
      if (localStorage.getItem('sb_force_ota_refresh_v1') === '1') {
        localStorage.removeItem('sb_force_ota_refresh_v1');
        forceRefresh = true;
      }
    } catch {}

    const rawBundleKey = String(
      (window as unknown as { __SB_BUNDLE_KEY__?: string }).__SB_BUNDLE_KEY__ || ''
    );
    const bundleKeyTs = Number(rawBundleKey.replace(/^v_/, '')) || 0;
    const isDifferentDeployedBundle =
      bundleKeyTs > 0 && remoteBuildTime !== bundleKeyTs;

    if (loadedServerBuildTime === null && !forceRefresh && !isDifferentDeployedBundle) {
      loadedServerBuildTime = remoteBuildTime;
      return;
    }

    if (
      forceRefresh ||
      isDifferentDeployedBundle ||
      (loadedServerBuildTime !== null && remoteBuildTime !== loadedServerBuildTime)
    ) {
      await applyPendingReloadIfSafe(remoteBuildTime, forceRefresh);
    }
    return;
  }

  // Yerel APK kabuğundan canlı sunucuya tek seferlik güvenli geçiş
  isRedirectingToVds = true;
  try {
    localStorage.removeItem('sb_force_ota_refresh_v1');
  } catch {}
  await flushMasterVaultImmediate().catch(() => {});
  let sessionParam = '';
  try {
    const savedSession = localStorage.getItem('sb_active_auth_session_v1');
    if (savedSession) {
      sessionParam = `&sb_ota_session=${encodeURIComponent(savedSession)}`;
    }
  } catch {}
  window.location.replace(`${VDS_WEB_ORIGIN}/?v=${remoteBuildTime || 'live'}${sessionParam}`);
};

const tryFlushPendingUpdateSoon = () => {
  if (!pendingUpdateBuildTime || isPrefetchingUpdate) return;
  window.setTimeout(() => {
    if (pendingUpdateBuildTime && !isPrefetchingUpdate && !isUserTypingOrListening()) {
      void applyPendingReloadIfSafe(pendingUpdateBuildTime, false);
    }
  }, 400);
};

if (typeof window !== 'undefined' && !isHiddenSyncFrame) {
  window.addEventListener('focusout', tryFlushPendingUpdateSoon, true);
  document.addEventListener('ended', tryFlushPendingUpdateSoon, true);
  document.addEventListener('pause', tryFlushPendingUpdateSoon, true);
}

const checkAndApplyLiveUpdate = () => {
  if (isHiddenSyncFrame || isPrefetchingUpdate || isRedirectingToVds) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  if (pendingUpdateBuildTime && !isUserTypingOrListening()) {
    void applyPendingReloadIfSafe(pendingUpdateBuildTime, false);
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);

  fetch(`${VDS_WEB_ORIGIN}/api/server-meta?t=${Date.now()}`, {
    cache: 'no-store',
    signal: ctrl.signal,
  })
    .then((res) => (res.ok ? res.json() : null))
    .then(async (meta) => {
      if (!meta || !meta.ok) return;
      const preferredOrigin = typeof meta.preferredOrigin === 'string' ? meta.preferredOrigin.trim().replace(/\/+$/, '') : '';
      if (preferredOrigin && /^https?:\/\/[^/\s]+/i.test(preferredOrigin) && preferredOrigin !== VDS_WEB_ORIGIN) {
        setActiveLiveOrigin(preferredOrigin);
        try {
          await flushMasterVaultImmediate();
        } catch {}
        window.location.replace(`${preferredOrigin}/?v=${Number(meta.buildTime) || Date.now()}`);
        return;
      }
      const remoteBuildTime = Number(meta.buildTime) || 0;
      await handleIncomingServerBuildTime(remoteBuildTime);
    })
    .catch(() => {
      // Sunucu bakımda veya internet yoksa APK yerel paketle kesintisiz çalışmaya devam eder
    })
    .finally(() => {
      clearTimeout(timer);
    });
};

const connectLiveUpdateStream = () => {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (isHiddenSyncFrame || window.location.hostname !== VDS_HOST) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (liveUpdateEventSource) {
    try {
      liveUpdateEventSource.close();
    } catch {}
    liveUpdateEventSource = null;
  }
  if (liveUpdateReconnectTimer !== null) {
    window.clearTimeout(liveUpdateReconnectTimer);
    liveUpdateReconnectTimer = null;
  }

  try {
    const es = new EventSource(`${VDS_WEB_ORIGIN}/api/live-updates`);
    liveUpdateEventSource = es;

    const onVersionEvent = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(evt.data || '{}')) as { buildTime?: number };
        const remoteBuildTime = Number(parsed?.buildTime) || 0;
        if (remoteBuildTime > 0) {
          void handleIncomingServerBuildTime(remoteBuildTime);
        }
      } catch {}
    };

    es.addEventListener('version', onVersionEvent as EventListener);
    es.onmessage = onVersionEvent;
    es.onerror = () => {
      try {
        es.close();
      } catch {}
      if (liveUpdateEventSource === es) {
        liveUpdateEventSource = null;
      }
      if (liveUpdateReconnectTimer === null) {
        liveUpdateReconnectTimer = window.setTimeout(() => {
          liveUpdateReconnectTimer = null;
          checkAndApplyLiveUpdate();
          connectLiveUpdateStream();
        }, 2200);
      }
    };
  } catch {
    // EventSource desteklenmiyorsa hızlı periyodik kontrol devrede kalır
  }
};

let isNativePlatformSafe = false;
try {
  isNativePlatformSafe = Boolean(Capacitor?.isNativePlatform?.());
} catch {
  isNativePlatformSafe = false;
}

const isNativeOrVdsRuntime =
  isNativePlatformSafe ||
  Boolean((window as unknown as { AndroidBridge?: unknown }).AndroidBridge) ||
  window.location.hostname === VDS_HOST;

if (isNativePlatformSafe) {
  try {
    if (SystemBars && typeof SystemBars.setStyle === 'function') {
      SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {});
    }
    if (SystemBars && typeof SystemBars.show === 'function') {
      SystemBars.show().catch(() => {});
    }
  } catch {}
}

// İnternet varken en son güncel ekran paketini telefonun kendi kalıcı hafızasına kopyala
const syncLatestBundleToOfflinePhoneStorage = () => {
  try {
    if (typeof window === 'undefined' || isHiddenSyncFrame) return;
    if (window.location.hostname !== VDS_HOST) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const bridge = (
      window as unknown as {
        AndroidBridge?: {
          getOfflineWebBundleVersion?: () => string;
          saveOfflineWebBundle?: (ver: string, html: string, js: string, css: string) => boolean;
        };
      }
    ).AndroidBridge;
    if (!bridge?.saveOfflineWebBundle) return;

    const bundleKey = String(
      (window as unknown as { __SB_BUNDLE_KEY__?: string }).__SB_BUNDLE_KEY__ || ''
    ).trim();
    if (!bundleKey) return;

    const alreadySaved = bridge.getOfflineWebBundleVersion?.() || '';
    if (alreadySaved === bundleKey) return;

    void (async () => {
      try {
        const htmlRes = await fetch(`/?t=${Date.now()}`, { cache: 'no-store' });
        if (!htmlRes.ok) return;
        const htmlText = await htmlRes.text();
        if (!htmlText || !htmlText.includes('__SB_BUNDLE_KEY__')) return;

        const jsMatch = htmlText.match(/src="(\/_live\/app\.js[^"]*)"/i);
        const cssMatch = htmlText.match(/href="(\/_live\/app\.css[^"]*)"/i);
        const jsUrl = jsMatch ? jsMatch[1] : '/_live/app.js';
        const cssUrl = cssMatch ? cssMatch[1] : '/_live/app.css';

        const [jsRes, cssRes] = await Promise.all([
          fetch(jsUrl, { cache: 'force-cache' }),
          fetch(cssUrl, { cache: 'force-cache' }),
        ]);
        if (!jsRes.ok) return;
        const jsText = await jsRes.text();
        const cssText = cssRes.ok ? await cssRes.text() : '';
        if (jsText && jsText.length > 1000) {
          bridge.saveOfflineWebBundle?.(bundleKey, htmlText, jsText, cssText);
        }
      } catch {
        // sessiz geç
      }
    })();
  } catch {
    // sessiz geç
  }
};

// Kapat-aç gerektirmeden anında canlı güncelleme (anlık yayın hattı + 5 sn yedek kontrol)
if (isNativeOrVdsRuntime && !isHiddenSyncFrame) {
  if (window.location.hostname !== VDS_HOST) {
    checkAndApplyLiveUpdate();
    window.addEventListener('online', () => {
      checkAndApplyLiveUpdate();
    });
  } else {
    checkAndApplyLiveUpdate();
    connectLiveUpdateStream();
    setTimeout(syncLatestBundleToOfflinePhoneStorage, 1800);
    setInterval(checkAndApplyLiveUpdate, 5000);
    window.addEventListener('online', () => {
      checkAndApplyLiveUpdate();
      connectLiveUpdateStream();
      setTimeout(syncLatestBundleToOfflinePhoneStorage, 1500);
    });
    window.addEventListener('focus', () => {
      checkAndApplyLiveUpdate();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushMasterVaultImmediate();
      } else if (document.visibilityState === 'visible') {
        checkAndApplyLiveUpdate();
        if (!liveUpdateEventSource) {
          connectLiveUpdateStream();
        }
      }
    });
    window.addEventListener('pagehide', () => {
      void flushMasterVaultImmediate();
    });
  }
}

const rootEl = document.getElementById('root');
if (rootEl && !isHiddenSyncFrame) {
  createRoot(rootEl).render(
    <StrictMode>
      <GlobalCrashShield>
        <App />
      </GlobalCrashShield>
    </StrictMode>,
  );
}
