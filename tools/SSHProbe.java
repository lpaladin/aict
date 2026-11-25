import com.jcraft.jsch.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.net.*;
import java.net.Proxy;

/** Exercises the exact SSH library packaged into the Android client. */
public final class SSHProbe {
    public static void main(String[] args) throws Exception {
        String host = args.length > 0 ? args[0] : "127.0.0.1";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 19198;
        JSch jsch = new JSch();
        String publicKey = new String(Files.readAllBytes(Paths.get(".secrets/host.pub")), StandardCharsets.UTF_8).trim();
        String knownHosts = "[" + host + "]:" + port + " " + publicKey + "\n";
        jsch.setKnownHosts(new ByteArrayInputStream(knownHosts.getBytes(StandardCharsets.UTF_8)));
        jsch.addIdentity(args.length > 3 ? args[3] : ".secrets/client");
        Session session = jsch.getSession(args.length > 2 ? args[2] : "aict_demo", host, port);
        session.setConfig("StrictHostKeyChecking", "yes");
        try {
            session.connect(15000);
            int local = session.setPortForwardingL("127.0.0.1", 0, "127.0.0.1", 18767);
            URL url = new URL("http://127.0.0.1:18765/health");
            HttpURLConnection connection = (HttpURLConnection)url.openConnection(new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", local)));
            connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            try (InputStream input = connection.getInputStream()) {
                String response = new String(input.readAllBytes(), StandardCharsets.UTF_8);
                if (!response.contains("true")) throw new IOException("Unexpected health response");
                System.out.println("PASS: JSch host verification, embedded identity authentication, SSH forwarding and HTTP proxy: " + response);
            } finally { connection.disconnect(); }
            ChannelDirectTCPIP control = (ChannelDirectTCPIP) session.openChannel("direct-tcpip");
            control.setHost("127.0.0.1"); control.setPort(18766);
            InputStream input = control.getInputStream(); OutputStream output = control.getOutputStream();
            control.connect(10000);
            output.write("{\"type\":\"hello\",\"installationId\":\"jsch-probe\"}\n".getBytes(StandardCharsets.UTF_8)); output.flush();
            String welcome = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8)).readLine();
            if (welcome == null || !welcome.contains("welcome")) throw new IOException("No RPC welcome");
            System.out.println("PASS: native control channel registration");
            control.disconnect();
        } finally { session.disconnect(); }
    }
}
