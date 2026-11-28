package dev.aict.container;

import android.app.*;
import android.content.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.*;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import android.util.Base64;
import com.jcraft.jsch.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.ByteBuffer;
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
    private static final int DISCOVERY_PORT = 18768;
    private static final int DISCOVERY_TIMEOUT_MS = 700;
    static final String ALLOW_FORWARDING = "allowLocalForwarding";
    public static volatile String connectionRoute = "";
    static final String ACCEPT_CONTROL = "acceptRemoteControl";
    private static final ExecutorService REPLIES = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "AICT-Control-Replies");
        thread.setDaemon(true);
        return thread;
    });
    private volatile OutputStream controlOutput;
    private final SharedPreferences.OnSharedPreferenceChangeListener preferenceListener = (preferences, key) -> {
        if (SSH_PORT.equals(key)
                || (ALLOW_FORWARDING.equals(key) && !allowsForwarding(this))) {
            connected = false;
            new Thread(this::reconnect, "AICT-Reconnect").start();
        } else if (ACCEPT_CONTROL.equals(key)) {
            new Thread(this::sendDeviceSettings, "AICT-Settings").start();
        }
    };
    private volatile boolean running;
    private volatile Session session;
    private volatile Thread worker;
    private ConnectivityManager connectivity;
    private Network observedNetwork;
    private Set<LinkAddress> observedAddresses = Collections.emptySet();
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { defaultNetworkChanged(network); }
        @Override public void onLinkPropertiesChanged(Network network, LinkProperties links) {
            if (!network.equals(observedNetwork)) return;
            Set<LinkAddress> addresses = new LinkedHashSet<>(links.getLinkAddresses());
            if (!addresses.equals(observedAddresses)) {
                observedAddresses = addresses;
                if (running) reconnect();
            }
        }
        @Override public void onLost(Network network) {
            if (network.equals(observedNetwork)) defaultNetworkChanged(null);
        }
    };

    private void defaultNetworkChanged(Network network) {
        if (!java.util.Objects.equals(observedNetwork, network)) {
            observedNetwork = network;
            observedAddresses = linkAddresses(network);
            if (running) reconnect();
        }
    }

    static boolean allowsForwarding(Context context) {
        return context.getSharedPreferences("aict", MODE_PRIVATE).getBoolean(ALLOW_FORWARDING, true);
    }

    private Set<LinkAddress> linkAddresses(Network network) {
        LinkProperties links = network == null ? null : connectivity.getLinkProperties(network);
        return links == null ? Collections.emptySet() : new LinkedHashSet<>(links.getLinkAddresses());
    }

    private Session discoverLanSsh(JSch jsch, Network network, String fingerprint) throws Exception {
        if (network == null) return null;
        NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
        if (caps == null || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                || !(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                     || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return null;
        Set<InetSocketAddress> candidates = new LinkedHashSet<>();
        try (DatagramSocket socket = new DatagramSocket()) {
            network.bindSocket(socket);
            socket.setBroadcast(true);
            String nonce = UUID.randomUUID().toString().replace("-", "");
            byte[] query = ("AICT-DISCOVER/1 " + nonce + " " + fingerprint).getBytes(StandardCharsets.US_ASCII);
            Set<LinkAddress> addresses = linkAddresses(network);
            boolean sent = false;
            for (LinkAddress link : addresses) {
                InetAddress local = link.getAddress();
                int prefix = link.getPrefixLength();
                if (!(local instanceof Inet4Address) || prefix < 1 || prefix > 30) continue;
                int broadcast = ipv4Bits(local) | (-1 >>> prefix);
                InetAddress destination = InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(broadcast).array());
                socket.send(new DatagramPacket(query, query.length, destination, DISCOVERY_PORT));
                sent = true;
            }
            if (!sent) return null;
            String replyPrefix = "AICT-HERE/1 " + nonce + " ";
            long deadline = SystemClock.elapsedRealtime() + DISCOVERY_TIMEOUT_MS;
            byte[] buffer = new byte[128];
            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
            while (running && candidates.size() < 2) {
                long remaining = deadline - SystemClock.elapsedRealtime();
                if (remaining <= 0) break;
                socket.setSoTimeout((int) remaining);
                packet.setLength(buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException e) {
                    break;
                }
                if (packet.getPort() != DISCOVERY_PORT || !isOnLink(packet.getAddress(), addresses)) continue;
                String reply = new String(buffer, 0, packet.getLength(), StandardCharsets.US_ASCII);
                if (!reply.startsWith(replyPrefix)) continue;
                String port = reply.substring(replyPrefix.length());
                if (!port.matches("[0-9]{1,5}")) continue;
                int value = Integer.parseInt(port);
                if (value >= 1 && value <= 65535) candidates.add(new InetSocketAddress(packet.getAddress(), value));
            }
        }
        for (InetSocketAddress candidate : candidates) {
            if (!network.equals(connectivity.getActiveNetwork())) break;
            try {
                return connectSsh(jsch, candidate.getAddress().getHostAddress(), candidate.getPort(), network);
            } catch (Exception e) {
                android.util.Log.i("AICT", "Discovered LAN SSH endpoint unavailable", e);
            }
        }
        return null;
    }

    private static int ipv4Bits(InetAddress address) {
        return ByteBuffer.wrap(address.getAddress()).getInt();
    }

    private static boolean isOnLink(InetAddress target, Set<LinkAddress> addresses) {
        if (!(target instanceof Inet4Address) || target.isAnyLocalAddress()
                || target.isLoopbackAddress() || target.isMulticastAddress()) return false;
        int targetBits = ipv4Bits(target);
        for (LinkAddress link : addresses) {
            InetAddress local = link.getAddress();
            int prefix = link.getPrefixLength();
            if (!(local instanceof Inet4Address) || prefix < 1 || prefix > 30 || target.equals(local)) continue;
            int difference = targetBits ^ ipv4Bits(local);
            if (difference >>> (32 - prefix) == 0) return true;
        }
        return false;
    }

    private Session connectSsh(JSch jsch, String host, int port, Network network) throws Exception {
        if (!running) throw new IOException("SSH service is stopping");
        Session candidate = jsch.getSession(config.getString("username"), host, port);
        session = candidate;
        candidate.setConfig("StrictHostKeyChecking", "yes");
        candidate.setServerAliveInterval(20000);
        candidate.setServerAliveCountMax(3);
        if (network != null) {
            candidate.setSocketFactory(new com.jcraft.jsch.SocketFactory() {
                public Socket createSocket(String address, int targetPort) throws IOException {
                    Socket socket = network.getSocketFactory().createSocket();
                    try {
                        socket.connect(new InetSocketAddress(address, targetPort), 2500);
                        return socket;
                    } catch (IOException e) {
                        socket.close();
                        throw e;
                    }
                }
                public InputStream getInputStream(Socket socket) throws IOException { return socket.getInputStream(); }
                public OutputStream getOutputStream(Socket socket) throws IOException { return socket.getOutputStream(); }
            });
        }
        try {
            candidate.connect(network == null ? 15000 : 2500);
            return candidate;
        } catch (Exception e) {
            candidate.disconnect();
            throw e;
        }
    }

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
        connectivity = getSystemService(ConnectivityManager.class);
        observedNetwork = connectivity.getActiveNetwork();
        observedAddresses = linkAddresses(observedNetwork);
        connectivity.registerDefaultNetworkCallback(networkCallback);
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
                Network network = connectivity.getActiveNetwork();
                Session preferred = null;
                try {
                    preferred = discoverLanSsh(jsch, network, config.getString("hostKeySha256"));
                } catch (Exception e) {
                    android.util.Log.i("AICT", "LAN discovery unavailable; trying configured endpoint", e);
                }
                if (!java.util.Objects.equals(network, connectivity.getActiveNetwork()))
                    throw new IOException("Default network changed; reconnecting");
                final Session ssh = preferred != null ? preferred
                    : connectSsh(jsch, config.getString("host"), sshPort, null);
                if (sshPort != getSshPort(this)) throw new IOException("SSH port changed; reconnecting");
                String route = preferred == null ? "configured" : "lan";
                Map<Integer, Integer> forwards = new LinkedHashMap<>();
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
                connectionRoute = route;
                connected = true;
                status = ("lan".equals(route) ? "局域网直连" : "SSH 已认证") + " · " + ssh.getHost() + ":" + ssh.getPort();
                delay = 1000;
                BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
                while (running && ssh.isConnected()) {
                    String line = reader.readLine();
                    if (line == null) break;
                    if (line.length() > 8 * 1024 * 1024) throw new IOException("control frame too large");
                    JSONObject msg = new JSONObject(line);
                    if ("request".equals(msg.optString("type"))) {
                        if (msg.optString("method").startsWith("forward.")) {
                            String id = msg.getString("id");
                            JSONObject result;
                            try {
                                result = NativeRuntime.ok(id, forward(ssh, forwards, msg));
                            } catch (Exception e) {
                                result = NativeRuntime.error(id, e);
                            }
                            write(output, result);
                            continue;
                        }
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
                connectionRoute = "";
                if (session != null) session.disconnect();
                session = null;
            }
            if (running) {
                try { Thread.sleep(delay); } catch (InterruptedException ignored) {}
                delay = Math.min(30000, delay * 2);
            }
        }
    }

    private static int port(JSONObject params, String name, boolean ephemeral) throws Exception {
        Object value = params.opt(name);
        if (value == null && ephemeral) return 0;
        if (!(value instanceof Integer) || (int) value < (ephemeral ? 0 : 1) || (int) value > 65535)
            throw new IllegalArgumentException("Invalid " + name);
        return (int) value;
    }

    private Object forward(Session ssh, Map<Integer, Integer> forwards, JSONObject request) throws Exception {
        if (!allowsForwarding(this)) throw new SecurityException("额外端口转发已在 AICT 权限中心关闭");
        JSONObject params = request.optJSONObject("params");
        if (params == null) params = new JSONObject();
        switch (request.getString("method")) {
            case "forward.open": {
                int remote = port(params, "remotePort", false);
                int local = port(params, "localPort", true);
                if (forwards.size() >= 8) throw new IllegalStateException("最多同时开放 8 个转发端口");
                JSONObject settings = config;
                if (remote == settings.getInt("httpPort") || remote == settings.getInt("controlPort")
                        || remote == settings.getInt("proxyPort"))
                    throw new IllegalArgumentException("AICT 内部端口无法额外转发");
                // Check both the server ACL and upstream listener before returning a phone port.
                ChannelDirectTCPIP probe = (ChannelDirectTCPIP) ssh.openChannel("direct-tcpip");
                try {
                    probe.setHost("127.0.0.1");
                    probe.setPort(remote);
                    probe.connect(3000);
                } finally {
                    probe.disconnect();
                }
                if (!allowsForwarding(this)) throw new SecurityException("端口转发权限已关闭");
                int bound = ssh.setPortForwardingL("127.0.0.1", local, "127.0.0.1", remote);
                forwards.put(bound, remote);
                return forwardInfo(bound, remote);
            }
            case "forward.close": {
                int local = port(params, "localPort", false);
                if (!forwards.containsKey(local)) return new JSONObject().put("closed", false);
                ssh.delPortForwardingL("127.0.0.1", local);
                forwards.remove(local);
                return new JSONObject().put("closed", true);
            }
            case "forward.list": {
                JSONArray result = new JSONArray();
                for (Map.Entry<Integer, Integer> entry : forwards.entrySet())
                    result.put(forwardInfo(entry.getKey(), entry.getValue()));
                return result;
            }
            default: throw new IllegalArgumentException("Unknown forwarding method");
        }
    }

    private static JSONObject forwardInfo(int local, int remote) throws Exception {
        return new JSONObject().put("host", "127.0.0.1").put("localPort", local).put("remotePort", remote);
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
        connectivity.unregisterNetworkCallback(networkCallback);
        connected = false;
        connectionRoute = "";
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
