package dev.aict.container;

import java.io.*;
import java.net.*;
import java.util.*;

/** HTTP transfer core, also exercised on the JVM against real HTTP fixtures. */
public final class HttpTransfer {
    public interface Session {
        String cookies(String url);
        void setCookie(String url,String value);
        void progress(long bytes,long total);
        boolean cancelled();
    }
    public static void fetch(String source,File file,Proxy proxy,Map<String,String> headers,Session session) throws Exception {
        File meta=new File(file.getPath()+".http-resume");
        Properties state=new Properties();
        if(meta.isFile()) try(InputStream in=new FileInputStream(meta)){state.load(in);}
        String validator=state.getProperty("validator","");
        boolean resume=source.equals(state.getProperty("source")) && !validator.isEmpty();
        long offset=resume?file.length():0;
        URL initial=new URL(source), url=initial;
        HttpURLConnection connection=null;
        try {
            for(int redirects=0;;redirects++) {
                if(session.cancelled()) throw new InterruptedIOException("Download cancelled");
                if(!url.getProtocol().equals("http")&&!url.getProtocol().equals("https")) throw new IOException("Unsupported redirect scheme");
                connection=(HttpURLConnection)url.openConnection(proxy);
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
                connection.setRequestProperty("Accept-Encoding","identity");
                for(Map.Entry<String,String> header:headers.entrySet()) {
                    String key=header.getKey();
                    if(key.equalsIgnoreCase("Cookie")||key.equalsIgnoreCase("Range")||key.equalsIgnoreCase("If-Range")||key.equalsIgnoreCase("Accept-Encoding")) continue;
                    if(!sameOrigin(initial,url) && key.equalsIgnoreCase("Authorization")) continue;
                    connection.setRequestProperty(key,header.getValue());
                }
                String cookies=session.cookies(url.toString());
                if(cookies!=null) connection.setRequestProperty("Cookie",cookies);
                if(offset>0){connection.setRequestProperty("Range","bytes="+offset+"-");connection.setRequestProperty("If-Range",validator);}
                int code=connection.getResponseCode();
                for(Map.Entry<String,List<String>> header:connection.getHeaderFields().entrySet())
                    if(header.getKey()!=null && header.getKey().equalsIgnoreCase("Set-Cookie")) for(String cookie:header.getValue()) session.setCookie(url.toString(),cookie);
                if(code==301||code==302||code==303||code==307||code==308) {
                    if(redirects>=10) throw new IOException("Too many redirects");
                    String location=connection.getHeaderField("Location"); if(location==null) throw new IOException("Redirect without Location");
                    url=new URL(url,location); connection.disconnect(); continue;
                }
                String range=connection.getHeaderField("Content-Range");
                if(code==416 && offset>0 && ("bytes */"+offset).equals(range)) { meta.delete();session.progress(offset,offset);return; }
                if(code!=200 && code!=206) throw new IOException("Download HTTP "+code);
                long bodyLength=connection.getContentLengthLong(), total;
                if(code==206) {
                    if(range==null||!range.matches("bytes "+offset+"-[0-9]+/[0-9]+")) throw new IOException("Invalid Content-Range for resume");
                    total=Long.parseLong(range.substring(range.indexOf('/')+1));
                    long end=Long.parseLong(range.substring(range.indexOf('-')+1,range.indexOf('/')));
                    if(end<offset || end>=total || (bodyLength>=0 && bodyLength!=end-offset+1)) throw new IOException("Inconsistent Content-Range");
                } else {offset=0;total=bodyLength;}
                String etag=connection.getHeaderField("ETag");
                String modified=connection.getHeaderField("Last-Modified");
                state.setProperty("source",source);
                state.setProperty("validator",etag!=null&&!etag.startsWith("W/")?etag:modified==null?"":modified);
                File parent=file.getParentFile(); if(parent!=null&&!parent.isDirectory()&&!parent.mkdirs()) throw new IOException("Cannot create destination directory");
                long bytes=offset, received=0, last=0;
                try(RandomAccessFile output=new RandomAccessFile(file,"rw")) {
                    if(offset==0) output.setLength(0);
                    output.seek(offset);
                    try(OutputStream out=new FileOutputStream(meta)){state.store(out,"HTTP resume validator");}
                    try(InputStream input=connection.getInputStream()) {
                    byte[] buffer=new byte[65536]; int n;
                    while((n=input.read(buffer))!=-1) {
                        if(session.cancelled()) throw new InterruptedIOException("Download cancelled");
                        output.write(buffer,0,n); bytes+=n; received+=n;
                        if(System.currentTimeMillis()-last>200){session.progress(bytes,total);last=System.currentTimeMillis();}
                    }
                    }
                }
                if(bodyLength>=0 && received!=bodyLength) throw new EOFException("Incomplete HTTP body; retry with same destination to resume");
                if(total>=0 && bytes!=total) throw new EOFException("Incomplete range; retry with same destination to resume");
                meta.delete(); session.progress(bytes,total); return;
            }
        } finally { if(connection!=null) connection.disconnect(); }
    }
    private static boolean sameOrigin(URL a,URL b) {
        return a.getProtocol().equalsIgnoreCase(b.getProtocol()) && a.getHost().equalsIgnoreCase(b.getHost()) && (a.getPort()<0?a.getDefaultPort():a.getPort())==(b.getPort()<0?b.getDefaultPort():b.getPort());
    }
}
