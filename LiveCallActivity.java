package com.santralbayi.app;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.json.JSONObject;

public class LiveCallActivity extends Activity {
    private static final int SAMPLE_RATE = 8000;
    private static final int REQ_RECORD_AUDIO = 3031;

    private String callUuid = "";
    private String callerName = "";
    private String callerPhone = "";
    private String ownerPhone = "";
    private String summaryText = "";
    private String notifKey = "";
    private String bridgeToken = "";
    private boolean autoAccept = false;

    private TextView badgeView;
    private TextView nameView;
    private TextView phoneView;
    private TextView statusView;
    private TextView timerView;
    private LinearLayout incomingButtonsRow;
    private LinearLayout activeButtonsRow;
    private LinearLayout endedButtonsRow;
    private Button muteBtn;
    private Button speakerBtn;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean callClosed = new AtomicBoolean(false);
    private final AtomicBoolean micMuted = new AtomicBoolean(false);
    private final AtomicBoolean speakerOn = new AtomicBoolean(false);
    private final AtomicBoolean bridgeStarted = new AtomicBoolean(false);

    private volatile Socket wsSocket;
    private volatile OutputStream wsOut;
    private final Object wsWriteLock = new Object();
    private AudioRecord audioRecord;
    private AudioTrack audioTrack;
    private AcousticEchoCanceler echoCanceler;
    private NoiseSuppressor noiseSuppressor;
    private Ringtone incomingRingtone;
    private Vibrator incomingVibrator;
    private PowerManager.WakeLock proximityLock;
    private boolean endReceiverRegistered = false;

