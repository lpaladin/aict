package dev.aict.container;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.text.format.Formatter;
import android.webkit.CookieManager;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class DownloadEngine {
    private static final Map<String,AtomicBoolean> ACTIVE=new ConcurrentHashMap<>();
    public static void cancel(String id) { AtomicBoolean token=ACTIVE.get(id);if(token==null) throw new IllegalArgumentException("Unknown active download");token.set(true); }
    public static void start(Context context,JSONObject params,NativeRuntime.Reply reply,String id) {
        AtomicBoolean cancel=new AtomicBoolean();
        if(ACTIVE.putIfAbsent(id,cancel)!=null){reply.send(NativeRuntime.error(id,new IllegalArgumentException("Duplicate download id")));return;}
        new Thread(()->{
            UpdateDownloadNotification notification = null;
            try {
                if(!ConnectionService.connected || ConnectionService.proxyPort==0) throw new IOException("SSH offline");
                String path=FileAccess.location(context,params);
                if(path.startsWith("content:")) throw new IllegalArgumentException("Download to a file path, then copy chunks to a content URI");
                Map<String,String> headers=new HashMap<>();
                JSONObject h=params.optJSONObject("headers");if(h!=null) for(Iterator<String> i=h.keys();i.hasNext();){String k=i.next();headers.put(k,h.getString(k));}
                File file=new File(path);
                String source = params.getString("url");
                notification = UpdateDownloadNotification.open(context, id, source);
                final UpdateDownloadNotification progressNotice = notification;
                HttpTransfer.fetch(source,file,new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",ConnectionService.proxyPort)),headers,new HttpTransfer.Session(){
                    public String cookies(String url){return CookieManager.getInstance().getCookie(url);}
                    public void setCookie(String url,String cookie){CookieManager.getInstance().setCookie(url,cookie);}
                    public boolean cancelled(){return cancel.get();}
                    public void progress(long bytes,long total){
                        if (progressNotice != null) progressNotice.show(bytes, total);
                        try{reply.send(new JSONObject().put("type","event").put("id",id).put("taskId",id).put("event","download.progress").put("data",new JSONObject().put("bytes",bytes).put("total",total).put("path",path)));}catch(Exception ignored){}
                    }
                });
                reply.send(NativeRuntime.ok(id,new JSONObject().put("path",path).put("bytes",file.length())));
            }catch(Throwable e){reply.send(NativeRuntime.error(id,e));}
            finally{
                if (notification != null) notification.close();
                ACTIVE.remove(id);
            }
        },"AICT-download").start();
    }

    private static final class UpdateDownloadNotification {
        private static final String CHANNEL = "aict.update-downloads";
        private static final int NOTIFICATION_ID = 8102;
        private final Context context;
        private final NotificationManager manager;
        private final String tag;
        private long lastUpdate = -1000;

        private UpdateDownloadNotification(Context context, NotificationManager manager, String id) {
            this.context = context;
            this.manager = manager;
            this.tag = "update-download-" + id;
        }

        static UpdateDownloadNotification open(Context context, String id, String source) {
            try {
                URI uri = URI.create(source);
                JSONObject config = ConnectionService.config;
                if (config == null || !"http".equals(uri.getScheme()) ||
                    !"127.0.0.1".equals(uri.getHost()) || uri.getPort() != config.optInt("httpPort", -1) ||
                    !uri.getRawPath().matches("/device-updates/[A-Za-z0-9_-]+\\.apk")) return null;
                NotificationManager manager = context.getSystemService(NotificationManager.class);
                if (manager == null || !manager.areNotificationsEnabled()) return null;
                manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "AICT 应用更新", NotificationManager.IMPORTANCE_HIGH));
                UpdateDownloadNotification notification = new UpdateDownloadNotification(context, manager, id);
                notification.show(0, -1);
                return notification;
            } catch (RuntimeException ignored) {
                return null;
            }
        }

        void show(long bytes, long total) {
            long now = SystemClock.elapsedRealtime();
            if (now - lastUpdate < 1000 && (total <= 0 || bytes < total)) return;
            lastUpdate = now;
            try {
                boolean indeterminate = total <= 0;
                int percent = indeterminate ? 0 : (int) Math.min(100, bytes * 100.0 / total);
                String details = indeterminate ? Formatter.formatFileSize(context, bytes) :
                    percent + "% · " + Formatter.formatFileSize(context, bytes) +
                        " / " + Formatter.formatFileSize(context, total);
                manager.notify(tag, NOTIFICATION_ID, new Notification.Builder(context, CHANNEL)
                    .setSmallIcon(android.R.drawable.stat_sys_download)
                    .setContentTitle("正在下载 AICT 更新")
                    .setContentText(details)
                    .setProgress(100, percent, indeterminate)
                    .setOnlyAlertOnce(true)
                    .setOngoing(true)
                    .build());
            } catch (RuntimeException ignored) {
                // Notification restrictions must not interrupt the download.
            }
        }

        void close() {
            try { manager.cancel(tag, NOTIFICATION_ID); }
            catch (RuntimeException ignored) {}
        }
    }
}
