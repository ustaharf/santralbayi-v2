package com.santralbayi.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class SantralFcmService extends FirebaseMessagingService {

    public static void syncCurrentToken(Context context) {
        if (context == null) return;
        try {
            final Context appCtx = context.getApplicationContext();
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                try {
                    if (!task.isSuccessful()) return;
                    String token = task.getResult();
                    if (token == null || token.trim().isEmpty()) return;
                    String cleanToken = token.trim();
                    SharedPreferences prefs = appCtx.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
                    prefs.edit().putString("fcm_push_token", cleanToken).apply();
                    registerTokenOnServer(appCtx, cleanToken);
                } catch (Exception ignored) {
                }
            });
        } catch (Throwable ignored) {
        }
    }

    public static void registerTokenOnServer(Context context, String tokenOverride) {
        if (context == null) return;
        final Context appCtx = context.getApplicationContext();
        Executors.newSingleThreadExecutor().execute(() -> {
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = appCtx.getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
                String ownerPhone = prefs.getString("tracked_owner_phone11", "");
                String token = (tokenOverride != null && !tokenOverride.trim().isEmpty())
                        ? tokenOverride.trim()
                        : prefs.getString("fcm_push_token", "");
                if (ownerPhone == null || ownerPhone.trim().length() < 10) return;
                if (token == null || token.trim().length() < 20) return;

                String liveOrigin = AndroidBridge.getSavedLiveOrigin(appCtx);
                URL url = new URL(liveOrigin + "/api/pbx/register-push-token");
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

                JSONObject payload = new JSONObject();
                payload.put("ownerPhone", ownerPhone.trim());
                payload.put("fcmToken", token.trim());
                payload.put("platform", "android");
                payload.put("apkVersion", AndroidBridge.NATIVE_APK_VERSION);

                byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bodyBytes);
                    os.flush();
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        try {
            if (token == null || token.trim().isEmpty()) return;
            SharedPreferences prefs = getSharedPreferences("sb_offline_auth_prefs", Context.MODE_PRIVATE);
            prefs.edit().putString("fcm_push_token", token.trim()).apply();
            registerTokenOnServer(getApplicationContext(), token.trim());
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        try {
            if (remoteMessage == null) return;
            Map<String, String> data = remoteMessage.getData();
            if (data == null || data.isEmpty()) return;

            String type = safe(data.get("type"));
            String uuid = safe(data.get("uuid"));
            String ownerPhone = safe(data.get("ownerPhone"));
            String notifKey = safe(data.get("notifKey"));
            if (notifKey.isEmpty() && !ownerPhone.isEmpty() && !uuid.isEmpty()) {
                notifKey = ownerPhone + ":" + uuid;
            }

            if ("call_ended".equalsIgnoreCase(type)) {
                if (!notifKey.isEmpty()) {
                    AndroidBridge.cancelNativeMissedCallNotification(getApplicationContext(), notifKey);
                }
                Intent endIntent = new Intent(MissedCallMonitorService.ACTION_LIVE_CALL_ENDED);
                endIntent.setPackage(getPackageName());
                endIntent.putExtra("missed_call_uuid", uuid);
                sendBroadcast(endIntent);
                return;
            }

            if ("incoming_call".equalsIgnoreCase(type)) {
                String callerName = safe(data.get("callerName"));
                String callerPhone = safe(data.get("callerPhone"));
                String summary = safe(data.get("summary"));
                String bridgeToken = safe(data.get("bridgeToken"));
                String who = !callerName.isEmpty() ? callerName : (!callerPhone.isEmpty() ? callerPhone : "Gelen Arama");
                String title = "📞 Sekreter Görüşüyor • " + who;
                String body = !summary.isEmpty()
                        ? summary
                        : "Size ulaşılamadığı için sekreter karşılıyor. Müsaitseniz hemen ücretsiz internetten alabilirsiniz.";

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
        } catch (Exception ignored) {
        }
    }

    private static String safe(String v) {
        return v == null ? "" : v.trim();
    }
}
