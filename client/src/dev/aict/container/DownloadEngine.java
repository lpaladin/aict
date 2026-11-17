package dev.aict.container;

import android.content.Context;
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
            try {
                if(!ConnectionService.connected || ConnectionService.proxyPort==0) throw new IOException("SSH offline");
                String path=FileAccess.location(context,params);
                if(path.startsWith("content:")) throw new IllegalArgumentException("Download to a file path, then copy chunks to a content URI");
                Map<String,String> headers=new HashMap<>();
                JSONObject h=params.optJSONObject("headers");if(h!=null) for(Iterator<String> i=h.keys();i.hasNext();){String k=i.next();headers.put(k,h.getString(k));}
                File file=new File(path);
                HttpTransfer.fetch(params.getString("url"),file,new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",ConnectionService.proxyPort)),headers,new HttpTransfer.Session(){
                    public String cookies(String url){return CookieManager.getInstance().getCookie(url);}
                    public void setCookie(String url,String cookie){CookieManager.getInstance().setCookie(url,cookie);}
                    public boolean cancelled(){return cancel.get();}
                    public void progress(long bytes,long total){try{reply.send(new JSONObject().put("type","event").put("id",id).put("taskId",id).put("event","download.progress").put("data",new JSONObject().put("bytes",bytes).put("total",total).put("path",path)));}catch(Exception ignored){}}
                });
                reply.send(NativeRuntime.ok(id,new JSONObject().put("path",path).put("bytes",file.length())));
            }catch(Throwable e){reply.send(NativeRuntime.error(id,e));}
            finally{ACTIVE.remove(id);}
        },"AICT-download").start();
    }
}
