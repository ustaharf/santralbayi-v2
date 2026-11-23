package com.santralbayi.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private volatile boolean offlineBundleMode = false;
    private volatile boolean isAppInForeground = true;
    private AlertDialog activePermDialog = null;

    private boolean isDeviceOnline() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network active = cm.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception ignored) {
            return true;
        }
    }

    private boolean hasSavedOfflineBundle() {
        try {
            File dir = new File(getFilesDir(), "sb_offline_web");
            File html = new File(dir, "index.html");
            File js = new File(dir, "app.js");
            return html.exists() && html.length() > 200 && js.exists() && js.length() > 1000;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String getSavedLiveHost() {
        try {
            URL u = new URL(AndroidBridge.getSavedLiveOrigin(this));
            return u.getHost() != null ? u.getHost() : "178.208.187.42";
        } catch (Exception ignored) {
            return "178.208.187.42";
        }
    }

    private WebResourceResponse tryServeSavedOfflineAsset(WebResourceRequest request) {
        try {
            if (request == null || request.getUrl() == null) return null;
            if (!hasSavedOfflineBundle()) return null;

            String host = request.getUrl().getHost();
            String path = request.getUrl().getPath();
            if (host == null) return null;

            boolean isLocalShell = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
            String savedLiveHost = getSavedLiveHost();
            boolean isLiveHost = "178.208.187.42".equals(host) || savedLiveHost.equalsIgnoreCase(host);
            if (!isLocalShell && !isLiveHost) return null;

            // KRİTİK KURAL: Yerel açılışta (localhost) her zaman en son kaydedilen yeni tasarımı aç — eski APK tasarımı ASLA geri gelmez!
            // Canlı adreste ise sadece internet kesikse / çevrimdışı moddaysa telefon hafızasındaki en son yeni tasarımı sun!
            if (isLiveHost && !offlineBundleMode && isDeviceOnline()) return null;

            File dir = new File(getFilesDir(), "sb_offline_web");
            if (path == null || path.isEmpty() || "/".equals(path) || "/index.html".equals(path)) {
                File f = new File(dir, "index.html");
                if (f.exists() && f.length() > 200) {
                    return new WebResourceResponse("text/html", "UTF-8", new FileInputStream(f));
                }
            } else if (path.startsWith("/_live/app.js")) {
                File f = new File(dir, "app.js");
                if (f.exists() && f.length() > 1000) {
                    return new WebResourceResponse("application/javascript", "UTF-8", new FileInputStream(f));
                }
            } else if (path.startsWith("/_live/app.css")) {
                File f = new File(dir, "app.css");
                if (f.exists()) {
                    return new WebResourceResponse("text/css", "UTF-8", new FileInputStream(f));
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        offlineBundleMode = !isDeviceOnline();

        try {
            if (this.getBridge() != null) {
                WebView webView = this.getBridge().getWebView();
                if (webView != null) {
                    WebSettings settings = webView.getSettings();
                    settings.setMediaPlaybackRequiresUserGesture(false);
                    settings.setDomStorageEnabled(true);
                    settings.setCacheMode(isDeviceOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
                    webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

                    webView.setWebChromeClient(new WebChromeClient() {
                        @Override
                        public void onPermissionRequest(final PermissionRequest request) {
                            runOnUiThread(() -> {
                                try {
                                    if (request != null) {
                                        request.grant(request.getResources());
                                    }
                                } catch (Exception ignored) {
                                }
                            });
                        }
                    });

                    webView.setWebViewClient(new BridgeWebViewClient(this.getBridge()) {
                        private boolean retriedLiveCacheOnce = false;

                        @Override
                        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                            WebResourceResponse offlineResp = tryServeSavedOfflineAsset(request);
                            if (offlineResp != null) {
                                return offlineResp;
                            }
                            return super.shouldInterceptRequest(view, request);
                        }

                        @Override
                        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                            try {
                                if (view != null && request != null && request.isForMainFrame()) {
                                    String failingUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                                    if (!failingUrl.startsWith("http://localhost")) {
                                        offlineBundleMode = true;
                                        if (hasSavedOfflineBundle()) {
                                            view.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                                            view.loadUrl("http://localhost/");
                                            return;
                                        }
                                        if (!retriedLiveCacheOnce) {
                                            retriedLiveCacheOnce = true;
                                            view.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ONLY);
                                            view.loadUrl(failingUrl);
                                            return;
                                        }
                                        view.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                                        view.loadUrl("http://localhost/");
                                        return;
                                    }
                                }
                            } catch (Exception ignored) {
                            }
                            super.onReceivedError(view, request, error);
                        }

                        @Override
                        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                            try {
                                if (view != null) {
                                    view.reload();
                                }
                            } catch (Exception ignored) {
                            }
                            return true;
                        }
                    });
                }
            }
        } catch (Exception ignored) {
        }

        AndroidBridge.ensureMissedCallNotificationChannel(this);
        handleNotificationOpenIntent(getIntent());
        MissedCallMonitorService.startIfTracked(getApplicationContext());
        new Handler(Looper.getMainLooper()).postDelayed(this::requestNeededPermissionsSafe, 550);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationOpenIntent(intent);
    }

    private void handleNotificationOpenIntent(Intent intent) {
        try {
            if (intent == null) return;
            String openTab = intent.getStringExtra("open_tab");
            if (openTab == null || openTab.isEmpty()) return;
            String callUuid = intent.getStringExtra("missed_call_uuid");
            JSONObject payload = new JSONObject();
            payload.put("openTab", openTab);
            payload.put("callUuid", callUuid != null ? callUuid : "");
            SharedPreferences prefs = getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("pending_open_action", payload.toString()).apply();

            final String safeUuid = (callUuid != null ? callUuid : "").replaceAll("[^a-zA-Z0-9_-]", "");
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    if (this.getBridge() != null && this.getBridge().getWebView() != null) {
                        this.getBridge().getWebView().evaluateJavascript(
                                "window.dispatchEvent(new CustomEvent('sb-open-missed-calls', { detail: { callUuid: '" + safeUuid + "' } }));",
                                null
                        );
                    }
                } catch (Exception ignored) {
                }
            }, 300);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
        MissedCallMonitorService.startIfTracked(getApplicationContext());
        try {
            boolean online = isDeviceOnline();
            offlineBundleMode = !online;
            if (this.getBridge() != null && this.getBridge().getWebView() != null) {
                this.getBridge().getWebView().getSettings().setCacheMode(
                        online ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK
                );
            }
        } catch (Exception ignored) {
        }
        new Handler(Looper.getMainLooper()).postDelayed(this::promptStandaloneCallPermissionsOnce, 600);
    }

    @Override
    public void onPause() {
        super.onPause();
        isAppInForeground = false;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }

    private void requestNeededPermissionsSafe() {
        try {
            if (isFinishing() || isDestroyed()) {
                return;
            }
            List<String> needed = new ArrayList<>();
            String[] perms = new String[]{
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.CALL_PHONE,
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA
            };
            for (String p : perms) {
                if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(p);
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.POST_NOTIFICATIONS);
                }
            }
            if (!needed.isEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
            } else {
                new Handler(Looper.getMainLooper()).postDelayed(this::promptStandaloneCallPermissionsOnce, 350);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            new Handler(Looper.getMainLooper()).postDelayed(this::promptStandaloneCallPermissionsOnce, 450);
        }
    }

    private void promptStandaloneCallPermissionsOnce() {
        try {
            if (isFinishing() || isDestroyed() || !isAppInForeground) return;
            if (activePermDialog != null && activePermDialog.isShowing()) return;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

            SharedPreferences prefs = getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            boolean needsOverlay = !Settings.canDrawOverlays(this);
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            boolean needsBattery = pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
            boolean needsFullScreen = false;
            if (Build.VERSION.SDK_INT >= 34) {
                android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                needsFullScreen = nm != null && !nm.canUseFullScreenIntent();
            }

            if (needsOverlay && !prefs.getBoolean("asked_overlay_perm_v21", false)) {
                prefs.edit().putBoolean("asked_overlay_perm_v21", true).apply();
                activePermDialog = new AlertDialog.Builder(this)
                        .setTitle("1/4 • Ana Ekranda Tam Ekran Arama İzni")
                        .setMessage("Arama geldiğinde uygulama kapalı olsa bile telefonun ana ekranında tam ekran arama açılması için 'Diğer uygulamaların üzerinde göster' iznini açın.")
                        .setCancelable(true)
                        .setPositiveButton("İzni Aç", (d, w) -> {
                            try {
                                Intent i = new Intent(
                                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                        Uri.parse("package:" + getPackageName())
                                );
                                startActivity(i);
                            } catch (Exception ignored) {
                            }
                        })
                        .setNegativeButton("Sonra", (d, w) -> new Handler(Looper.getMainLooper()).postDelayed(this::promptStandaloneCallPermissionsOnce, 300))
                        .show();
                return;
            }

            if (needsFullScreen && !prefs.getBoolean("asked_fullscreen_perm_v21", false)) {
                prefs.edit().putBoolean("asked_fullscreen_perm_v21", true).apply();
                activePermDialog = new AlertDialog.Builder(this)
                        .setTitle("2/4 • Kilit Ekranında Tam Ekran Arama")
                        .setMessage("Telefon kilitliyken gelen aramanın kilit ekranı üstünde açılması için tam ekran bildirim iznini açın.")
                        .setCancelable(true)
                        .setPositiveButton("İzni Aç", (d, w) -> {
                            try {
                                Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                                i.setData(Uri.parse("package:" + getPackageName()));
                                startActivity(i);
                            } catch (Exception ignored) {
                            }
                        })
                        .setNegativeButton("Sonra", (d, w) -> new Handler(Looper.getMainLooper()).postDelayed(this::promptStandaloneCallPermissionsOnce, 300))
                        .show();
                return;
            }

            if (needsBattery && !prefs.getBoolean("asked_battery_perm_v21", false)) {
                prefs.edit().putBoolean("asked_battery_perm_v21", true).apply();
                try {
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    i.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception ignored) {
                }
                return;
            }

            if (AndroidBridge.isXiaomiFamilyDevice() && !prefs.getBoolean("asked_xiaomi_lock_perm_v21", false)) {
                prefs.edit().putBoolean("asked_xiaomi_lock_perm_v21", true).apply();
                activePermDialog = new AlertDialog.Builder(this)
                        .setTitle("Son Adım • Kilit Ekranı Üstünde Göster İzni")
                        .setMessage("Açılacak ekranda şu iki izni 'Her zaman izin ver' yapın:\n\n1) Kilit ekranında göster\n2) Arka planda çalışırken açılır pencereleri görüntüle\n\nBöylece telefon kilitliyken bile tam ekran arama anında en üstte açılır.")
                        .setCancelable(true)
                        .setPositiveButton("İzinleri Aç", (d, w) -> AndroidBridge.openXiaomiLockScreenPermissions(this))
                        .setNegativeButton("Sonra", null)
                        .show();
            }
        } catch (Exception ignored) {
        }
    }
}
