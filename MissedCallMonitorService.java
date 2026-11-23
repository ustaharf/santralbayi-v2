package com.santralbayi.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.IBinder;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class MissedCallMonitorService extends Service {
    public static final String SERVICE_CHANNEL_ID = "santralbayi_bg_monitor_v1";
    public static final int SERVICE_NOTIF_ID = 4099;
    public static final String ACTION_LIVE_CALL_ENDED = "com.santralbayi.app.LIVE_CALL_ENDED";

    private ScheduledExecutorService scheduler;
    private final Map<String, String> lastNotifiedStageByKey = new HashMap<>();
    private final Set<String> activeLiveCallUuids = new HashSet<>();

    public static void startIfTracked(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            String ownerPhone = prefs.getString("tracked_owner_phone11", "");
            if (ownerPhone == null || ownerPhone.trim().length() < 10) {
                stopServiceSafe(context);
                return;
            }
            Intent svc = new Intent(context, MissedCallMonitorService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {
        }
    }

    public static void stopServiceSafe(Context context) {
        try {
            context.stopService(new Intent(context, MissedCallMonitorService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureServiceChannel();
        startForegroundSafe();
        startPollingLoop();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
        String ownerPhone = prefs.getString("tracked_owner_phone11", "");
        if (ownerPhone == null || ownerPhone.trim().length() < 10) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForegroundSafe();
        startPollingLoop();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        try {
            if (scheduler != null) {
                scheduler.shutdownNow();
                scheduler = null;
            }
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    private void ensureServiceChannel() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(SERVICE_CHANNEL_ID) == null) {
                    NotificationChannel ch = new NotificationChannel(
                            SERVICE_CHANNEL_ID,
                            "Santral Bayi 7/24 Çağrı Takibi",
                            NotificationManager.IMPORTANCE_MIN
                    );
                    ch.setDescription("Uygulama kapalıyken bile ulaşılamayan aramaları telefon ana ekranına anında bildirir.");
                    ch.setShowBadge(false);
                    ch.setSound(null, null);
                    ch.enableVibration(false);
                    nm.createNotificationChannel(ch);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void startForegroundSafe() {
        try {
            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(this, 4098, openIntent, piFlags);

            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, SERVICE_CHANNEL_ID)
                    : new Notification.Builder(this);

            int iconRes = getApplicationInfo().icon;
            if (iconRes == 0) iconRes = android.R.drawable.stat_sys_phone_call;

            b.setSmallIcon(iconRes)
                    .setContentTitle("Santral Bayi Aktif")
                    .setContentText("Ulaşılamayan aramalar 7/24 takip ediliyor.")
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setShowWhen(false);

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                //noinspection deprecation
                b.setPriority(Notification.PRIORITY_MIN);
            }

            Notification notif = b.build();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(SERVICE_NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(SERVICE_NOTIF_ID, notif);
            }
        } catch (Exception ignored) {
        }
    }

    private boolean isOnline() {
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

    private synchronized void startPollingLoop() {
        if (scheduler != null && !scheduler.isShutdown()) return;
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(this::pollMissedCallsOnce, 0, 1, TimeUnit.SECONDS);
    }

    private void broadcastLiveCallEnded(String uuid) {
        try {
            Intent endIntent = new Intent(ACTION_LIVE_CALL_ENDED);
            endIntent.setPackage(getPackageName());
            endIntent.putExtra("missed_call_uuid", uuid != null ? uuid : "");
            sendBroadcast(endIntent);
        } catch (Exception ignored) {
        }
    }

    private void pollMissedCallsOnce() {
        HttpURLConnection conn = null;
        try {
            if (!isOnline()) return;
            SharedPreferences prefs = getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            String ownerPhone = prefs.getString("tracked_owner_phone11", "");
            if (ownerPhone == null || ownerPhone.trim().length() < 10) return;
            ownerPhone = ownerPhone.trim();

            String liveOrigin = AndroidBridge.getSavedLiveOrigin(getApplicationContext());
            URL url = new URL(liveOrigin + "/api/pbx/live-calls?ownerPhone=" + ownerPhone + "&t=" + System.currentTimeMillis());
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() != 200) return;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }

            JSONObject root = new JSONObject(sb.toString());
            JSONArray calls = root.optJSONArray("calls");
            if (calls == null || calls.length() == 0) {
                if (!activeLiveCallUuids.isEmpty()) {
                    for (String oldUuid : new HashSet<>(activeLiveCallUuids)) {
                        broadcastLiveCallEnded(oldUuid);
                    }
                    activeLiveCallUuids.clear();
                }
                return;
            }

            String initKey = "bg_svc_init_" + ownerPhone;
            boolean initialized = prefs.getBoolean(initKey, false);
            Set<String> seenSet = new HashSet<>(prefs.getStringSet("bg_svc_seen_stages_v2", new HashSet<>()));
            Set<String> currentLiveUuids = new HashSet<>();
            boolean prefsDirty = false;

            int limit = Math.min(calls.length(), 12);
            for (int i = 0; i < limit; i++) {
                JSONObject c = calls.optJSONObject(i);
                if (c == null) continue;
                String uuid = c.optString("uuid", c.optString("safeUuid", "")).trim();
                if (uuid.isEmpty()) continue;

                String status = c.optString("status", "").trim().toUpperCase();
                boolean isLiveCall = "ANSWERED_BY_SECRETARY".equals(status);
                boolean isTransferred = "TRANSFERRED_TO_OWNER".equals(status);
                if (isLiveCall) {
                    currentLiveUuids.add(uuid);
                }
                String summary = c.optString("aiSummary", "").trim();
                String callerName = c.optString("detectedCallerName", "").trim();
                String callerPhone = c.optString("callerPhone11", c.optString("rawCaller", "")).trim();
                String bridgeToken = c.optString("bridgeToken", "").trim();

                String notifKey = ownerPhone + ":" + uuid;
                String stage = isLiveCall ? "LIVE" : (isTransferred ? "TRANSFERRED" : "DONE");
                String stageToken = notifKey + "|" + stage;

                if (!initialized) {
                    // İlk açılışta eski geçmiş çağrılar için spam yapma; sadece şu an CANLI devam eden çağrı varsa hemen bildir!
                    if (!isLiveCall) {
                        seenSet.add(stageToken);
                        lastNotifiedStageByKey.put(notifKey, stage);
                        prefsDirty = true;
                        continue;
                    }
                }

                String prevMemStage = lastNotifiedStageByKey.get(notifKey);
                if (stage.equals(prevMemStage) || seenSet.contains(stageToken)) {
                    continue;
                }

                lastNotifiedStageByKey.put(notifKey, stage);
                seenSet.add(stageToken);
                prefsDirty = true;

                if (isTransferred) {
                    AndroidBridge.cancelNativeMissedCallNotification(getApplicationContext(), notifKey);
                    broadcastLiveCallEnded(uuid);
                    continue;
                }

                if (!isLiveCall) {
                    if (activeLiveCallUuids.contains(uuid)) {
                        broadcastLiveCallEnded(uuid);
                    }
                    continue;
                }

                String who = !callerName.isEmpty() ? callerName : (!callerPhone.isEmpty() ? callerPhone : "Bilinmeyen Numara");
                String title = "📞 Sekreter Görüşüyor • " + who;

                String cleanSummary = summary;
                if (cleanSummary.isEmpty()) {
                    cleanSummary = "Size ulaşılamadığı için sekreter karşılıyor. Müsaitseniz hemen ücretsiz internetten alabilirsiniz.";
                }
                String phonePrefix = (!callerPhone.isEmpty() && !who.equals(callerPhone)) ? (callerPhone + " — ") : "";
                String body = phonePrefix + cleanSummary;

                AndroidBridge.postNativeMissedCallNotification(
                        getApplicationContext(),
                        notifKey,
                        title,
                        body,
                        callerPhone,
                        uuid,
                        true,
                        ownerPhone,
                        bridgeToken
                );
            }

            for (String prevUuid : new HashSet<>(activeLiveCallUuids)) {
                if (!currentLiveUuids.contains(prevUuid)) {
                    broadcastLiveCallEnded(prevUuid);
                }
            }
            activeLiveCallUuids.clear();
            activeLiveCallUuids.addAll(currentLiveUuids);

            if (!initialized || prefsDirty) {
                while (seenSet.size() > 120) {
                    String first = seenSet.iterator().next();
                    seenSet.remove(first);
                }
                prefs.edit()
                        .putBoolean(initKey, true)
                        .putStringSet("bg_svc_seen_stages_v2", seenSet)
                        .apply();
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }
}
