package dev.aict.container;

import android.app.*;
import android.content.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.*;
import android.util.Base64;
import com.jcraft.jsch.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** Owns one SSH session; no system proxy or VPN is changed. */
public final class ConnectionService extends Service {
    public static volatile boolean connected;
    public static volatile int proxyPort;
    public static volatile String status = "未连接", installationId = "", credentialId = "";
    public static volatile JSONObject config;
    static final String SSH_PORT = "sshPort";
    static final String ACCEPT_CONTROL = "acceptRemoteControl";
    private static final ExecutorService REPLIES = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "AICT-Control-Replies");
        thread.setDaemon(true);
        return thread;
    });
    private volatile OutputStream controlOutput;
    private final SharedPreferences.OnSharedPreferenceChangeListener preferenceListener = (preferences, key) -> {
        if (SSH_PORT.equals(key)) {
            connected = false;
            new Thread(this::reconnect, "AICT-Reconnect").start();
        } else if (ACCEPT_CONTROL.equals(key)) {
            new Thread(this::sendDeviceSettings, "AICT-Settings").start();
        }
    };
    private volatile boolean running;
    private volatile Session session;
    private Thread worker;

    static int getSshPort(Context context) throws Exception {
        int port = context.getSharedPreferences("aict", MODE_PRIVATE).getInt(SSH_PORT, 0);
        if (port >= 1 && port <= 65535) return port;
        return new JSONObject(readAsset(context, "connection.json")).getInt("port");
    }

    static boolean acceptsRemoteControl(Context context) {
        return context.getSharedPreferences("aict", MODE_PRIVATE).getBoolean(ACCEPT_CONTROL, false);
    }

    private void reconnect() {
        Session active = session;
        if (active != null) active.disconnect();
        Thread activeWorker = worker;
        if (activeWorker != null) activeWorker.interrupt();
    }

    private void sendDeviceSettings() {
        try {
            synchronized (ConnectionService.class) {
                OutputStream output = controlOutput;
                if (output != null) {
                    write(output, new JSONObject().put("type", "deviceSettings")
                        .put(ACCEPT_CONTROL, acceptsRemoteControl(this)));
                }
            }
        } catch (Exception e) {
            Session active = session;
            if (active != null) active.disconnect();
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        getSharedPreferences("aict", MODE_PRIVATE).registerOnSharedPreferenceChangeListener(preferenceListener);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel("aict.connection", "AIct 连接", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, ConnectionService.class).setAction("stop");
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        startForeground(8101, new Notification.Builder(this, "aict.connection")
            .setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("AIct")
            .setContentText("SSH 连接服务运行中").setContentIntent(openPi)
            .addAction(new Notification.Action.Builder(null, "断开", stopPi).build()).build());
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (!running) {
            running = true;
            worker = new Thread(this::loop, "AICT-SSH");
            worker.start();
        }
        return START_NOT_STICKY;
    }

    private void loop() {
        int delay = 1000;
        while (running) {
            try {
                config = new JSONObject(readAsset(this, "connection.json"));
                int sshPort = getSshPort(this);
                credentialId = config.getString("credentialId");
                android.content.SharedPreferences prefs = getSharedPreferences("aict", MODE_PRIVATE);
                installationId = prefs.getString("installationId", null);
                if (installationId == null) {
                    installationId = UUID.randomUUID().toString();
                    prefs.edit().putString("installationId", installationId).commit();
                }
                status = "正在连接 " + config.getString("host") + ":" + sshPort;
                JSch jsch = new JSch();
                jsch.setHostKeyRepository(new PinnedHostKey(config.getString("hostKeySha256")));
                jsch.addIdentity("embedded-user", config.getString("privateKey").getBytes(StandardCharsets.UTF_8), null, null);
                Session ssh = jsch.getSession(config.getString("username"), config.getString("host"), sshPort);
                session = ssh;
                ssh.setConfig("StrictHostKeyChecking", "yes");
                ssh.setServerAliveInterval(20000);
                ssh.setServerAliveCountMax(3);
                ssh.connect(15000);
                if (sshPort != getSshPort(this)) throw new IOException("SSH port changed; reconnecting");
                proxyPort = ssh.setPortForwardingL("127.0.0.1", 0, "127.0.0.1", config.getInt("proxyPort"));
                ChannelDirectTCPIP channel = (ChannelDirectTCPIP) ssh.openChannel("direct-tcpip");
                channel.setHost("127.0.0.1");
                channel.setPort(config.getInt("controlPort"));
                channel.setOrgIPAddress("127.0.0.1");
                channel.setOrgPort(0);
                InputStream input = channel.getInputStream();
                OutputStream output = channel.getOutputStream();
                channel.connect(10000);
                JSONObject hello = new JSONObject().put("type", "hello").put("protocol", 1)
                    .put("credentialId", credentialId).put("installationId", installationId)
                    .put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT);
                synchronized (ConnectionService.class) {
                    hello.put(ACCEPT_CONTROL, acceptsRemoteControl(this));
                    write(output, hello);
                    controlOutput = output;
                }
                connected = true;
                status = "SSH 已认证 · " + config.getString("host") + ":" + sshPort;
                delay = 1000;
                BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
                while (running && ssh.isConnected()) {
                    String line = reader.readLine();
                    if (line == null) break;
                    if (line.length() > 8 * 1024 * 1024) throw new IOException("control frame too large");
                    JSONObject msg = new JSONObject(line);
                    if ("request".equals(msg.optString("type"))) {
                        NativeRuntime.dispatch(this, line, result -> REPLIES.execute(() -> {
                            if (controlOutput != output) return;
                            try { write(output, result); }
                            catch (Exception e) {
                                android.util.Log.e("AICT", "Control reply failed", e);
                                channel.disconnect();
                            }
                        }));
                    }
                }
            } catch (Exception e) {
                status = "连接失败：" + e.getClass().getSimpleName() + " · " + e.getMessage();
                android.util.Log.e("AICT", "SSH connection failed", e);
            } finally {
                controlOutput = null;
                connected = false;
                if (session != null) session.disconnect();
                session = null;
            }
            if (running) {
                try { Thread.sleep(delay); } catch (InterruptedException ignored) {}
                delay = Math.min(30000, delay * 2);
            }
        }
    }

    private static String readAsset(Context context, String name) throws IOException {
        try (InputStream in = context.getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
    private static synchronized void write(OutputStream output, JSONObject message) throws IOException {
        output.write((message.toString() + "\n").getBytes(StandardCharsets.UTF_8));
        output.flush();
    }
    @Override public void onDestroy() {
        getSharedPreferences("aict", MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(preferenceListener);
        controlOutput = null;
        running = false;
        connected = false;
        if (session != null) session.disconnect();
        if (worker != null) worker.interrupt();
        status = "已断开";
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }

    static final class PinnedHostKey implements HostKeyRepository {
        private final String expected;
        PinnedHostKey(String expected) { this.expected = expected; }
        public int check(String host, byte[] key) {
            try {
                String actual = "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key), Base64.NO_WRAP | Base64.NO_PADDING);
                return MessageDigest.isEqual(actual.getBytes(StandardCharsets.US_ASCII), expected.getBytes(StandardCharsets.US_ASCII)) ? OK : CHANGED;
            } catch (Exception e) { return CHANGED; }
        }
        public void add(HostKey key, UserInfo userInfo) {}
        public void remove(String host, String type) {}
        public void remove(String host, String type, byte[] key) {}
        public String getKnownHostsRepositoryID() { return "APK-pinned-host-key"; }
        public HostKey[] getHostKey() { return new HostKey[0]; }
        public HostKey[] getHostKey(String host, String type) { return new HostKey[0]; }
    }
}
