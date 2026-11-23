package com.santralbayi.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class AndroidBridge {
    public static final String DEFAULT_LIVE_ORIGIN = "http://178.208.187.42:3000";
    public static final String NATIVE_APK_VERSION = "2.0";

    private final Activity activity;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    public AndroidBridge(Activity activity) {
        this.activity = activity;
        initTts();
    }

    public static String getSavedLiveOrigin(Context context) {
        try {
            if (context != null) {
                SharedPreferences prefs = context.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
                String saved = prefs.getString("live_server_origin", "");
                if (saved != null) {
                    saved = saved.trim();
                    if ((saved.startsWith("http://") || saved.startsWith("https://")) && saved.length() > 10) {
                        while (saved.endsWith("/")) {
                            saved = saved.substring(0, saved.length() - 1);
                        }
                        return saved;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return DEFAULT_LIVE_ORIGIN;
    }

    public static void saveLiveOrigin(Context context, String origin) {
        try {
            if (context == null || origin == null) return;
            String clean = origin.trim();
            if (!(clean.startsWith("http://") || clean.startsWith("https://")) || clean.length() <= 10) return;
            while (clean.endsWith("/")) {
                clean = clean.substring(0, clean.length() - 1);
            }
            SharedPreferences prefs = context.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("live_server_origin", clean).apply();
        } catch (Exception ignored) {
        }
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(activity.getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    tts.setLanguage(new Locale("tr", "TR"));
                    ttsReady = true;
                }
            });
        } catch (Exception ignored) {
            ttsReady = false;
        }
    }

    @JavascriptInterface
    public boolean isBridgeReady() {
        return true;
    }

    @JavascriptInterface
    public String getApkNativeVersion() {
        return NATIVE_APK_VERSION;
    }

    @JavascriptInterface
    public String getLiveServerOrigin() {
        return getSavedLiveOrigin(activity.getApplicationContext());
    }

    @JavascriptInterface
    public boolean setLiveServerOrigin(String origin) {
        try {
            if (origin == null) return false;
            String clean = origin.trim();
            if (!(clean.startsWith("http://") || clean.startsWith("https://")) || clean.length() <= 10) {
                return false;
            }
            saveLiveOrigin(activity.getApplicationContext(), clean);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public void saveLastUiRoute(String routeJson) {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            if (routeJson == null || routeJson.trim().isEmpty()) {
                prefs.edit().remove("last_ui_route_v1").apply();
            } else {
                prefs.edit().putString("last_ui_route_v1", routeJson).apply();
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String getLastUiRoute() {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            return prefs.getString("last_ui_route_v1", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean hasOverlayPermission() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            return Settings.canDrawOverlays(activity.getApplicationContext());
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public void requestOverlayPermission() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
                    Intent intent = new Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + activity.getPackageName())
                    );
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public boolean isBatteryOptimizationIgnored() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(activity.getPackageName());
        } catch (Exception ignored) {
            return true;
        }
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimization() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(activity.getPackageName())) {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + activity.getPackageName()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(intent);
                    }
                }
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public boolean canUseFullScreenIntent() {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                NotificationManager nm = (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
                return nm == null || nm.canUseFullScreenIntent();
            }
            return true;
        } catch (Exception ignored) {
            return true;
        }
    }

    @JavascriptInterface
    public void requestFullScreenIntentPermission() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + activity.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public String getNativePermissionStatus() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("apkVersion", NATIVE_APK_VERSION);
            obj.put("overlayGranted", hasOverlayPermission());
            obj.put("batteryIgnored", isBatteryOptimizationIgnored());
            obj.put("fullScreenIntentGranted", canUseFullScreenIntent());
            obj.put("liveOrigin", getSavedLiveOrigin(activity.getApplicationContext()));
            obj.put("notificationsGranted",
                    Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
            obj.put("micGranted",
                    ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        } catch (Exception ignored) {
        }
        return obj.toString();
    }

    public static final String MISSED_CALL_CHANNEL_ID = "santralbayi_missed_calls_v1";
    public static final String LIVE_CALL_CHANNEL_ID = "santralbayi_live_calls_v2";

    public static void ensureMissedCallNotificationChannel(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(MISSED_CALL_CHANNEL_ID) == null) {
                    NotificationChannel ch = new NotificationChannel(
                            MISSED_CALL_CHANNEL_ID,
                            "Ulaşılamayan / Cevapsız Aramalar",
                            NotificationManager.IMPORTANCE_HIGH
                    );
                    ch.setDescription("Hattınıza ulaşılamadığında sekreterin karşıladığı aramaların telefon ana ekran bildirimleri");
                    ch.enableVibration(true);
                    ch.setShowBadge(true);
                    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                    nm.createNotificationChannel(ch);
                }
                if (nm != null && nm.getNotificationChannel(LIVE_CALL_CHANNEL_ID) == null) {
                    NotificationChannel liveCh = new NotificationChannel(
                            LIVE_CALL_CHANNEL_ID,
                            "Canlı Gelen Aramalar (Tam Ekran)",
                            NotificationManager.IMPORTANCE_HIGH
                    );
                    liveCh.setDescription("Arama geldiğinde uygulamadan bağımsız olarak telefon ana ekranında tam ekran arama açar");
                    liveCh.enableVibration(true);
                    liveCh.setBypassDnd(true);
                    liveCh.setShowBadge(true);
                    liveCh.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                    nm.createNotificationChannel(liveCh);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static int computeNotifId(String notifKey, String fallback) {
        int id = Math.abs((notifKey != null && !notifKey.isEmpty() ? notifKey : fallback).hashCode());
        return id == 0 ? 4041 : id;
    }

    public static void cancelNativeMissedCallNotification(Context context, String notifKey) {
        try {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(computeNotifId(notifKey, "missed_call"));
            }
        } catch (Exception ignored) {
        }
    }

    public static void postTransferStatusNotification(Context context, String notifKey, String title, String body) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
            ensureMissedCallNotificationChannel(context);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            int notifId = computeNotifId(notifKey, title + body);
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(context, MISSED_CALL_CHANNEL_ID)
                    : new Notification.Builder(context);

            int iconRes = context.getApplicationInfo().icon;
            if (iconRes == 0) iconRes = android.R.drawable.sym_call_incoming;

            builder.setSmallIcon(iconRes)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setWhen(System.currentTimeMillis())
                    .setShowWhen(true)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);

            nm.notify(notifId, builder.build());
        } catch (Exception ignored) {
        }
    }

    public static void postNativeMissedCallNotification(
            Context context,
            String notifKey,
            String title,
            String body,
            String callerPhone,
            String callUuid
    ) {
        SharedPreferences prefs = context.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
        String ownerPhone = prefs.getString("tracked_owner_phone11", "");
        postNativeMissedCallNotification(context, notifKey, title, body, callerPhone, callUuid, false, ownerPhone);
    }

    public static void postNativeMissedCallNotification(
            Context context,
            String notifKey,
            String title,
            String body,
            String callerPhone,
            String callUuid,
            boolean isLiveCall,
            String ownerPhone
    ) {
        postNativeMissedCallNotification(context, notifKey, title, body, callerPhone, callUuid, isLiveCall, ownerPhone, "");
    }

    public static void postNativeMissedCallNotification(
            Context context,
            String notifKey,
            String title,
            String body,
            String callerPhone,
            String callUuid,
            boolean isLiveCall,
            String ownerPhone,
            String bridgeToken
    ) {
        try {
            ensureMissedCallNotificationChannel(context);

            String safeTitle = (title != null && !title.trim().isEmpty())
                    ? title.trim()
                    : (isLiveCall ? "📞 Sekreter Görüşüyor" : "📞 Ulaşılamayan Arama");
            String safeBody = (body != null && !body.trim().isEmpty())
                    ? body.trim()
                    : "Bir kişi aradı ve size ulaşamadı. Detayı görmek için dokunun.";

            String safeCallerPhone = callerPhone != null ? callerPhone : "";
            String safeUuid = callUuid != null ? callUuid : "";
            String safeToken = bridgeToken != null ? bridgeToken : "";
            String safeOwnerPhone = ownerPhone != null ? ownerPhone : "";
            if (safeOwnerPhone.isEmpty()) {
                SharedPreferences prefs = context.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
                safeOwnerPhone = prefs.getString("tracked_owner_phone11", "");
            }
            String callerLabel = safeTitle
                    .replace("📞 Sekreter Görüşüyor • ", "")
                    .replace("📞 Ulaşılamayan Arama • ", "")
                    .trim();

            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setAction("com.santralbayi.app.OPEN_MISSED_CALL");
            openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            openIntent.putExtra("open_tab", "incoming_calls");
            openIntent.putExtra("missed_call_uuid", safeUuid);
            openIntent.putExtra("missed_call_phone", safeCallerPhone);

            int notifId = computeNotifId(notifKey, safeTitle + safeBody);

            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(context, notifId, openIntent, piFlags);

            // Bağımsız telefon arama ekranı (Uygulamayı açmadan doğrudan telefonda bağımsız açılır!)
            Intent standaloneCallIntent = new Intent(context, LiveCallActivity.class);
            standaloneCallIntent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_NO_USER_ACTION
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            );
            standaloneCallIntent.putExtra("notif_key", notifKey != null ? notifKey : "");
            standaloneCallIntent.putExtra("missed_call_uuid", safeUuid);
            standaloneCallIntent.putExtra("missed_call_phone", safeCallerPhone);
            standaloneCallIntent.putExtra("caller_name", callerLabel);
            standaloneCallIntent.putExtra("owner_phone", safeOwnerPhone);
            standaloneCallIntent.putExtra("call_summary", safeBody);
            standaloneCallIntent.putExtra("bridge_token", safeToken);
            standaloneCallIntent.putExtra("auto_accept", false);

            // Canlı arama geldiğinde: telefonun ana ekranı açıkken bile (uygulama kapalı olsa dahi) doğrudan bağımsız ekranı fırlat!
            if (isLiveCall) {
                try {
                    boolean canDirectLaunch = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(context));
                    if (canDirectLaunch) {
                        context.startActivity(standaloneCallIntent);
                    }
                } catch (Exception ignoredLaunch) {
                }
            }

            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            PendingIntent fullScreenCallPi = PendingIntent.getActivity(
                    context,
                    (notifId ^ 0x4F4F) & 0x7FFFFFFF,
                    standaloneCallIntent,
                    piFlags
            );

            PendingIntent primaryActionPi;
            if (isLiveCall) {
                Intent autoAcceptIntent = new Intent(standaloneCallIntent);
                autoAcceptIntent.putExtra("auto_accept", true);
                primaryActionPi = PendingIntent.getActivity(
                        context,
                        (notifId ^ 0x2A2A) & 0x7FFFFFFF,
                        autoAcceptIntent,
                        piFlags
                );
            } else {
                Intent callbackIntent = new Intent(context, MissedCallActionReceiver.class);
                callbackIntent.setAction(MissedCallActionReceiver.ACTION_CALLBACK_CALLER);
                callbackIntent.putExtra("notif_key", notifKey != null ? notifKey : "");
                callbackIntent.putExtra("missed_call_uuid", safeUuid);
                callbackIntent.putExtra("missed_call_phone", safeCallerPhone);
                callbackIntent.putExtra("owner_phone", safeOwnerPhone);
                callbackIntent.putExtra("caller_label", callerLabel);
                primaryActionPi = PendingIntent.getBroadcast(
                        context,
                        (notifId ^ 0x2A2A) & 0x7FFFFFFF,
                        callbackIntent,
                        piFlags
                );
            }

            String channelId = isLiveCall ? LIVE_CALL_CHANNEL_ID : MISSED_CALL_CHANNEL_ID;
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(context, channelId)
                    : new Notification.Builder(context);

            int iconRes = context.getApplicationInfo().icon;
            if (iconRes == 0) iconRes = android.R.drawable.sym_call_missed;

            builder.setSmallIcon(iconRes)
                    .setContentTitle(safeTitle)
                    .setContentText(safeBody)
                    .setStyle(new Notification.BigTextStyle().bigText(safeBody))
                    .setAutoCancel(true)
                    .setContentIntent(isLiveCall ? fullScreenCallPi : pendingIntent)
                    .setWhen(System.currentTimeMillis())
                    .setShowWhen(true)
                    .setCategory(isLiveCall ? Notification.CATEGORY_CALL : Notification.CATEGORY_MISSED_CALL)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);

            if (isLiveCall) {
                builder.setFullScreenIntent(fullScreenCallPi, true);
                builder.setOngoing(true);
            }

            String primaryActionLabel = isLiveCall ? "✅ Müsaitim, Bana Aktar" : "📞 Müsaitim, Hemen Ara";
            if (!safeCallerPhone.isEmpty() || !safeUuid.isEmpty()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    builder.addAction(new Notification.Action.Builder(
                            android.R.drawable.sym_action_call,
                            primaryActionLabel,
                            primaryActionPi
                    ).build());
                    builder.addAction(new Notification.Action.Builder(
                            android.R.drawable.ic_menu_view,
                            "📋 Kaydı Gör",
                            pendingIntent
                    ).build());
                } else {
                    //noinspection deprecation
                    builder.addAction(android.R.drawable.sym_action_call, primaryActionLabel, primaryActionPi);
                    //noinspection deprecation
                    builder.addAction(android.R.drawable.ic_menu_view, "📋 Kaydı Gör", pendingIntent);
                }
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                //noinspection deprecation
                builder.setPriority(Notification.PRIORITY_MAX);
                //noinspection deprecation
                builder.setDefaults(Notification.DEFAULT_ALL);
            }

            nm.notify(notifId, builder.build());
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void openNativeLiveCallScreen(
            String callUuid,
            String callerName,
            String callerPhone,
            String ownerPhone,
            String summary,
            String bridgeToken,
            boolean autoAccept
    ) {
        activity.runOnUiThread(() -> {
            try {
                Intent i = new Intent(activity.getApplicationContext(), LiveCallActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                i.putExtra("missed_call_uuid", callUuid != null ? callUuid : "");
                i.putExtra("caller_name", callerName != null ? callerName : "");
                i.putExtra("missed_call_phone", callerPhone != null ? callerPhone : "");
                i.putExtra("owner_phone", ownerPhone != null ? ownerPhone : "");
                i.putExtra("call_summary", summary != null ? summary : "");
                i.putExtra("bridge_token", bridgeToken != null ? bridgeToken : "");
                i.putExtra("auto_accept", autoAccept);
                activity.startActivity(i);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void showMissedCallNotification(String notifKey, String title, String body, String callerPhone, String callUuid) {
        activity.runOnUiThread(() ->
                postNativeMissedCallNotification(activity.getApplicationContext(), notifKey, title, body, callerPhone, callUuid)
        );
    }

    @JavascriptInterface
    public void showMissedCallNotificationWithState(
            String notifKey,
            String title,
            String body,
            String callerPhone,
            String callUuid,
            boolean isLiveCall,
            String ownerPhone
    ) {
        activity.runOnUiThread(() ->
                postNativeMissedCallNotification(
                        activity.getApplicationContext(),
                        notifKey,
                        title,
                        body,
                        callerPhone,
                        callUuid,
                        isLiveCall,
                        ownerPhone
                )
        );
    }

    @JavascriptInterface
    public void setTrackedOwnerPhone(String ownerPhone11) {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            String digits = ownerPhone11 == null ? "" : ownerPhone11.replaceAll("[^0-9]", "");
            if (digits.isEmpty()) {
                prefs.edit().remove("tracked_owner_phone11").apply();
                MissedCallMonitorService.stopServiceSafe(activity.getApplicationContext());
            } else {
                prefs.edit().putString("tracked_owner_phone11", digits).apply();
                MissedCallMonitorService.startIfTracked(activity.getApplicationContext());
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String consumePendingOpenAction() {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            String pending = prefs.getString("pending_open_action", "");
            if (pending != null && !pending.isEmpty()) {
                prefs.edit().remove("pending_open_action").apply();
                return pending;
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    @JavascriptInterface
    public void saveOfflineSession(String sessionJson) {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            if (sessionJson == null || sessionJson.trim().isEmpty()) {
                prefs.edit().remove("active_session").remove("tracked_owner_phone11").apply();
                MissedCallMonitorService.stopServiceSafe(activity.getApplicationContext());
            } else {
                SharedPreferences.Editor ed = prefs.edit().putString("active_session", sessionJson);
                try {
                    JSONObject obj = new JSONObject(sessionJson);
                    String rawPhone = obj.optString("phone", "");
                    String digits = rawPhone.replaceAll("[^0-9]", "");
                    if (digits.length() == 10 && digits.startsWith("5")) digits = "0" + digits;
                    if (digits.length() == 12 && digits.startsWith("90")) digits = "0" + digits.substring(2);
                    if (digits.length() >= 10) {
                        ed.putString("tracked_owner_phone11", digits);
                    }
                } catch (Exception ignoredParse) {
                }
                ed.apply();
                MissedCallMonitorService.startIfTracked(activity.getApplicationContext());
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String getOfflineSession() {
        try {
            SharedPreferences prefs = activity.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            return prefs.getString("active_session", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public void saveOfflineVaultSnapshot(String vaultJson) {
        try {
            File file = new File(activity.getFilesDir(), "sb_native_vault_mirror.json");
            if (vaultJson == null || vaultJson.trim().isEmpty()) {
                if (file.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                return;
            }
            try (FileOutputStream fos = new FileOutputStream(file, false)) {
                fos.write(vaultJson.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String getOfflineVaultSnapshot() {
        try {
            File file = new File(activity.getFilesDir(), "sb_native_vault_mirror.json");
            if (!file.exists() || file.length() == 0) return "";
            byte[] buf = new byte[(int) file.length()];
            try (FileInputStream fis = new FileInputStream(file)) {
                int read = fis.read(buf);
                if (read <= 0) return "";
                return new String(buf, 0, read, StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public void saveOfflineVoiceClip(String clipKey, String audioDataUrl) {
        try {
            if (clipKey == null || clipKey.trim().isEmpty() || audioDataUrl == null || audioDataUrl.isEmpty()) {
                return;
            }
            String safeName = clipKey.replaceAll("[^a-zA-Z0-9_-]", "_");
            if (safeName.length() > 80) safeName = safeName.substring(0, 80);
            File dir = new File(activity.getFilesDir(), "sb_voice_clips");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }
            File out = new File(dir, safeName + ".b64");
            try (FileOutputStream fos = new FileOutputStream(out, false)) {
                fos.write(audioDataUrl.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String getOfflineVoiceClip(String clipKey) {
        try {
            if (clipKey == null || clipKey.trim().isEmpty()) return "";
            String safeName = clipKey.replaceAll("[^a-zA-Z0-9_-]", "_");
            if (safeName.length() > 80) safeName = safeName.substring(0, 80);
            File dir = new File(activity.getFilesDir(), "sb_voice_clips");
            File inFile = new File(dir, safeName + ".b64");
            if (!inFile.exists() || inFile.length() == 0) return "";
            byte[] buf = new byte[(int) inFile.length()];
            try (FileInputStream fis = new FileInputStream(inFile)) {
                int read = fis.read(buf);
                if (read <= 0) return "";
                return new String(buf, 0, read, StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public String getOfflineWebBundleVersion() {
        try {
            File verFile = new File(new File(activity.getFilesDir(), "sb_offline_web"), "version.txt");
            if (!verFile.exists() || verFile.length() == 0) return "";
            byte[] buf = new byte[(int) verFile.length()];
            try (FileInputStream fis = new FileInputStream(verFile)) {
                int read = fis.read(buf);
                if (read <= 0) return "";
                return new String(buf, 0, read, StandardCharsets.UTF_8).trim();
            }
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean saveOfflineWebBundle(String versionKey, String indexHtml, String appJs, String appCss) {
        try {
            if (versionKey == null || versionKey.trim().isEmpty()) return false;
            if (indexHtml == null || indexHtml.length() < 200) return false;
            if (appJs == null || appJs.length() < 1000) return false;
            if (appCss == null) appCss = "";

            File dir = new File(activity.getFilesDir(), "sb_offline_web");
            if (!dir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
            }

            writeAtomicUtf8(new File(dir, "index.html"), indexHtml);
            writeAtomicUtf8(new File(dir, "app.js"), appJs);
            writeAtomicUtf8(new File(dir, "app.css"), appCss);
            writeAtomicUtf8(new File(dir, "version.txt"), versionKey.trim());
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void writeAtomicUtf8(File target, String content) throws Exception {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp, false)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
        }
        if (target.exists()) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
        }
        if (!tmp.renameTo(target)) {
            try (FileOutputStream fos = new FileOutputStream(target, false)) {
                fos.write(content.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    @JavascriptInterface
    public String getDeviceContacts() {
        JSONArray list = new JSONArray();
        try {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS)
                    != PackageManager.PERMISSION_GRANTED) {
                return list.toString();
            }
            ContentResolver cr = activity.getContentResolver();
            Cursor cursor = cr.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{
                            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            ContactsContract.CommonDataKinds.Phone.NUMBER
                    },
                    null,
                    null,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            );
            if (cursor != null) {
                Set<String> seen = new HashSet<>();
                int count = 0;
                int idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (cursor.moveToNext() && count < 500) {
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    String phone = numIdx >= 0 ? cursor.getString(numIdx) : "";
                    String id = idIdx >= 0 ? cursor.getString(idIdx) : String.valueOf(count);
                    if (phone == null || phone.trim().isEmpty()) continue;
                    String norm = phone.replaceAll("\\s+", "");
                    if (seen.contains(norm)) continue;
                    seen.add(norm);
                    JSONObject obj = new JSONObject();
                    obj.put("id", id);
                    obj.put("name", name != null ? name : norm);
                    obj.put("phone", phone.trim());
                    list.put(obj);
                    count++;
                }
                cursor.close();
            }
        } catch (Exception ignored) {
        }
        return list.toString();
    }

    @JavascriptInterface
    public String pickSingleContact() {
        // Web UI rehber listesi ve navigator.contacts.select ile anında seçim yapılır;
        // eğer cihaz rehberi senkronizeyse boş dönerek web seçicisinin çalışmasına izin verir.
        return "";
    }

    @JavascriptInterface
    public void startWarmTransferCall(String phoneNumber, String greetingText, String subjectText) {
        activity.runOnUiThread(() -> {
            try {
                if (phoneNumber == null || phoneNumber.trim().isEmpty()) return;
                String cleanPhone = phoneNumber.replaceAll("[^0-9+*#]", "");
                if (cleanPhone.isEmpty()) return;

                boolean hasCallPerm = ContextCompat.checkSelfPermission(
                        activity, Manifest.permission.CALL_PHONE
                ) == PackageManager.PERMISSION_GRANTED;

                Intent intent = new Intent(hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL);
                intent.setData(Uri.parse("tel:" + cleanPhone.replace("#", Uri.encode("#"))));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void shareText(String title, String body) {
        activity.runOnUiThread(() -> {
            try {
                Intent sendIntent = new Intent(Intent.ACTION_SEND);
                sendIntent.setType("text/plain");
                if (title != null && !title.isEmpty()) {
                    sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                }
                sendIntent.putExtra(Intent.EXTRA_TEXT, body != null ? body : "");
                Intent chooser = Intent.createChooser(sendIntent, title != null ? title : "Paylaş");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(chooser);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void shareWhatsAppImageToNumber(String dataUrl, String waPhone, String waJid) {
        shareImageInternal(dataUrl, waPhone, waJid, "");
    }

    @JavascriptInterface
    public void shareImageBase64(String dataUrl, String waPhone, String caption) {
        shareImageInternal(dataUrl, waPhone, "", caption, "com.whatsapp");
    }

    @JavascriptInterface
    public void shareImageToPlatform(String dataUrl, String platformId, String caption) {
        String pkg = null;
        if (platformId != null) {
            switch (platformId) {
                case "whatsapp":
                    pkg = "com.whatsapp";
                    break;
                case "instagram":
                    pkg = "com.instagram.android";
                    break;
                case "facebook":
                    pkg = "com.facebook.katana";
                    break;
                case "tiktok":
                    pkg = "com.zhiliaoapp.musically";
                    break;
                case "linkedin":
                    pkg = "com.linkedin.android";
                    break;
                case "x_twitter":
                    pkg = "com.twitter.android";
                    break;
                case "telegram":
                    pkg = "org.telegram.messenger";
                    break;
                case "youtube":
                    pkg = "com.google.android.youtube";
                    break;
                default:
                    pkg = null;
                    break;
            }
        }
        shareImageInternal(dataUrl, "", "", caption, pkg);
    }

    private void shareImageInternal(String dataUrl, String waPhone, String waJid, String caption) {
        shareImageInternal(dataUrl, waPhone, waJid, caption, "com.whatsapp");
    }

    private void shareImageInternal(String dataUrl, String waPhone, String waJid, String caption, String targetPackage) {
        activity.runOnUiThread(() -> {
            try {
                if (dataUrl == null || dataUrl.isEmpty()) return;
                String base64Part = dataUrl.contains(",") ? dataUrl.substring(dataUrl.indexOf(",") + 1) : dataUrl;
                byte[] decoded = Base64.decode(base64Part, Base64.DEFAULT);

                File cacheFile = new File(activity.getCacheDir(), "santralbayi-belge.png");
                try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                    fos.write(decoded);
                    fos.flush();
                }

                Uri contentUri = FileProvider.getUriForFile(
                        activity,
                        activity.getPackageName() + ".fileprovider",
                        cacheFile
                );

                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("image/png");
                intent.putExtra(Intent.EXTRA_STREAM, contentUri);
                if (caption != null && !caption.isEmpty()) {
                    intent.putExtra(Intent.EXTRA_TEXT, caption);
                }
                if (waJid != null && !waJid.isEmpty()) {
                    intent.putExtra("jid", waJid);
                } else if (waPhone != null && !waPhone.isEmpty()) {
                    String digits = waPhone.replaceAll("[^0-9]", "");
                    if (!digits.isEmpty()) {
                        intent.putExtra("jid", digits + "@s.whatsapp.net");
                    }
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                if (targetPackage != null && !targetPackage.isEmpty()) {
                    intent.setPackage(targetPackage);
                    try {
                        activity.startActivity(intent);
                        return;
                    } catch (Exception ignoredPkg) {
                        intent.setPackage(null);
                    }
                }

                Intent chooser = Intent.createChooser(intent, "Broşür Görselini Paylaş");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(chooser);
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void speakText(String text) {
        try {
            if (!ttsReady || tts == null) {
                initTts();
            }
            if (ttsReady && tts != null && text != null && !text.trim().isEmpty()) {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sb_tts_utterance");
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void stopSpeaking() {
        try {
            if (tts != null) {
                tts.stop();
            }
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void setAudioRoute(boolean speakerOn) {
        activity.runOnUiThread(() -> {
            try {
                AudioManager am = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(speakerOn);
                }
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void releaseCallAudioMode() {
        activity.runOnUiThread(() -> {
            try {
                AudioManager am = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setSpeakerphoneOn(false);
                    am.setMode(AudioManager.MODE_NORMAL);
                }
            } catch (Exception ignored) {
            }
        });
    }

    @JavascriptInterface
    public void restartCallScreeningService() {
        activity.runOnUiThread(() -> {
            stopSpeaking();
            initTts();
        });
    }
}
