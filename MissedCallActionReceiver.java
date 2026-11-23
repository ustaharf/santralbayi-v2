package com.santralbayi.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class MissedCallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_TRANSFER_TO_OWNER = "com.santralbayi.app.ACTION_TRANSFER_TO_OWNER";
    public static final String ACTION_CALLBACK_CALLER = "com.santralbayi.app.ACTION_CALLBACK_CALLER";
    private static final String LIVE_SERVER_ORIGIN = "http://178.208.187.42:3000";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        final String action = intent.getAction();
        final String notifKey = intent.getStringExtra("notif_key");
        final String callUuid = intent.getStringExtra("missed_call_uuid");
        final String callerPhone = intent.getStringExtra("missed_call_phone");
        final String ownerPhone = intent.getStringExtra("owner_phone");
        final String callerLabel = intent.getStringExtra("caller_label");

        if (ACTION_CALLBACK_CALLER.equals(action)) {
            if (notifKey != null && !notifKey.isEmpty()) {
                AndroidBridge.cancelNativeMissedCallNotification(context, notifKey);
            }
            dialCallerDirectly(context, callerPhone);
            return;
        }

        if (ACTION_TRANSFER_TO_OWNER.equals(action)) {
            if (notifKey != null && !notifKey.isEmpty()) {
                AndroidBridge.cancelNativeMissedCallNotification(context, notifKey);
            }
            try {
                Intent callUi = new Intent(context.getApplicationContext(), LiveCallActivity.class);
                callUi.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                callUi.putExtra("notif_key", notifKey != null ? notifKey : "");
                callUi.putExtra("missed_call_uuid", callUuid != null ? callUuid : "");
                callUi.putExtra("missed_call_phone", callerPhone != null ? callerPhone : "");
                callUi.putExtra("caller_name", callerLabel != null ? callerLabel : "");
                callUi.putExtra("owner_phone", ownerPhone != null ? ownerPhone : "");
                callUi.putExtra("auto_accept", true);
                context.getApplicationContext().startActivity(callUi);
            } catch (Exception ignored) {
                dialCallerDirectly(context, callerPhone);
            }
        }
    }

    private void dialCallerDirectly(Context context, String rawPhone) {
        try {
            if (rawPhone == null || rawPhone.trim().isEmpty()) return;
            String cleanPhone = rawPhone.replaceAll("[^0-9+*#]", "");
            if (cleanPhone.isEmpty()) return;

            boolean hasCallPerm = ContextCompat.checkSelfPermission(
                    context, Manifest.permission.CALL_PHONE
            ) == PackageManager.PERMISSION_GRANTED;

            Intent callIntent = new Intent(hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL);
            callIntent.setData(Uri.parse("tel:" + cleanPhone.replace("#", Uri.encode("#"))));
            callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(callIntent);
        } catch (Exception ignored) {
        }
    }
}