    private final BroadcastReceiver callEndedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || bridgeStarted.get() || callClosed.get()) return;
            String endedUuid = intent.getStringExtra("missed_call_uuid");
            if (endedUuid == null || endedUuid.isEmpty() || endedUuid.equals(callUuid)) {
                uiHandler.post(() -> {
                    if (!bridgeStarted.get() && !callClosed.get()) {
                        closeStandaloneScreen();
                    }
                });
            }
        }
    };

    private long connectedAtMs = 0L;
    private final Runnable timerTick = new Runnable() {
        @Override
        public void run() {
            if (callClosed.get() || connectedAtMs <= 0L) return;
            long sec = Math.max(0L, (System.currentTimeMillis() - connectedAtMs) / 1000L);
            long m = sec / 60L;
            long s = sec % 60L;
            timerView.setText(String.format("%02d:%02d", m, s));
            uiHandler.postDelayed(this, 1000L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            try {
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                if (km != null) {
                    km.requestDismissKeyguard(this, null);
                }
            } catch (Exception ignored) {
            }
        } else {
            //noinspection deprecation
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#070d19"));
            getWindow().setNavigationBarColor(Color.parseColor("#070d19"));
        }

        readIntentExtras(getIntent());
        buildStandaloneCallUi();

        try {
            IntentFilter filter = new IntentFilter(MissedCallMonitorService.ACTION_LIVE_CALL_ENDED);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(callEndedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(callEndedReceiver, filter);
            }
            endReceiverRegistered = true;
        } catch (Exception ignored) {
        }

        if (autoAccept) {
            beginAcceptFlow();
        } else {
            startGentleRingtone();
            // 45 sn boyunca cevaplanmazsa bağımsız ekranı sessizce kapat (sekreter not almaya devam eder)
            uiHandler.postDelayed(() -> {
                if (!bridgeStarted.get() && !callClosed.get()) {
                    closeStandaloneScreen();
                }
            }, 45000L);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        boolean wasAuto = intent != null && intent.getBooleanExtra("auto_accept", false);
        if (wasAuto && !bridgeStarted.get()) {
            readIntentExtras(intent);
            beginAcceptFlow();
        }
    }

    private void readIntentExtras(Intent intent) {
        if (intent == null) return;
        callUuid = safeStr(intent.getStringExtra("missed_call_uuid"));
        callerName = safeStr(intent.getStringExtra("caller_name"));
        callerPhone = safeStr(intent.getStringExtra("missed_call_phone"));
        ownerPhone = safeStr(intent.getStringExtra("owner_phone"));
        summaryText = safeStr(intent.getStringExtra("call_summary"));
        notifKey = safeStr(intent.getStringExtra("notif_key"));
        bridgeToken = safeStr(intent.getStringExtra("bridge_token"));
        autoAccept = intent.getBooleanExtra("auto_accept", false);
        if (callerName.isEmpty()) {
            callerName = !callerPhone.isEmpty() ? callerPhone : "Gelen Arama";
        }
    }

    private String safeStr(String s) {
        return s == null ? "" : s.trim();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable roundedBox(int bgColor, int strokeColor, int radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(bgColor);
        gd.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) {
            gd.setStroke(dp(1), strokeColor);
        }
        return gd;
    }

    private void buildStandaloneCallUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#070d19"));
        root.setPadding(dp(24), dp(48), dp(24), dp(36));

        badgeView = new TextView(this);
        badgeView.setText("SANTRAL BAYİ • 0 KONTÖR CANLI HAT");
        badgeView.setTextColor(Color.parseColor("#6ee7b7"));
        badgeView.setTextSize(11f);
        badgeView.setTypeface(null, Typeface.BOLD);
        badgeView.setPadding(dp(14), dp(7), dp(14), dp(7));
        badgeView.setBackground(roundedBox(Color.parseColor("#0f2e28"), Color.parseColor("#10b981"), 20));
        root.addView(badgeView);

        TextView avatar = new TextView(this);
        avatar.setText("📞");
        avatar.setTextSize(42f);
        avatar.setGravity(Gravity.CENTER);
        avatar.setBackground(roundedBox(Color.parseColor("#112240"), Color.parseColor("#38bdf8"), 56));
        LinearLayout.LayoutParams avLp = new LinearLayout.LayoutParams(dp(108), dp(108));
        avLp.topMargin = dp(34);
        root.addView(avatar, avLp);

        nameView = new TextView(this);
        nameView.setText(callerName);
        nameView.setTextColor(Color.WHITE);
        nameView.setTextSize(26f);
        nameView.setTypeface(null, Typeface.BOLD);
        nameView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nLp.topMargin = dp(20);
        root.addView(nameView, nLp);

        phoneView = new TextView(this);
        phoneView.setText(callerPhone.equals(callerName) ? "İnternet Üzerinden Canlı Arama" : callerPhone);
        phoneView.setTextColor(Color.parseColor("#94a3b8"));
        phoneView.setTextSize(15f);
        phoneView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams pLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pLp.topMargin = dp(6);
        root.addView(phoneView, pLp);

        timerView = new TextView(this);
        timerView.setText("");
        timerView.setTextColor(Color.parseColor("#34d399"));
        timerView.setTextSize(22f);
        timerView.setTypeface(null, Typeface.BOLD);
        timerView.setGravity(Gravity.CENTER);
        timerView.setVisibility(View.GONE);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tLp.topMargin = dp(12);
        root.addView(timerView, tLp);

        statusView = new TextView(this);
        statusView.setText(
                !summaryText.isEmpty()
                        ? summaryText
                        : "Sekreter şu an arayanla görüşüyor.\nMüsaitseniz tek tuşla ücretsiz internetten alabilirsiniz."
        );
        statusView.setTextColor(Color.parseColor("#cbd5e1"));
        statusView.setTextSize(14f);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(dp(16), dp(14), dp(16), dp(14));
        statusView.setBackground(roundedBox(Color.parseColor("#0f172a"), Color.parseColor("#1e293b"), 16));
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sLp.topMargin = dp(22);
        root.addView(statusView, sLp);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        // 1) GELEN ÇAĞRI TUŞLARI (Müsaitim Aç / Sekreter Devam Etsin)
        incomingButtonsRow = new LinearLayout(this);
        incomingButtonsRow.setOrientation(LinearLayout.VERTICAL);
        incomingButtonsRow.setGravity(Gravity.CENTER);

        Button acceptBtn = new Button(this);
        acceptBtn.setText("✅  MÜSAİTİM, ARAYANI BANA AKTAR");
        acceptBtn.setTextColor(Color.parseColor("#052e16"));
        acceptBtn.setTextSize(15f);
        acceptBtn.setTypeface(null, Typeface.BOLD);
        acceptBtn.setAllCaps(false);
        acceptBtn.setBackground(roundedBox(Color.parseColor("#10b981"), Color.parseColor("#34d399"), 28));
        acceptBtn.setOnClickListener(v -> beginAcceptFlow());
        LinearLayout.LayoutParams accLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(60));
        incomingButtonsRow.addView(acceptBtn, accLp);

        Button dismissBtn = new Button(this);
        dismissBtn.setText("🔇  Sekreter Devam Etsin (Kapat)");
        dismissBtn.setTextColor(Color.parseColor("#e2e8f0"));
        dismissBtn.setTextSize(14f);
        dismissBtn.setTypeface(null, Typeface.BOLD);
        dismissBtn.setAllCaps(false);
        dismissBtn.setBackground(roundedBox(Color.parseColor("#1e293b"), Color.parseColor("#334155"), 28));
        dismissBtn.setOnClickListener(v -> closeStandaloneScreen());
        LinearLayout.LayoutParams disLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54));
        disLp.topMargin = dp(14);
        incomingButtonsRow.addView(dismissBtn, disLp);

        root.addView(incomingButtonsRow, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // 2) CANLI GÖRÜŞME TUŞLARI (Sessize Al / Hoparlör / Görüşmeyi Bitir)
        activeButtonsRow = new LinearLayout(this);
        activeButtonsRow.setOrientation(LinearLayout.VERTICAL);
        activeButtonsRow.setGravity(Gravity.CENTER);
        activeButtonsRow.setVisibility(View.GONE);

        LinearLayout controlsRow = new LinearLayout(this);
        controlsRow.setOrientation(LinearLayout.HORIZONTAL);
        controlsRow.setGravity(Gravity.CENTER);

        muteBtn = new Button(this);
        muteBtn.setText("🎙️ Mikrofon Açık");
        muteBtn.setTextColor(Color.WHITE);
        muteBtn.setTextSize(13f);
        muteBtn.setTypeface(null, Typeface.BOLD);
        muteBtn.setAllCaps(false);
        muteBtn.setBackground(roundedBox(Color.parseColor("#1e293b"), Color.parseColor("#334155"), 22));
        muteBtn.setOnClickListener(v -> toggleMute());
        LinearLayout.LayoutParams mLp = new LinearLayout.LayoutParams(0, dp(54), 1f);
        mLp.rightMargin = dp(8);
        controlsRow.addView(muteBtn, mLp);

        speakerBtn = new Button(this);
        speakerBtn.setText("📱 Ahize");
        speakerBtn.setTextColor(Color.WHITE);
        speakerBtn.setTextSize(13f);
        speakerBtn.setTypeface(null, Typeface.BOLD);
        speakerBtn.setAllCaps(false);
        speakerBtn.setBackground(roundedBox(Color.parseColor("#1e293b"), Color.parseColor("#334155"), 22));
        speakerBtn.setOnClickListener(v -> toggleSpeaker());
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(0, dp(54), 1f);
        spLp.leftMargin = dp(8);
        controlsRow.addView(speakerBtn, spLp);

        activeButtonsRow.addView(controlsRow, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        Button hangupBtn = new Button(this);
        hangupBtn.setText("🔴  GÖRÜŞMEYİ BİTİR");
        hangupBtn.setTextColor(Color.WHITE);
        hangupBtn.setTextSize(15f);
        hangupBtn.setTypeface(null, Typeface.BOLD);
        hangupBtn.setAllCaps(false);
        hangupBtn.setBackground(roundedBox(Color.parseColor("#dc2626"), Color.parseColor("#f87171"), 28));
        hangupBtn.setOnClickListener(v -> hangupAndClose());
        LinearLayout.LayoutParams hLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(60));
        hLp.topMargin = dp(16);
        activeButtonsRow.addView(hangupBtn, hLp);

        root.addView(activeButtonsRow, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // 3) GÖRÜŞME BİTMİŞSE GERİ ARAMA TUŞU
        endedButtonsRow = new LinearLayout(this);
        endedButtonsRow.setOrientation(LinearLayout.VERTICAL);
        endedButtonsRow.setVisibility(View.GONE);

        Button callbackBtn = new Button(this);
        callbackBtn.setText("📞  Arayanı Hemen Geri Ara");
        callbackBtn.setTextColor(Color.parseColor("#052e16"));
        callbackBtn.setTextSize(15f);
        callbackBtn.setTypeface(null, Typeface.BOLD);
        callbackBtn.setAllCaps(false);
        callbackBtn.setBackground(roundedBox(Color.parseColor("#10b981"), Color.parseColor("#34d399"), 28));
        callbackBtn.setOnClickListener(v -> {
            dialCallerDirectly(callerPhone);
            closeStandaloneScreen();
        });
        endedButtonsRow.addView(callbackBtn, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(58)));

        Button closeEndedBtn = new Button(this);
        closeEndedBtn.setText("Kapat");
        closeEndedBtn.setTextColor(Color.WHITE);
        closeEndedBtn.setAllCaps(false);
        closeEndedBtn.setBackground(roundedBox(Color.parseColor("#1e293b"), Color.parseColor("#334155"), 28));
        closeEndedBtn.setOnClickListener(v -> closeStandaloneScreen());
        LinearLayout.LayoutParams ceLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(50));
        ceLp.topMargin = dp(12);
        endedButtonsRow.addView(closeEndedBtn, ceLp);

        root.addView(endedButtonsRow, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
    }

    private void startGentleRingtone() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (uri != null) {
                incomingRingtone = RingtoneManager.getRingtone(getApplicationContext(), uri);
                if (incomingRingtone != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        incomingRingtone.setLooping(true);
                    }
                    incomingRingtone.play();
                }
            }
        } catch (Exception ignored) {
        }
        try {
            incomingVibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (incomingVibrator != null && incomingVibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 600, 900, 600, 900};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    incomingVibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    //noinspection deprecation
                    incomingVibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void stopRingtone() {
        try {
            if (incomingRingtone != null && incomingRingtone.isPlaying()) {
                incomingRingtone.stop();
            }
            incomingRingtone = null;
        } catch (Exception ignored) {
        }
        try {
            if (incomingVibrator != null) {
                incomingVibrator.cancel();
                incomingVibrator = null;
            }
        } catch (Exception ignored) {
        }
    }

    private void beginAcceptFlow() {
        stopRingtone();
        if (!notifKey.isEmpty()) {
            AndroidBridge.cancelNativeMissedCallNotification(getApplicationContext(), notifKey);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
            return;
        }
        startZeroCostInternetBridge();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_RECORD_AUDIO) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startZeroCostInternetBridge();
            } else {
                statusView.setText("Mikrofon izni verilmedi. Arayanı normal hattan arayabilirsiniz.");
                incomingButtonsRow.setVisibility(View.GONE);
                activeButtonsRow.setVisibility(View.GONE);
                endedButtonsRow.setVisibility(View.VISIBLE);
            }
        }
    }

    private void startZeroCostInternetBridge() {
        if (!bridgeStarted.compareAndSet(false, true)) return;

        incomingButtonsRow.setVisibility(View.GONE);
        activeButtonsRow.setVisibility(View.VISIBLE);
        endedButtonsRow.setVisibility(View.GONE);
        statusView.setText("🔄 Sekreter aradan çekiliyor, canlı ses bağlanıyor (0 kontör)...");

        new Thread(() -> {
            try {
                String liveOrigin = AndroidBridge.getSavedLiveOrigin(getApplicationContext());
                URL originUrl = new URL(liveOrigin);
                boolean isHttps = "https".equalsIgnoreCase(originUrl.getProtocol());
                String wsHost = originUrl.getHost();
                int wsPort = originUrl.getPort() > 0 ? originUrl.getPort() : (isHttps ? 443 : 80);
                String hostHeader = ((isHttps && wsPort == 443) || (!isHttps && wsPort == 80))
                        ? wsHost
                        : (wsHost + ":" + wsPort);

                // 1) Token yoksa veya yenilemek için sunucudan canlı köprü iznini al
                if (bridgeToken.isEmpty() || callUuid.isEmpty()) {
                    URL url = new URL(liveOrigin + "/api/pbx/transfer-to-owner");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(6000);
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

                    JSONObject reqBody = new JSONObject();
                    reqBody.put("uuid", callUuid);
                    reqBody.put("ownerPhone", ownerPhone);
                    reqBody.put("callerPhone", callerPhone);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(reqBody.toString().getBytes(StandardCharsets.UTF_8));
                    }
                    int code = conn.getResponseCode();
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(
                            code >= 200 && code < 400 ? conn.getInputStream() : conn.getErrorStream(),
                            StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = br.readLine()) != null) sb.append(line);
                    }
                    conn.disconnect();

                    JSONObject resp = new JSONObject(sb.toString());
                    if (!"INTERNET_BRIDGE_READY".equals(resp.optString("mode", ""))) {
                        String fallbackPhone = resp.optString("callerPhone11", callerPhone);
                        if (!fallbackPhone.isEmpty()) callerPhone = fallbackPhone;
                        showCallAlreadyEndedUi("Sekreter görüşmesi az önce tamamlandı.");
                        return;
                    }
                    callUuid = resp.optString("uuid", callUuid);
                    bridgeToken = resp.optString("bridgeToken", bridgeToken);
                }

                // 2) Saf RFC 6455 WebSocket bağlantısı aç (HTTP ve ilerideki HTTPS alan adı destekli!)
                String path = "/ws/live-call?uuid=" + URLEncoder.encode(callUuid, "UTF-8")
                        + "&ownerPhone=" + URLEncoder.encode(ownerPhone, "UTF-8")
                        + "&token=" + URLEncoder.encode(bridgeToken, "UTF-8");

                Socket sock;
                if (isHttps) {
                    SSLSocket sslSock = (SSLSocket) SSLSocketFactory.getDefault().createSocket();
                    sslSock.connect(new InetSocketAddress(wsHost, wsPort), 6000);
                    sslSock.setTcpNoDelay(true);
                    sslSock.startHandshake();
                    sock = sslSock;
                } else {
                    sock = new Socket();
                    sock.connect(new InetSocketAddress(wsHost, wsPort), 6000);
                    sock.setTcpNoDelay(true);
                }
                wsSocket = sock;
                wsOut = sock.getOutputStream();
                BufferedInputStream bis = new BufferedInputStream(sock.getInputStream(), 8192);

                byte[] keyBytes = new byte[16];
                new SecureRandom().nextBytes(keyBytes);
                String wsKey = Base64.encodeToString(keyBytes, Base64.NO_WRAP);

                String handshake = "GET " + path + " HTTP/1.1\r\n"
                        + "Host: " + hostHeader + "\r\n"
                        + "Upgrade: websocket\r\n"
                        + "Connection: Upgrade\r\n"
                        + "Sec-WebSocket-Key: " + wsKey + "\r\n"
                        + "Sec-WebSocket-Version: 13\r\n\r\n";
                wsOut.write(handshake.getBytes(StandardCharsets.UTF_8));
                wsOut.flush();

                String statusLine = readHttpLine(bis);
                if (statusLine == null || !statusLine.contains("101")) {
                    showCallAlreadyEndedUi("Canlı hat az önce kapandı.");
                    return;
                }
                String hdr;
                while ((hdr = readHttpLine(bis)) != null && !hdr.isEmpty()) {
                    // HTTP başlıklarını tüket
                }

                // 3) Ahize / Mikrofon + Yankı İptali + Yakınlık Sensörü aç
                setupNativeAudioAndProximity();

                connectedAtMs = System.currentTimeMillis();
                uiHandler.post(() -> {
                    statusView.setText("🟢 Canlı Bağlı • Sıfır Kontör (İnternetten Konuşuluyor)");
                    timerView.setVisibility(View.VISIBLE);
                    timerView.setText("00:00");
                    uiHandler.post(timerTick);
                });

                // 4) Mikrofon gönderim iş parçacığı (20 ms = 160 örnek = 320 byte 8kHz PCM16)
                new Thread(this::micUploadLoop, "sb-mic-tx").start();

                // 5) Arayanın sesini dinleyip anında ahizeye ver
                wsReceiveLoop(bis);
            } catch (Exception e) {
                if (!callClosed.get()) {
                    showCallAlreadyEndedUi("Görüşme bağlantısı sonlandı.");
                }
            } finally {
                releaseAudioAndSocket();
            }
        }, "sb-live-call").start();
    }

    private String readHttpLine(InputStream in) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int prev = -1;
        int cur;
        while ((cur = in.read()) != -1) {
            if (cur == '\n' && prev == '\r') {
                byte[] bytes = baos.toByteArray();
                int len = bytes.length > 0 ? bytes.length - 1 : 0;
                return new String(bytes, 0, len, StandardCharsets.UTF_8);
            }
            baos.write(cur);
            prev = cur;
        }
        return null;
    }

    private void setupNativeAudioAndProximity() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(false);
            }

            int minPlay = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int playBuf = Math.max(minPlay, 1600);
            audioTrack = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setBufferSizeInBytes(playBuf)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();
            audioTrack.play();

            int minRec = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int recBuf = Math.max(minRec, 1600);
            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    recBuf
            );
            int sessionId = audioRecord.getAudioSessionId();
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(sessionId);
                if (echoCanceler != null) echoCanceler.setEnabled(true);
            }
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId);
                if (noiseSuppressor != null) noiseSuppressor.setEnabled(true);
            }
            audioRecord.startRecording();

            // Telefonu kulağa yaklaştırınca ekranı karart (gerçek arama hissi)
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                    proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "santralbayi:call_prox");
                    proximityLock.acquire(30 * 60 * 1000L);
                }
            } catch (Exception ignoredProx) {
            }
        } catch (Exception ignored) {
        }
    }

    private void micUploadLoop() {
        byte[] frame = new byte[320]; // 20 ms @ 8kHz PCM16
        byte[] silent = new byte[320];
        try {
            while (!callClosed.get() && audioRecord != null) {
                int read = audioRecord.read(frame, 0, frame.length);
                if (read > 0) {
                    if (micMuted.get()) {
                        sendWsClientFrame(0x2, silent, 0, read);
                    } else {
                        sendWsClientFrame(0x2, frame, 0, read);
                    }
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void wsReceiveLoop(BufferedInputStream in) throws Exception {
        while (!callClosed.get()) {
            int b0 = in.read();
            if (b0 == -1) break;
            int b1 = in.read();
            if (b1 == -1) break;
            int opcode = b0 & 0x0f;
            int len = b1 & 0x7f;
            if (len == 126) {
                int hi = in.read();
                int lo = in.read();
                if (hi == -1 || lo == -1) break;
                len = (hi << 8) | lo;
            } else if (len == 127) {
                long longLen = 0;
                for (int i = 0; i < 8; i++) {
                    int x = in.read();
                    if (x == -1) return;
                    longLen = (longLen << 8) | (x & 0xff);
                }
                if (longLen > 262144) break;
                len = (int) longLen;
            }
            byte[] payload = new byte[len];
            int got = 0;
            while (got < len) {
                int r = in.read(payload, got, len - got);
                if (r == -1) return;
                got += r;
            }
            if (opcode == 0x2) {
                AudioTrack track = audioTrack;
                if (track != null && !callClosed.get()) {
                    track.write(payload, 0, payload.length);
                }
            } else if (opcode == 0x9) {
                sendWsClientFrame(0xA, payload, 0, payload.length);
            } else if (opcode == 0x8) {
                break;
            } else if (opcode == 0x1) {
                String txt = new String(payload, StandardCharsets.UTF_8);
                if (txt.contains("call_ended")) {
                    break;
                }
            }
        }
        if (!callClosed.get()) {
            uiHandler.post(this::closeStandaloneScreen);
        }
    }

    private void sendWsClientFrame(int opcode, byte[] data, int offset, int length) {
        OutputStream out = wsOut;
        if (out == null || callClosed.get()) return;
        try {
            byte[] mask = new byte[4];
            int t = (int) System.nanoTime();
            mask[0] = (byte) (t & 0xff);
            mask[1] = (byte) ((t >> 8) & 0xff);
            mask[2] = (byte) ((t >> 16) & 0xff);
            mask[3] = (byte) ((t >> 24) & 0xff);

            int hdrLen = (length < 126) ? 6 : 8;
            byte[] pkt = new byte[hdrLen + length];
            pkt[0] = (byte) (0x80 | (opcode & 0x0f));
            int maskPos;
            if (length < 126) {
                pkt[1] = (byte) (0x80 | length);
                maskPos = 2;
            } else {
                pkt[1] = (byte) (0x80 | 126);
                pkt[2] = (byte) ((length >> 8) & 0xff);
                pkt[3] = (byte) (length & 0xff);
                maskPos = 4;
            }
            System.arraycopy(mask, 0, pkt, maskPos, 4);
            for (int i = 0; i < length; i++) {
                pkt[hdrLen + i] = (byte) (data[offset + i] ^ mask[i & 3]);
            }
            synchronized (wsWriteLock) {
                out.write(pkt);
                out.flush();
            }
        } catch (Exception ignored) {
        }
    }

    private void toggleMute() {
        boolean nowMuted = !micMuted.get();
        micMuted.set(nowMuted);
        muteBtn.setText(nowMuted ? "🔇 Sessizde" : "🎙️ Mikrofon Açık");
        muteBtn.setBackground(roundedBox(
                nowMuted ? Color.parseColor("#7f1d1d") : Color.parseColor("#1e293b"),
                nowMuted ? Color.parseColor("#ef4444") : Color.parseColor("#334155"),
                22
        ));
    }

    private void toggleSpeaker() {
        boolean nowSpeaker = !speakerOn.get();
        speakerOn.set(nowSpeaker);
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setSpeakerphoneOn(nowSpeaker);
            }
        } catch (Exception ignored) {
        }
        speakerBtn.setText(nowSpeaker ? "🔊 Hoparlör Açık" : "📱 Ahize");
        speakerBtn.setBackground(roundedBox(
                nowSpeaker ? Color.parseColor("#065f46") : Color.parseColor("#1e293b"),
                nowSpeaker ? Color.parseColor("#10b981") : Color.parseColor("#334155"),
                22
        ));
    }

    private void showCallAlreadyEndedUi(String msg) {
        uiHandler.post(() -> {
            if (callClosed.get()) return;
            statusView.setText(msg + "\nİsterseniz tek dokunuşla geri arayabilirsiniz.");
            incomingButtonsRow.setVisibility(View.GONE);
            activeButtonsRow.setVisibility(View.GONE);
            endedButtonsRow.setVisibility(View.VISIBLE);
        });
    }

    private void dialCallerDirectly(String rawPhone) {
        try {
            if (rawPhone == null || rawPhone.trim().isEmpty()) return;
            String cleanPhone = rawPhone.replaceAll("[^0-9+*#]", "");
            if (cleanPhone.isEmpty()) return;
            boolean hasCallPerm = ContextCompat.checkSelfPermission(
                    this, Manifest.permission.CALL_PHONE
            ) == PackageManager.PERMISSION_GRANTED;
            Intent callIntent = new Intent(hasCallPerm ? Intent.ACTION_CALL : Intent.ACTION_DIAL);
            callIntent.setData(Uri.parse("tel:" + cleanPhone.replace("#", Uri.encode("#"))));
            callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(callIntent);
        } catch (Exception ignored) {
        }
    }

    private void hangupAndClose() {
        new Thread(() -> {
            try {
                byte[] bye = "{\"type\":\"hangup\"}".getBytes(StandardCharsets.UTF_8);
                sendWsClientFrame(0x1, bye, 0, bye.length);
            } catch (Exception ignored) {
            }
            uiHandler.post(this::closeStandaloneScreen);
        }).start();
    }

    private void closeStandaloneScreen() {
        if (!callClosed.compareAndSet(false, true)) return;
        stopRingtone();
        uiHandler.removeCallbacksAndMessages(null);
        releaseAudioAndSocket();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
    }

    private void releaseAudioAndSocket() {
        try {
            if (echoCanceler != null) {
                echoCanceler.release();
                echoCanceler = null;
            }
        } catch (Exception ignored) {
        }
        try {
            if (noiseSuppressor != null) {
                noiseSuppressor.release();
                noiseSuppressor = null;
            }
        } catch (Exception ignored) {
        }
        try {
            if (audioRecord != null) {
                audioRecord.stop();
                audioRecord.release();
                audioRecord = null;
            }
        } catch (Exception ignored) {
        }
        try {
            if (audioTrack != null) {
                audioTrack.stop();
                audioTrack.release();
                audioTrack = null;
            }
        } catch (Exception ignored) {
        }
        try {
            if (wsSocket != null) {
                wsSocket.close();
                wsSocket = null;
            }
            wsOut = null;
        } catch (Exception ignored) {
        }
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception ignored) {
        }
        try {
            if (proximityLock != null && proximityLock.isHeld()) {
                proximityLock.release();
                proximityLock = null;
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        callClosed.set(true);
        if (endReceiverRegistered) {
            try {
                unregisterReceiver(callEndedReceiver);
            } catch (Exception ignored) {
            }
            endReceiverRegistered = false;
        }
        stopRingtone();
        uiHandler.removeCallbacksAndMessages(null);
        releaseAudioAndSocket();
        super.onDestroy();
    }
}
